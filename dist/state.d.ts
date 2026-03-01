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
export declare function resolveCopilotUsageRoot(explicitPath?: string): string;
export declare function resolvePaths(explicitPath?: string): AppPaths;
export declare function ensurePaths(paths: AppPaths): Promise<void>;
export declare function loadUsageState(paths: AppPaths): Promise<UsageState>;
export declare function saveUsageState(paths: AppPaths, state: UsageState): Promise<void>;
