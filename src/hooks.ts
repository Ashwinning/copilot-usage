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

function localCliHookCommand(): string | undefined {
  if (!process.argv[1]) {
    return undefined;
  }
  const scriptPath = path.resolve(process.argv[1]);
  return `${quoteForShell(process.execPath)} ${quoteForShell(scriptPath)} ${STORE_SESSION_FLAG}`;
}

function buildHookCommand(): string {
  const localCommand = localCliHookCommand();
  if (!localCommand) {
    return HOOK_COMMAND;
  }
  return `${HOOK_COMMAND} || ${localCommand}`;
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
    const hasFallbackCommand =
      bash.includes("||") ||
      powershell.includes("||") ||
      /\bnode(?:\.exe)?\b/iu.test(bash) ||
      /\bnode(?:\.exe)?\b/iu.test(powershell);
    return hasStoreFlag && hasFallbackCommand;
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

export async function findRepoRoot(startDirectory: string): Promise<string> {
  let current = path.resolve(startDirectory);
  while (true) {
    if (await exists(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDirectory);
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
          bash: hookCommand,
          powershell: hookCommand,
          cwd: ".",
          timeoutSec: 10
        }
      ]
    }
  };
  await writeFile(hookPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return hookPath;
}
