#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { aggregateDaily, aggregateMonthly, aggregateSessions } from "./aggregate.js";
import { readStoredCopilotUsage, storeLatestSession, storePromptUsageFromOutput } from "./copilot.js";
import { appendHookDebugLog } from "./debug-log.js";
import { discoverHook, findRepoRoot, installHook } from "./hooks.js";
import { renderSingleUsageTable } from "./render.js";
import { ensurePaths, loadUsageState, resolvePaths, saveUsageState } from "./state.js";
function printHelp() {
    console.log(`f6n-copilot-usage

Usage:
  f6n-copilot-usage [copilot flags...]
  f6n-copilot-usage --f6n-store-session [--f6n-state-home <path>] [--f6n-copilot-home <path>]
  f6n-copilot-usage --f6n-show-usage [--f6n-state-home <path>] [--f6n-copilot-home <path>]

Wrapper-only flags (reserved):
  --f6n-store-session  Capture latest Copilot session (hook mode)
  --f6n-state-home     Override usage state directory
  --f6n-copilot-home   Override Copilot state directory
  --f6n-show-usage     Print stored usage table and exit

Default mode:
  Installs/updates hook automatically, prints a brief intro, then runs native copilot.
`);
}
function parseArgs(argv) {
    const options = {
        storeSession: false,
        showUsage: false,
        forwardedArgs: []
    };
    const consumeValue = (arg, next) => {
        if (!next) {
            throw new Error(`Missing value for ${arg}`);
        }
        return next;
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--") {
            options.forwardedArgs.push(...argv.slice(i + 1));
            break;
        }
        if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
        if (arg === "--f6n-store-session") {
            options.storeSession = true;
            continue;
        }
        if (arg === "--f6n-show-usage") {
            options.showUsage = true;
            continue;
        }
        if (arg === "--f6n-state-home") {
            options.stateHome = consumeValue(arg, argv[i + 1]);
            i += 1;
            continue;
        }
        if (arg.startsWith("--f6n-state-home=")) {
            options.stateHome = arg.slice("--f6n-state-home=".length);
            continue;
        }
        if (arg === "--f6n-copilot-home") {
            options.copilotHome = consumeValue(arg, argv[i + 1]);
            i += 1;
            continue;
        }
        if (arg.startsWith("--f6n-copilot-home=")) {
            options.copilotHome = arg.slice("--f6n-copilot-home=".length);
            continue;
        }
        if (arg.startsWith("--f6n")) {
            throw new Error(`Unknown wrapper flag: ${arg}`);
        }
        options.forwardedArgs.push(arg);
    }
    if (options.storeSession && options.showUsage) {
        throw new Error("Use only one of --f6n-store-session or --f6n-show-usage");
    }
    return options;
}
function isPromptMode(forwardedArgs) {
    return forwardedArgs.some((arg) => arg === "-p" || arg === "--prompt" || arg.startsWith("--prompt="));
}
function isWindows() {
    return process.platform === "win32";
}
function resolveCopilotCommandForPty() {
    if (!isWindows()) {
        return "copilot";
    }
    const whereResult = spawnSync("where", ["copilot"], {
        encoding: "utf8"
    });
    if (whereResult.status === 0 && typeof whereResult.stdout === "string") {
        const firstMatch = whereResult.stdout
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .find((line) => line.length > 0);
        if (firstMatch) {
            return firstMatch;
        }
    }
    return "copilot.cmd";
}
async function runCopilotWithSpawn(forwardedArgs, promptMode) {
    return new Promise((resolve, reject) => {
        const child = spawn("copilot", forwardedArgs, {
            stdio: promptMode ? ["inherit", "pipe", "pipe"] : "inherit"
        });
        let output = "";
        if (promptMode) {
            child.stdout?.on("data", (chunk) => {
                const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
                output += text;
                process.stdout.write(text);
            });
            child.stderr?.on("data", (chunk) => {
                const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
                output += text;
                process.stderr.write(text);
            });
        }
        child.on("error", reject);
        child.on("exit", (code, signal) => {
            if (typeof code === "number") {
                resolve({ exitCode: code, output, captureMode: "spawn" });
                return;
            }
            if (signal) {
                resolve({ exitCode: 1, output, captureMode: "spawn" });
                return;
            }
            resolve({ exitCode: 0, output, captureMode: "spawn" });
        });
    });
}
async function runCopilotWithPty(forwardedArgs) {
    const ptyModuleRaw = await import("node-pty");
    const ptyModule = typeof ptyModuleRaw.spawn === "function"
        ? ptyModuleRaw
        : ptyModuleRaw.default;
    if (!ptyModule || typeof ptyModule.spawn !== "function") {
        throw new Error("node-pty did not expose a spawn function.");
    }
    const ptySpawn = ptyModule.spawn;
    const command = resolveCopilotCommandForPty();
    const args = forwardedArgs;
    const ptyProcess = ptySpawn(command, args, {
        name: process.env.TERM ?? "xterm-256color",
        cols: process.stdout.columns ?? 120,
        rows: process.stdout.rows ?? 40,
        cwd: process.cwd(),
        env: process.env
    });
    let output = "";
    const onPtyData = (data) => {
        output += data;
        process.stdout.write(data);
    };
    ptyProcess.onData(onPtyData);
    const canResize = process.stdout.isTTY;
    const onResize = () => {
        if (!canResize) {
            return;
        }
        const cols = process.stdout.columns ?? 120;
        const rows = process.stdout.rows ?? 40;
        try {
            ptyProcess.resize(cols, rows);
        }
        catch {
            // Ignore resize race conditions.
        }
    };
    if (canResize) {
        process.stdout.on("resize", onResize);
    }
    const stdin = process.stdin;
    const stdinWasRaw = Boolean(stdin.isRaw);
    const canForwardInput = stdin.isTTY;
    const onStdinData = (chunk) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        ptyProcess.write(text);
    };
    if (canForwardInput) {
        if (typeof stdin.setRawMode === "function" && !stdinWasRaw) {
            stdin.setRawMode(true);
        }
        stdin.resume();
        stdin.on("data", onStdinData);
    }
    const onSigInt = () => {
        ptyProcess.write("\x03");
    };
    const onSigTerm = () => {
        ptyProcess.write("\x03");
    };
    process.on("SIGINT", onSigInt);
    process.on("SIGTERM", onSigTerm);
    return new Promise((resolve) => {
        ptyProcess.onExit(({ exitCode }) => {
            process.off("SIGINT", onSigInt);
            process.off("SIGTERM", onSigTerm);
            if (canResize) {
                process.stdout.off("resize", onResize);
            }
            if (canForwardInput) {
                stdin.off("data", onStdinData);
                if (typeof stdin.setRawMode === "function" && !stdinWasRaw) {
                    stdin.setRawMode(false);
                }
            }
            resolve({
                exitCode: Number.isFinite(exitCode) ? exitCode : 1,
                output,
                captureMode: "pty"
            });
        });
    });
}
async function runCopilot(forwardedArgs) {
    const promptMode = isPromptMode(forwardedArgs);
    if (!promptMode && process.stdin.isTTY && process.stdout.isTTY) {
        try {
            return await runCopilotWithPty(forwardedArgs);
        }
        catch (error) {
            const fallbackReason = error instanceof Error ? error.message : String(error);
            const result = await runCopilotWithSpawn(forwardedArgs, promptMode);
            return {
                ...result,
                ptyFallbackReason: fallbackReason
            };
        }
    }
    return runCopilotWithSpawn(forwardedArgs, promptMode);
}
async function ensureHookInstalled(options) {
    const paths = resolvePaths(options.stateHome);
    await ensurePaths(paths);
    const state = await loadUsageState(paths);
    const repoRoot = await findRepoRoot(process.cwd());
    const repoState = state.repos[repoRoot];
    const discovery = await discoverHook(repoRoot, repoState?.hookFile);
    if (discovery.enabled && discovery.hookFilePath) {
        if (!repoState || repoState.hookFile !== discovery.hookFilePath) {
            state.repos[repoRoot] = {
                hookFile: discovery.hookFilePath,
                updatedAt: new Date().toISOString()
            };
            await saveUsageState(paths, state);
        }
        return discovery.hookFilePath;
    }
    const hookFile = await installHook(repoRoot);
    state.repos[repoRoot] = {
        hookFile,
        updatedAt: new Date().toISOString()
    };
    await saveUsageState(paths, state);
    return hookFile;
}
async function runWrapper(options) {
    const paths = resolvePaths(options.stateHome);
    await ensurePaths(paths);
    const hookFile = await ensureHookInstalled(options);
    console.log(`[copilot-usage] Usage tracking hook ready (${hookFile}). Launching copilot...`);
    try {
        const result = await runCopilot(options.forwardedArgs);
        await appendHookDebugLog(paths, "cli.copilot_run.completed", {
            captureMode: result.captureMode,
            outputLength: result.output.length,
            ptyFallbackReason: result.ptyFallbackReason ?? null
        });
        const promptCapture = await storePromptUsageFromOutput(paths, result.output);
        if (promptCapture.stored) {
            await appendHookDebugLog(paths, "cli.prompt_usage.stored", {
                sessionId: promptCapture.sessionId ?? null,
                usageEntries: promptCapture.usageEntries
            });
        }
        else {
            await appendHookDebugLog(paths, "cli.prompt_usage.not_stored", {
                message: promptCapture.message
            });
        }
        process.exit(result.exitCode);
    }
    catch (error) {
        const nodeError = error;
        if (nodeError.code === "ENOENT") {
            throw new Error("Native 'copilot' command not found in PATH.");
        }
        throw error;
    }
}
function pickDefaultView(timestamps) {
    const ms = timestamps
        .map((value) => new Date(value).getTime())
        .filter((value) => Number.isFinite(value));
    if (ms.length < 2) {
        return "sessions";
    }
    const min = Math.min(...ms);
    const max = Math.max(...ms);
    const span = Math.max(0, max - min);
    const oneDay = 24 * 60 * 60 * 1000;
    const oneMonth = 30 * oneDay;
    if (span < oneDay) {
        return "sessions";
    }
    if (span < oneMonth) {
        return "daily";
    }
    return "monthly";
}
async function runStoreSession(options) {
    const paths = resolvePaths(options.stateHome);
    await ensurePaths(paths);
    await appendHookDebugLog(paths, "cli.store_session.start", {
        stateRoot: paths.root,
        copilotHomeArg: options.copilotHome ?? null
    });
    const result = await storeLatestSession(paths, options.copilotHome);
    if (!result.stored) {
        await appendHookDebugLog(paths, "cli.store_session.not_stored", { message: result.message });
        console.log(`[copilot-usage] ${result.message}`);
        return;
    }
    await appendHookDebugLog(paths, "cli.store_session.stored", {
        sessionId: result.sessionId ?? null,
        usageEntries: result.usageEntries,
        archivePath: result.archivePath ?? null
    });
    console.log(`[copilot-usage] stored session=${result.sessionId} entries=${result.usageEntries} archive=${result.archivePath}`);
    const records = await readStoredCopilotUsage(paths);
    await appendHookDebugLog(paths, "cli.store_session.read_stored_usage", {
        recordCount: records.length
    });
    if (records.length === 0) {
        console.log(`[copilot-usage] No stored usage found yet in ${paths.root}.`);
        return;
    }
    const monthly = aggregateMonthly(records);
    const daily = aggregateDaily(records);
    const sessions = aggregateSessions(records);
    const view = pickDefaultView(records.map((record) => record.timestamp));
    console.log(renderSingleUsageTable(view, monthly, daily, sessions));
    console.log(`[copilot-usage] Showing ${view} view from stored data in ${paths.root}.`);
}
async function showUsage(options) {
    const paths = resolvePaths(options.stateHome);
    const records = await readStoredCopilotUsage(paths);
    if (records.length === 0) {
        console.log(`[copilot-usage] No stored usage found yet in ${paths.root}.`);
        return;
    }
    const monthly = aggregateMonthly(records);
    const daily = aggregateDaily(records);
    const sessions = aggregateSessions(records);
    const view = pickDefaultView(records.map((record) => record.timestamp));
    console.log(renderSingleUsageTable(view, monthly, daily, sessions));
    console.log(`[copilot-usage] Showing ${view} view from stored data in ${paths.root}.`);
}
async function run() {
    const options = parseArgs(process.argv.slice(2));
    if (options.storeSession) {
        await runStoreSession(options);
        return;
    }
    if (options.showUsage) {
        await showUsage(options);
        return;
    }
    await runWrapper(options);
}
run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`f6n-copilot-usage failed: ${message}`);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map