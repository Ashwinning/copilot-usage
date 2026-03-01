import { PeriodSummary, SessionSummary, UsageRecord } from "./types.js";
export declare function aggregateMonthly(records: UsageRecord[]): PeriodSummary[];
export declare function aggregateDaily(records: UsageRecord[]): PeriodSummary[];
export declare function aggregateSessions(records: UsageRecord[]): SessionSummary[];
