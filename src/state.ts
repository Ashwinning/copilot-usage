import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface AppPaths {
  root: string;
  usageSummariesPath: string;
  sessionArchiveDir: string;
  statePath: string;
  debugLogPath: string;
}

export interface RepoState {
  hookFile: string;
  updatedAt: string;
}

export interface UsageState {
  version: 1;
  repos: Record<string, RepoState>;
}

export function resolveCopilotUsageRoot(explicitPath?: string): string {
  if (explicitPath) {
    return explicitPath;
  }
  if (process.env.F6N_COPILOT_USAGE_HOME) {
    return process.env.F6N_COPILOT_USAGE_HOME;
  }
  if (process.platform === "win32") {
    return path.join(os.homedir(), ".f6n-copilot-usage");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "f6n-copilot-usage");
  }
  return path.join(os.homedir(), ".f6n-copilot-usage");
}

export function resolvePaths(explicitPath?: string): AppPaths {
  const root = resolveCopilotUsageRoot(explicitPath);
  return {
    root,
    usageSummariesPath: path.join(root, "usage-summaries.jsonl"),
    sessionArchiveDir: path.join(root, "session-archive"),
    statePath: path.join(root, "state.json"),
    debugLogPath: path.join(root, "hook-debug.jsonl")
  };
}

export async function ensurePaths(paths: AppPaths): Promise<void> {
  await mkdir(paths.root, { recursive: true });
  await mkdir(paths.sessionArchiveDir, { recursive: true });
}

function createEmptyState(): UsageState {
  return {
    version: 1,
    repos: {}
  };
}

export async function loadUsageState(paths: AppPaths): Promise<UsageState> {
  try {
    const raw = await readFile(paths.statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`State root must be an object in ${paths.statePath}`);
    }
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1) {
      throw new Error(`Unsupported state version in ${paths.statePath}`);
    }
    const reposValue = record.repos;
    const repos: Record<string, RepoState> = {};
    if (reposValue && typeof reposValue === "object") {
      for (const [repoPath, entry] of Object.entries(reposValue)) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const entryRecord = entry as Record<string, unknown>;
        if (typeof entryRecord.hookFile !== "string") {
          continue;
        }
        repos[repoPath] = {
          hookFile: entryRecord.hookFile,
          updatedAt:
            typeof entryRecord.updatedAt === "string"
              ? entryRecord.updatedAt
              : new Date().toISOString()
        };
      }
    }
    return {
      version: 1,
      repos
    };
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return createEmptyState();
    }
    throw error;
  }
}

export async function saveUsageState(paths: AppPaths, state: UsageState): Promise<void> {
  await ensurePaths(paths);
  await writeFile(paths.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
