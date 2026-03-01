export type UsageApp = "copilot";
export interface UsageRecord {
    app: UsageApp;
    model: string;
    sessionId: string;
    timestamp: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
}
export interface PeriodSummary {
    period: string;
    app: UsageApp;
    model: string;
    sessions: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
}
export interface SessionSummary {
    day: string;
    app: UsageApp;
    model: string;
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
}
