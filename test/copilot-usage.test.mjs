import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { discoverHook, installHook } from "../dist/hooks.js";
import { readStoredCopilotUsage, storeLatestSession, storePromptUsageFromOutput } from "../dist/copilot.js";
import { resolvePaths } from "../dist/state.js";

test("installHook creates discoverable sessionEnd hook", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f6n-copilot-usage-hook-"));
  try {
    const hookFile = await installHook(root);
    const discovery = await discoverHook(root);
    const hookRaw = await readFile(hookFile, "utf8");
    assert.equal(discovery.enabled, true);
    assert.equal(discovery.hookFilePath, hookFile);
    assert.match(hookRaw, /--f6n-store-session/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("storeLatestSession captures usage and readStoredCopilotUsage returns records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f6n-copilot-usage-data-"));
  const copilotHome = path.join(root, "copilot-home");
  const stateHome = path.join(root, "state-home");
  const sessionDir = path.join(copilotHome, "session-state", "session-1");
  try {
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "events.jsonl"),
      [
        JSON.stringify({
          type: "session.start",
          timestamp: "2026-02-28T17:00:00.000Z",
          data: { sessionId: "s-1" }
        }),
        JSON.stringify({
          type: "assistant.usage",
          timestamp: "2026-02-28T17:01:00.000Z",
          data: {
            model: "gpt-5.3-codex",
            inputTokens: 10,
            cacheReadTokens: 1,
            outputTokens: 5,
            reasoningOutputTokens: 2,
            totalTokens: 17
          }
        })
      ].join("\n"),
      "utf8"
    );

    const paths = resolvePaths(stateHome);
    const result = await storeLatestSession(paths, copilotHome);
    assert.equal(result.stored, true);
    assert.equal(result.usageEntries, 1);

    const usage = await readStoredCopilotUsage(paths);
    assert.equal(usage.length > 0, true);
    assert.equal(usage[0].app, "copilot");
    assert.equal(usage[0].totalTokens, 17);

    const summariesRaw = await readFile(paths.usageSummariesPath, "utf8");
    assert.match(summariesRaw, /copilot\.usage\.capture/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("storePromptUsageFromOutput captures non-interactive usage summary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f6n-copilot-usage-prompt-"));
  const stateHome = path.join(root, "state-home");
  try {
    const paths = resolvePaths(stateHome);
    const output = [
      "Total usage est:        0 Premium requests",
      "Breakdown by AI model:",
      " gpt-4.1                 20.9k in, 4 out, 5.8k cached (Est. 0 Premium requests)"
    ].join("\n");
    const result = await storePromptUsageFromOutput(paths, output);
    assert.equal(result.stored, true);
    assert.equal(result.usageEntries, 1);

    const usage = await readStoredCopilotUsage(paths);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].model, "gpt-4.1");
    assert.equal(usage[0].inputTokens, 20_900);
    assert.equal(usage[0].cachedInputTokens, 5_800);
    assert.equal(usage[0].outputTokens, 4);
    assert.equal(usage[0].totalTokens, 20_904);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
