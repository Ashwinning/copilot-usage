import { appendFile } from "node:fs/promises";
import { AppPaths } from "./state.js";

function normalizeDebugValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }
  return value;
}

export async function appendHookDebugLog(
  paths: AppPaths,
  stage: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    stage,
    ...Object.fromEntries(Object.entries(details).map(([key, value]) => [key, normalizeDebugValue(value)]))
  };
  try {
    await appendFile(paths.debugLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[copilot-usage] debug log write failed: ${message}\n`);
  }
}
