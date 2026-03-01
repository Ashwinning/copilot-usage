import { AppPaths } from "./state.js";
import { UsageRecord } from "./types.js";
export interface StoreSessionResult {
    stored: boolean;
    message: string;
    sessionId?: string;
    archivePath?: string;
    usageEntries: number;
}
export declare function resolveCopilotHome(explicitHome?: string): string;
export declare function storeLatestSession(paths: AppPaths, copilotHomeArg?: string): Promise<StoreSessionResult>;
export declare function storePromptUsageFromOutput(paths: AppPaths, output: string): Promise<StoreSessionResult>;
export declare function readStoredCopilotUsage(paths: AppPaths): Promise<UsageRecord[]>;
