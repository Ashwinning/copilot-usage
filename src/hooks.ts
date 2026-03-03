import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const STORE_SESSION_FLAG = "--f6n-store-session";
const HOOK_COMMAND = `bunx @f6n/copilot-usage ${STORE_SESSION_FLAG}`;
const HOOK_FILE_NAME = "f6n-copilot-usage.json";

interface HookDiscoveryResult {
  enabled: boolean;
  hookFilePath?: string;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function quoteForShell(value: string): string {
  return `"${value.replace(/"/gu, '\\"')}"`;
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

function localCliHookCommand(): { bash: string; powershell: string } | undefined {
  if (!process.argv[1]) {
    return undefined;
  }
  const scriptPath = path.resolve(process.argv[1]);
  return {
    bash: `${quoteForShell(process.execPath)} ${quoteForShell(scriptPath)} ${STORE_SESSION_FLAG}`,
    powershell: `& ${quoteForPowerShell(process.execPath)} ${quoteForPowerShell(scriptPath)} ${STORE_SESSION_FLAG}`
  };
}

function buildHookCommand(): { bash: string; powershell: string } {
  const localCommand = localCliHookCommand();
  if (!localCommand) {
    return {
      bash: HOOK_COMMAND,
      powershell: HOOK_COMMAND
    };
  }
  return {
    bash: `${HOOK_COMMAND} || ${localCommand.bash}`,
    powershell: `${HOOK_COMMAND}; if ($LASTEXITCODE -ne 0) { ${localCommand.powershell} }`
  };
}

function hasStoreSessionHook(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") {
    return false;
  }
  const root = parsed as Record<string, unknown>;
  const hooks = root.hooks;
  if (!hooks || typeof hooks !== "object") {
    return false;
  }
  const sessionEnd = (hooks as Record<string, unknown>).sessionEnd;
  if (!Array.isArray(sessionEnd)) {
    return false;
  }
  return sessionEnd.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const record = entry as Record<string, unknown>;
    if (record.type !== "command") {
      return false;
    }
    const bash = typeof record.bash === "string" ? record.bash : "";
    const powershell = typeof record.powershell === "string" ? record.powershell : "";
    const hasStoreFlag = bash.includes(STORE_SESSION_FLAG) || powershell.includes(STORE_SESSION_FLAG);
    if (!hasStoreFlag) {
      return false;
    }

    const bashHasFallback = !bash.includes(STORE_SESSION_FLAG) || bash.includes("||");
    const powershellHasFallback =
      !powershell.includes(STORE_SESSION_FLAG) ||
      powershell.includes("if ($LASTEXITCODE -ne 0)");
    return bashHasFallback && powershellHasFallback;
  });
}

async function isValidHookFile(filePath: string): Promise<boolean> {
  try {
    const content = await readFile(filePath, "utf8");
    return hasStoreSessionHook(JSON.parse(content));
  } catch {
    return false;
  }
}

export async function findRepoRoot(startDirectory: string): Promise<string | undefined> {
  let current = path.resolve(startDirectory);
  while (true) {
    if (await exists(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export async function discoverHook(repoRoot: string, preferredHookFile?: string): Promise<HookDiscoveryResult> {
  if (preferredHookFile && (await isValidHookFile(preferredHookFile))) {
    return { enabled: true, hookFilePath: preferredHookFile };
  }
  const hooksDir = path.join(repoRoot, ".github", "hooks");
  if (!(await exists(hooksDir))) {
    return { enabled: false };
  }
  const entries = await readdir(hooksDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const fullPath = path.join(hooksDir, entry.name);
    if (await isValidHookFile(fullPath)) {
      return { enabled: true, hookFilePath: fullPath };
    }
  }
  return { enabled: false };
}

export async function installHook(repoRoot: string): Promise<string> {
  const hooksDir = path.join(repoRoot, ".github", "hooks");
  await mkdir(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, HOOK_FILE_NAME);
  const hookCommand = buildHookCommand();
  const payload = {
    version: 1,
    hooks: {
      sessionEnd: [
        {
          type: "command",
          bash: hookCommand.bash,
          powershell: hookCommand.powershell,
          cwd: ".",
          timeoutSec: 10
        }
      ]
    }
  };
  await writeFile(hookPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return hookPath;
}
