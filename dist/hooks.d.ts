interface HookDiscoveryResult {
    enabled: boolean;
    hookFilePath?: string;
}
export declare function findRepoRoot(startDirectory: string): Promise<string>;
export declare function discoverHook(repoRoot: string, preferredHookFile?: string): Promise<HookDiscoveryResult>;
export declare function installHook(repoRoot: string): Promise<string>;
export {};
