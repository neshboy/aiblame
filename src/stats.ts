import { blameFile, listTrackedFiles } from "./blame";
import { TrailerCache } from "./trailers";

export interface AgentBreakdownEntry {
  key: string; // "claude-code/claude-sonnet-5" or "claude-code"
  lines: number;
}

export interface RepoStats {
  filesScanned: number;
  filesSkipped: number;
  totalLines: number;
  aiLines: number;
  humanLines: number;
  aiPercent: number;
  humanPercent: number;
  byAgent: AgentBreakdownEntry[];
}

/**
 * Walk every real tracked file under `pathspec` (or the whole repo), blame
 * each one for real, and tally AI-attributed vs. human-attributed lines
 * repo-wide based on each blamed commit's real trailers.
 */
export function computeStats(cwd: string, pathspec?: string): RepoStats {
  const files = listTrackedFiles(cwd, pathspec);
  const cache = new TrailerCache(cwd);

  let totalLines = 0;
  let aiLines = 0;
  let filesScanned = 0;
  let filesSkipped = 0;
  const byAgent = new Map<string, number>();

  for (const file of files) {
    let blamed;
    try {
      blamed = blameFile(cwd, file);
    } catch {
      // Binary files, symlinks, submodules, etc. can't be blamed - skip.
      filesSkipped++;
      continue;
    }
    filesScanned++;
    for (const line of blamed) {
      totalLines++;
      const trailers = cache.get(line.sha);
      if (trailers.agent) {
        aiLines++;
        const key = trailers.model ? `${trailers.agent}/${trailers.model}` : trailers.agent;
        byAgent.set(key, (byAgent.get(key) ?? 0) + 1);
      }
    }
  }

  const humanLines = totalLines - aiLines;
  const aiPercent = totalLines === 0 ? 0 : (aiLines / totalLines) * 100;
  const humanPercent = totalLines === 0 ? 0 : (humanLines / totalLines) * 100;

  return {
    filesScanned,
    filesSkipped,
    totalLines,
    aiLines,
    humanLines,
    aiPercent,
    humanPercent,
    byAgent: [...byAgent.entries()]
      .map(([key, lines]) => ({ key, lines }))
      .sort((a, b) => b.lines - a.lines),
  };
}

export function formatStats(stats: RepoStats): string {
  const pct = (n: number) => n.toFixed(1) + "%";
  const lines: string[] = [];
  lines.push(`Files scanned: ${stats.filesScanned}${stats.filesSkipped ? ` (${stats.filesSkipped} skipped)` : ""}`);
  lines.push(`Total lines:   ${stats.totalLines}`);
  lines.push(`AI-attributed:    ${stats.aiLines} (${pct(stats.aiPercent)})`);
  lines.push(`Human-attributed: ${stats.humanLines} (${pct(stats.humanPercent)})`);
  if (stats.byAgent.length > 0) {
    lines.push("");
    lines.push("By agent:");
    for (const entry of stats.byAgent) {
      lines.push(`  ${entry.key}: ${entry.lines} lines`);
    }
  }
  return lines.join("\n");
}
