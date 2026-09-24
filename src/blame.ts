import { git } from "./git";

export interface BlameLine {
  /** 1-based line number in the current version of the file. */
  lineNumber: number;
  sha: string;
  /** Author name as recorded on the commit (git's "author" header). */
  author: string;
  content: string;
}

const HEADER_RE = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/;

/**
 * Run real `git blame --porcelain <file>` and parse it into one entry per
 * line of the file's current contents.
 *
 * Porcelain format refresher (see `git help blame`): each line-group starts
 * with a header `<sha> <orig-line> <final-line> [<num-lines>]`, followed by
 * zero or more `key value` metadata lines (author, author-mail, summary,
 * filename, ...), followed by exactly one line starting with a literal TAB
 * that holds the actual file content. Metadata lines are only emitted the
 * *first* time a given commit is seen in the output - on later occurrences
 * only the header + tab-content line appear. Rather than hard-coding that
 * rule, we simply treat "any non-tab-prefixed line right after the header"
 * as metadata (there may be zero of them), which is correct either way.
 */
export function blameFile(cwd: string, filePath: string): BlameLine[] {
  const output = git(["blame", "--porcelain", "--", filePath], { cwd });
  const lines = output.split("\n");

  const authorBySha = new Map<string, string>();
  const result: BlameLine[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.length === 0) {
      i++;
      continue;
    }
    const m = HEADER_RE.exec(line);
    if (!m) {
      // Not a header we recognize (shouldn't happen in well-formed output);
      // skip defensively rather than throw on unexpected input.
      i++;
      continue;
    }
    const sha = m[1];
    const finalLine = parseInt(m[3], 10);
    i++;

    let author = authorBySha.get(sha);
    while (i < lines.length && !lines[i].startsWith("\t")) {
      const metaLine = lines[i];
      const sp = metaLine.indexOf(" ");
      const key = sp === -1 ? metaLine : metaLine.slice(0, sp);
      const value = sp === -1 ? "" : metaLine.slice(sp + 1);
      if (key === "author") author = value;
      i++;
    }
    if (author !== undefined) authorBySha.set(sha, author);

    const contentLine = i < lines.length ? lines[i] : "";
    const rawContent = contentLine.startsWith("\t") ? contentLine.slice(1) : contentLine;
    // Defensive: strip a stray trailing \r in case the blob has CRLF line
    // endings (e.g. core.autocrlf variance across platforms/repos).
    const content = rawContent.endsWith("\r") ? rawContent.slice(0, -1) : rawContent;
    i++;

    result[finalLine - 1] = {
      lineNumber: finalLine,
      sha,
      author: author ?? "unknown",
      content,
    };
  }

  return result.filter(Boolean);
}

/** List all files tracked by git, optionally restricted to a path/pathspec. */
export function listTrackedFiles(cwd: string, pathspec?: string): string[] {
  const args = ["ls-files"];
  if (pathspec) args.push("--", pathspec);
  const output = git(args, { cwd });
  return output.split("\n").filter((l) => l.length > 0);
}
