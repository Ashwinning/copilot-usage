import { PeriodSummary, SessionSummary, UsageRecord } from "./types.js";

interface Bucket extends Omit<PeriodSummary, "sessions"> {
  sessions: Set<string>;
}

function sortByPeriod(a: PeriodSummary, b: PeriodSummary): number {
  return (
    b.period.localeCompare(a.period) ||
    a.app.localeCompare(b.app) ||
    a.model.localeCompare(b.model)
  );
}

function groupByPeriod(
  records: UsageRecord[],
  getPeriod: (isoTimestamp: string) => string
): PeriodSummary[] {
  const buckets = new Map<string, Bucket>();
  for (const record of records) {
    const period = getPeriod(record.timestamp);
    const key = `${period}|${record.app}|${record.model}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.inputTokens += record.inputTokens;
      existing.outputTokens += record.outputTokens;
      existing.cachedInputTokens += record.cachedInputTokens;
      existing.reasoningTokens += record.reasoningTokens;
      existing.totalTokens += record.totalTokens;
      existing.sessions.add(record.sessionId);
      continue;
    }

    buckets.set(key, {
      period,
      app: record.app,
      model: record.model,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cachedInputTokens: record.cachedInputTokens,
      reasoningTokens: record.reasoningTokens,
      totalTokens: record.totalTokens,
      sessions: new Set([record.sessionId])
    });
  }

  return [...buckets.values()]
    .map((bucket) => ({ ...bucket, sessions: bucket.sessions.size }))
    .sort(sortByPeriod);
}

export function aggregateMonthly(records: UsageRecord[]): PeriodSummary[] {
  return groupByPeriod(records, (timestamp) => timestamp.slice(0, 7));
}

export function aggregateDaily(records: UsageRecord[]): PeriodSummary[] {
  return groupByPeriod(records, (timestamp) => timestamp.slice(0, 10));
}

export function aggregateSessions(records: UsageRecord[]): SessionSummary[] {
  const buckets = new Map<string, SessionSummary>();
  for (const record of records) {
    const key = `${record.app}|${record.model}|${record.sessionId}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.inputTokens += record.inputTokens;
      existing.outputTokens += record.outputTokens;
      existing.cachedInputTokens += record.cachedInputTokens;
      existing.reasoningTokens += record.reasoningTokens;
      existing.totalTokens += record.totalTokens;
      continue;
    }

    buckets.set(key, {
      day: record.timestamp.slice(0, 10),
      app: record.app,
      model: record.model,
      sessionId: record.sessionId,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cachedInputTokens: record.cachedInputTokens,
      reasoningTokens: record.reasoningTokens,
      totalTokens: record.totalTokens
    });
  }

  return [...buckets.values()].sort(
    (a, b) =>
      b.day.localeCompare(a.day) ||
      a.app.localeCompare(b.app) ||
      a.model.localeCompare(b.model) ||
      a.sessionId.localeCompare(b.sessionId)
  );
}
