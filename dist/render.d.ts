import { PeriodSummary, SessionSummary } from "./types.js";
export type UsageTableView = "monthly" | "daily" | "sessions";
export declare function renderSingleUsageTable(view: UsageTableView, monthly: PeriodSummary[], daily: PeriodSummary[], sessions: SessionSummary[]): string;
