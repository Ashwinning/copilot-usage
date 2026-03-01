import { appendFile, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendHookDebugLog } from "./debug-log.js";
import { AppPaths, ensurePaths } from "./state.js";
import { UsageRecord } from "./types.js";

interface ModelUsage {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

interface LatestSession {
  sessionId: string;
  eventsPath: string;
}

export interface StoreSessionResult {
  stored: boolean;
  message: string;
  sessionId?: string;
  archivePath?: string;
  usageEntries: number;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function normalizeTimestamp(value: unknown, fallbackIso: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return fallbackIso;
}

export function resolveCopilotHome(explicitHome?: string): string {
  if (explicitHome) {
    return explicitHome;
  }
  if (process.env.COPILOT_HOME) {
    return process.env.COPILOT_HOME;
  }
  if (process.env.XDG_STATE_HOME) {
    return path.join(process.env.XDG_STATE_HOME, ".copilot");
  }
  return path.join(os.homedir(), ".copilot");
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function usageRecordFromAssistantUsage(
  event: Record<string, unknown>,
  fallback: { sessionId: string; timestamp: string; model: string }
): UsageRecord | undefined {
  if (event.type !== "assistant.usage") {
    return undefined;
  }
  const data = event.data;
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const payload = data as Record<string, unknown>;
  const inputTokens = toNumber(payload.inputTokens);
  const cachedInputTokens = toNumber(payload.cacheReadTokens);
  const outputTokens = toNumber(payload.outputTokens);
  const reasoningTokens = toNumber(payload.reasoningOutputTokens);
  const explicitTotal = toNumber(payload.totalTokens);
  const totalTokens = Math.max(explicitTotal, inputTokens + outputTokens + reasoningTokens);
  if (
    inputTokens === 0 &&
    cachedInputTokens === 0 &&
    outputTokens === 0 &&
    reasoningTokens === 0 &&
    totalTokens === 0
  ) {
    return undefined;
  }
  return {
    app: "copilot",
    model: typeof payload.model === "string" && payload.model.trim().length > 0 ? payload.model : fallback.model,
    sessionId: fallback.sessionId,
    timestamp: normalizeTimestamp(event.timestamp, fallback.timestamp),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens
  };
}

function usageRecordsFromSessionShutdown(
  event: Record<string, unknown>,
  fallback: { sessionId: string; timestamp: string }
): UsageRecord[] {
  if (event.type !== "session.shutdown") {
    return [];
  }
  const data = event.data;
  if (!data || typeof data !== "object") {
    return [];
  }
  const modelMetrics = (data as Record<string, unknown>).modelMetrics;
  if (!modelMetrics || typeof modelMetrics !== "object") {
    return [];
  }
  const timestamp = normalizeTimestamp(event.timestamp, fallback.timestamp);
  const output: UsageRecord[] = [];
  for (const [model, metricsUnknown] of Object.entries(modelMetrics)) {
    if (!metricsUnknown || typeof metricsUnknown !== "object") {
      continue;
    }
    const metrics = metricsUnknown as Record<string, unknown>;
    const usageUnknown = metrics.usage;
    if (!usageUnknown || typeof usageUnknown !== "object") {
      continue;
    }
    const usage = usageUnknown as Record<string, unknown>;
    const inputTokens = toNumber(usage.inputTokens);
    const cachedInputTokens = toNumber(usage.cacheReadTokens);
    const outputTokens = toNumber(usage.outputTokens);
    const reasoningTokens = toNumber(usage.reasoningOutputTokens);
    const totalTokens = Math.max(toNumber(usage.totalTokens), inputTokens + outputTokens + reasoningTokens);
    if (
      inputTokens === 0 &&
      cachedInputTokens === 0 &&
      outputTokens === 0 &&
      reasoningTokens === 0 &&
      totalTokens === 0
    ) {
      continue;
    }
    output.push({
      app: "copilot",
      model,
      sessionId: fallback.sessionId,
      timestamp,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens
    });
  }
  return output;
}

function parseEventsContent(
  content: string,
  fallbackTimestamp: string,
  fallbackSessionId: string
): UsageRecord[] {
  let sessionId = fallbackSessionId;
  let currentModel = "unknown";
  const directUsageRecords: UsageRecord[] = [];
  const shutdownUsageRecords: UsageRecord[] = [];

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      continue;
    }
    const event = parsed as Record<string, unknown>;
    if (event.type === "session.start" && event.data && typeof event.data === "object") {
      const eventSessionId = (event.data as Record<string, unknown>).sessionId;
      if (typeof eventSessionId === "string" && eventSessionId.trim().length > 0) {
        sessionId = eventSessionId;
      }
    }
    if (event.type === "session.model_change" && event.data && typeof event.data === "object") {
      const newModel = (event.data as Record<string, unknown>).newModel;
      if (typeof newModel === "string" && newModel.trim().length > 0) {
        currentModel = newModel;
      }
    }

    const usageRecord = usageRecordFromAssistantUsage(event, {
      sessionId,
      timestamp: fallbackTimestamp,
      model: currentModel
    });
    if (usageRecord) {
      directUsageRecords.push(usageRecord);
      if (usageRecord.model !== "unknown") {
        currentModel = usageRecord.model;
      }
      continue;
    }
    shutdownUsageRecords.push(
      ...usageRecordsFromSessionShutdown(event, {
        sessionId,
        timestamp: fallbackTimestamp
      })
    );
  }
  return directUsageRecords.length > 0 ? directUsageRecords : shutdownUsageRecords;
}

async function parseEventsFile(filePath: string, fallbackSessionId: string): Promise<UsageRecord[]> {
  const fileStat = await stat(filePath);
  const content = await readFile(filePath, "utf8");
  return parseEventsContent(content, fileStat.mtime.toISOString(), fallbackSessionId);
}

function sessionIdFromArchiveName(fileName: string): string {
  const marker = fileName.indexOf("--");
  if (marker === -1) {
    return fileName.replace(/\.events\.jsonl$/u, "");
  }
  return fileName.slice(marker + 2).replace(/\.events\.jsonl$/u, "");
}

async function findLatestSession(copilotHome: string): Promise<LatestSession | undefined> {
  const sessionStateRoot = path.join(copilotHome, "session-state");
  if (!(await exists(sessionStateRoot))) {
    return undefined;
  }
  const entries = await readdir(sessionStateRoot, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const eventsPath = path.join(sessionStateRoot, entry.name, "events.jsonl");
        if (!(await exists(eventsPath))) {
          return undefined;
        }
        const details = await stat(eventsPath);
        return {
          sessionId: entry.name,
          eventsPath,
          mtimeMs: details.mtimeMs
        };
      })
  );
  const valid = candidates.filter((item): item is LatestSession & { mtimeMs: number } => Boolean(item));
  valid.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (valid.length === 0) {
    return undefined;
  }
  return {
    sessionId: valid[0].sessionId,
    eventsPath: valid[0].eventsPath
  };
}

function summarizeModelUsage(records: UsageRecord[]): ModelUsage[] {
  const byModel = new Map<string, ModelUsage>();
  for (const record of records) {
    const existing = byModel.get(record.model);
    if (existing) {
      existing.inputTokens += record.inputTokens;
      existing.cachedInputTokens += record.cachedInputTokens;
      existing.outputTokens += record.outputTokens;
      existing.reasoningTokens += record.reasoningTokens;
      existing.totalTokens += record.totalTokens;
      continue;
    }
    byModel.set(record.model, {
      model: record.model,
      inputTokens: record.inputTokens,
      cachedInputTokens: record.cachedInputTokens,
      outputTokens: record.outputTokens,
      reasoningTokens: record.reasoningTokens,
      totalTokens: record.totalTokens
    });
  }
  return [...byModel.values()];
}

function parseCompactTokenCount(raw: string): number {
  const normalized = raw.trim().toLowerCase().replace(/,/gu, "");
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([km])?$/u);
  if (!match) {
    return 0;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return 0;
  }
  const suffix = match[2];
  const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1;
  return Math.round(value * multiplier);
}

function parsePromptUsageSummary(output: string): ModelUsage[] {
  const usageByModel = new Map<string, ModelUsage>();
  const normalizedOutput = output.replace(/\u0007/gu, "");
  const lineRegex =
    /^\s*([A-Za-z0-9._:-]+)\s+([0-9][0-9.,]*(?:\.[0-9]+)?[kKmM]?)\s+in,\s+([0-9][0-9.,]*(?:\.[0-9]+)?[kKmM]?)\s+out,\s+([0-9][0-9.,]*(?:\.[0-9]+)?[kKmM]?)\s+cached\b.*$/gmu;
  for (const match of normalizedOutput.matchAll(lineRegex)) {
    const model = match[1];
    const inputTokens = parseCompactTokenCount(match[2]);
    const outputTokens = parseCompactTokenCount(match[3]);
    const cachedInputTokens = parseCompactTokenCount(match[4]);
    const totalTokens = inputTokens + outputTokens;
    const existing = usageByModel.get(model);
    if (existing) {
      existing.inputTokens += inputTokens;
      existing.outputTokens += outputTokens;
      existing.cachedInputTokens += cachedInputTokens;
      existing.totalTokens += totalTokens;
      continue;
    }
    usageByModel.set(model, {
      model,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens: 0,
      totalTokens
    });
  }
  return [...usageByModel.values()];
}

export async function storeLatestSession(paths: AppPaths, copilotHomeArg?: string): Promise<StoreSessionResult> {
  await ensurePaths(paths);
  const copilotHome = resolveCopilotHome(copilotHomeArg);
  await appendHookDebugLog(paths, "hook.store_session.invoked", {
    copilotHome,
    usageSummariesPath: paths.usageSummariesPath,
    sessionArchiveDir: paths.sessionArchiveDir
  });
  const latestSession = await findLatestSession(copilotHome);
  if (!latestSession) {
    const message = `No Copilot session files found under ${path.join(copilotHome, "session-state")}.`;
    await appendHookDebugLog(paths, "hook.store_session.no_latest_session", { copilotHome, message });
    return {
      stored: false,
      message,
      usageEntries: 0
    };
  }

  await appendHookDebugLog(paths, "hook.store_session.latest_session_found", {
    sessionId: latestSession.sessionId,
    eventsPath: latestSession.eventsPath
  });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const archivePath = path.join(paths.sessionArchiveDir, `${stamp}--${latestSession.sessionId}.events.jsonl`);
  const sourceContent = await readFile(latestSession.eventsPath, "utf8");
  await writeFile(archivePath, sourceContent, "utf8");
  const usageRecords = await parseEventsFile(archivePath, latestSession.sessionId);
  const modelUsage = summarizeModelUsage(usageRecords);
  await appendHookDebugLog(paths, "hook.store_session.parsed_usage", {
    sessionId: latestSession.sessionId,
    usageRecordCount: usageRecords.length,
    modelUsageCount: modelUsage.length,
    archivePath
  });

  await appendFile(
    paths.usageSummariesPath,
    `${JSON.stringify({
      type: "copilot.usage.capture",
      capturedAt: new Date().toISOString(),
      sessionId: latestSession.sessionId,
      sourceEventsPath: latestSession.eventsPath,
      archivePath,
      modelUsage
    })}\n`,
    "utf8"
  );
  await appendHookDebugLog(paths, "hook.store_session.summary_appended", {
    sessionId: latestSession.sessionId,
    usageSummariesPath: paths.usageSummariesPath,
    archivePath,
    modelUsageCount: modelUsage.length
  });

  return {
    stored: true,
    message: "Stored latest Copilot session data.",
    sessionId: latestSession.sessionId,
    archivePath,
    usageEntries: modelUsage.length
  };
}

export async function storePromptUsageFromOutput(
  paths: AppPaths,
  output: string
): Promise<StoreSessionResult> {
  await ensurePaths(paths);
  const modelUsage = parsePromptUsageSummary(output);
  if (modelUsage.length === 0) {
    return {
      stored: false,
      message: "No prompt usage summary found in copilot output.",
      usageEntries: 0
    };
  }

  const capturedAt = new Date().toISOString();
  const sessionId = `prompt-${capturedAt.replace(/[:.]/gu, "-")}`;
  await appendFile(
    paths.usageSummariesPath,
    `${JSON.stringify({
      type: "copilot.usage.capture",
      capturedAt,
      sessionId,
      sourceEventsPath: null,
      archivePath: null,
      source: "copilot.prompt.summary",
      modelUsage
    })}\n`,
    "utf8"
  );

  return {
    stored: true,
    message: "Stored Copilot prompt usage summary.",
    sessionId,
    usageEntries: modelUsage.length
  };
}

function usageRecordsFromCapturedSummary(entry: unknown, fallbackSessionId: string): UsageRecord[] {
  if (!entry || typeof entry !== "object") {
    return [];
  }
  const payload = entry as Record<string, unknown>;
  const modelUsage = Array.isArray(payload.modelUsage) ? payload.modelUsage : [];
  if (modelUsage.length === 0) {
    return [];
  }
  const timestamp = normalizeTimestamp(payload.capturedAt ?? payload.timestamp, new Date().toISOString());
  const sessionId =
    typeof payload.sessionId === "string" && payload.sessionId.trim().length > 0
      ? payload.sessionId
      : fallbackSessionId;

  const records: UsageRecord[] = [];
  for (const modelEntry of modelUsage) {
    if (!modelEntry || typeof modelEntry !== "object") {
      continue;
    }
    const usage = modelEntry as Record<string, unknown>;
    const model = typeof usage.model === "string" && usage.model.trim().length > 0 ? usage.model : "unknown";
    const inputTokens = toNumber(usage.inputTokens);
    const cachedInputTokens = toNumber(usage.cachedInputTokens);
    const outputTokens = toNumber(usage.outputTokens);
    const reasoningTokens = toNumber(usage.reasoningTokens);
    const totalTokens = Math.max(toNumber(usage.totalTokens), inputTokens + outputTokens + reasoningTokens);
    if (
      inputTokens === 0 &&
      cachedInputTokens === 0 &&
      outputTokens === 0 &&
      reasoningTokens === 0 &&
      totalTokens === 0
    ) {
      continue;
    }
    records.push({
      app: "copilot",
      model,
      sessionId,
      timestamp,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens
    });
  }
  return records;
}

async function parseCapturedSummaryFile(filePath: string): Promise<UsageRecord[]> {
  const content = await readFile(filePath, "utf8");
  const records: UsageRecord[] = [];
  let rowIndex = 0;
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    rowIndex += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    records.push(...usageRecordsFromCapturedSummary(parsed, `capture-${rowIndex}`));
  }
  return records;
}

export async function readStoredCopilotUsage(paths: AppPaths): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  if (await exists(paths.usageSummariesPath)) {
    records.push(...(await parseCapturedSummaryFile(paths.usageSummariesPath)));
  }

  if (await exists(paths.sessionArchiveDir)) {
    const entries = await readdir(paths.sessionArchiveDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".events.jsonl")) {
        continue;
      }
      const fallbackSessionId = sessionIdFromArchiveName(entry.name);
      const fullPath = path.join(paths.sessionArchiveDir, entry.name);
      records.push(...(await parseEventsFile(fullPath, fallbackSessionId)));
    }
  }

  const deduped = new Map<string, UsageRecord>();
  for (const record of records) {
    const key = [
      record.app,
      record.model,
      record.sessionId,
      record.timestamp,
      record.inputTokens,
      record.cachedInputTokens,
      record.outputTokens,
      record.reasoningTokens,
      record.totalTokens
    ].join("|");
    deduped.set(key, record);
  }
  return [...deduped.values()];
}
