import * as os from "node:os";
import { BlameLine, blameFileAsync, listTrackedFiles } from "./blame";
import { TrailerCache } from "./trailers";

/**
 * How many `git blame` child processes to have in flight at once. Bounded
 * (rather than one-per-file via Promise.all) so a repo with thousands of
 * files doesn't try to spawn thousands of concurrent git processes.
 */
const BLAME_CONCURRENCY = Math.max(2, os.cpus().length);

interface BlameResult {
  file: string;
  blamed: BlameLine[] | null; // null means the file couldn't be blamed (skip).
}

/** Blame `files` with at most `concurrency` `git blame` processes in flight. */
async function blameFilesConcurrently(
  cwd: string,
  files: string[],
  concurrency: number,
): Promise<BlameResult[]> {
  const results: BlameResult[] = new Array(files.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= files.length) return;
      const file = files[index];
      try {
        results[index] = { file, blamed: await blameFileAsync(cwd, file) };
      } catch {
        // Binary files, symlinks, submodules, etc. can't be blamed - skip.
        results[index] = { file, blamed: null };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

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
export async function computeStats(cwd: string, pathspec?: string): Promise<RepoStats> {
  const files = listTrackedFiles(cwd, pathspec);
  const cache = new TrailerCache(cwd);

  let totalLines = 0;
  let aiLines = 0;
  let filesScanned = 0;
  let filesSkipped = 0;
  const byAgent = new Map<string, number>();

  const blameResults = await blameFilesConcurrently(cwd, files, BLAME_CONCURRENCY);

  for (const { blamed } of blameResults) {
    if (blamed === null) {
      filesSkipped++;
      continue;
    }
    filesScanned++;
    for (const line of blamed) {
      totalLines++;
      // TrailerCache does its own synchronous git calls, but commit
      // lookups are memoized per sha, so repeated shas across files are free.
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
