import { blameFile } from "./blame";
import { TrailerCache, CommitTrailers } from "./trailers";

export interface ReportLine {
  lineNumber: number;
  sha: string;
  isAi: boolean;
  agent: string | null;
  model: string | null;
  session: string | null;
  author: string;
  content: string;
  label: string;
}

/** Human-readable `[agent/model]` or `[human: Name]` attribution label. */
export function formatLabel(trailers: CommitTrailers, author: string): string {
  if (trailers.agent) {
    return trailers.model ? `[${trailers.agent}/${trailers.model}]` : `[${trailers.agent}]`;
  }
  return `[human: ${author}]`;
}

/**
 * Build a per-line provenance report for `filePath`: real `git blame`
 * correlated with the real AI Blame trailers of the commit that last
 * touched each line.
 */
export function buildReport(cwd: string, filePath: string, cache = new TrailerCache(cwd)): ReportLine[] {
  const blameLines = blameFile(cwd, filePath);
  return blameLines.map((line) => {
    const trailers = cache.get(line.sha);
    return {
      lineNumber: line.lineNumber,
      sha: line.sha,
      isAi: trailers.agent !== null,
      agent: trailers.agent,
      model: trailers.model,
      session: trailers.session,
      author: line.author,
      content: line.content,
      label: formatLabel(trailers, line.author),
    };
  });
}

/** Render a report the way the CLI prints it: `<line#> <label> <content>`. */
export function formatReportLine(line: ReportLine): string {
  const lineNo = String(line.lineNumber).padStart(4, " ");
  return `${lineNo}  ${line.label}  ${line.content}`;
}
