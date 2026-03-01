const formatNumber = (value) => value.toLocaleString("en-US");
function renderTable(title, headers, rows) {
    if (rows.length === 0) {
        return `${title}\n(no data)\n`;
    }
    const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
    const divider = `+${widths.map((w) => "-".repeat(w + 2)).join("+")}+`;
    const line = (row) => `| ${row.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`;
    return [title, divider, line(headers), divider, ...rows.map((row) => line(row)), divider, ""].join("\n");
}
function periodRows(summaries) {
    return summaries.map((summary) => [
        summary.period,
        summary.app,
        summary.model,
        String(summary.sessions),
        formatNumber(summary.inputTokens),
        formatNumber(summary.cachedInputTokens),
        formatNumber(summary.outputTokens),
        formatNumber(summary.reasoningTokens),
        formatNumber(summary.totalTokens)
    ]);
}
function sessionRows(summaries) {
    return summaries.map((summary) => [
        summary.day,
        summary.app,
        summary.model,
        summary.sessionId,
        formatNumber(summary.inputTokens),
        formatNumber(summary.cachedInputTokens),
        formatNumber(summary.outputTokens),
        formatNumber(summary.reasoningTokens),
        formatNumber(summary.totalTokens)
    ]);
}
export function renderSingleUsageTable(view, monthly, daily, sessions) {
    if (view === "monthly") {
        return renderTable("Monthly token usage (copilot by model)", ["Month", "App", "Model", "Sessions", "Input", "Cached", "Output", "Reasoning", "Total"], periodRows(monthly));
    }
    if (view === "daily") {
        return renderTable("Daily token usage (copilot by model)", ["Day", "App", "Model", "Sessions", "Input", "Cached", "Output", "Reasoning", "Total"], periodRows(daily));
    }
    return renderTable("Session token usage (copilot by model)", ["Day", "App", "Model", "Session", "Input", "Cached", "Output", "Reasoning", "Total"], sessionRows(sessions));
}
//# sourceMappingURL=render.js.map