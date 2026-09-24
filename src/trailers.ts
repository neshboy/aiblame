import { git } from "./git";

/**
 * The AI Blame commit-trailer convention.
 *
 * A commit is considered "AI-attributed" when its message contains an
 * `Ai-Agent` trailer (a standard git trailer: a `Key: value` line in the
 * trailer block at the end of the commit message, separated from the
 * subject/body by a blank line - see `git help interpret-trailers`).
 *
 *   Ai-Agent:   <required>  identifier of the agent/tool, e.g. "claude-code"
 *   Ai-Model:   <optional>  model identifier, e.g. "claude-sonnet-5"
 *   Ai-Session: <optional>  free-form session/conversation id
 */
export const AI_AGENT_TRAILER = "Ai-Agent";
export const AI_MODEL_TRAILER = "Ai-Model";
export const AI_SESSION_TRAILER = "Ai-Session";

export interface CommitTrailers {
  agent: string | null;
  model: string | null;
  session: string | null;
}

const EMPTY_TRAILERS: CommitTrailers = { agent: null, model: null, session: null };

/**
 * Extract AI Blame trailers from a raw commit message body.
 *
 * This shells out to the *real* `git interpret-trailers --parse` (a
 * convenience alias for `--only-trailers --only-input --unfold`) so the
 * actual trailer-block detection, unfolding and key/value splitting is done
 * by git itself, not re-implemented/guessed here. We only split the
 * already-canonicalized `Key: value` lines it prints back.
 */
export function parseTrailersFromMessage(cwd: string, message: string): CommitTrailers {
  const output = git(["interpret-trailers", "--parse"], { cwd, input: message });
  const result: CommitTrailers = { ...EMPTY_TRAILERS };
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key.toLowerCase() === AI_AGENT_TRAILER.toLowerCase()) result.agent = value || null;
    else if (key.toLowerCase() === AI_MODEL_TRAILER.toLowerCase()) result.model = value || null;
    else if (key.toLowerCase() === AI_SESSION_TRAILER.toLowerCase()) result.session = value || null;
  }
  return result;
}

/** Fetch the raw commit message body (`%B`) for a single commit sha. */
export function commitMessage(cwd: string, sha: string): string {
  return git(["log", "-1", "--format=%B", sha], { cwd });
}

/**
 * Get AI Blame trailers for a commit, with a per-run cache so repeated
 * lookups of the same commit (common across a file's blame, or across many
 * files in `stats`) only shell out to git once per unique commit.
 */
export class TrailerCache {
  private cache = new Map<string, CommitTrailers>();

  constructor(private readonly cwd: string) {}

  get(sha: string): CommitTrailers {
    const cached = this.cache.get(sha);
    if (cached) return cached;
    const message = commitMessage(this.cwd, sha);
    const trailers = parseTrailersFromMessage(this.cwd, message);
    this.cache.set(sha, trailers);
    return trailers;
  }
}

/** Build a well-formed commit message with AI Blame trailers appended. */
export function appendTrailers(
  cwd: string,
  baseMessage: string,
  trailers: { agent: string; model?: string; session?: string },
): string {
  const args = ["interpret-trailers", "--trailer", `${AI_AGENT_TRAILER}: ${trailers.agent}`];
  if (trailers.model) {
    args.push("--trailer", `${AI_MODEL_TRAILER}: ${trailers.model}`);
  }
  if (trailers.session) {
    args.push("--trailer", `${AI_SESSION_TRAILER}: ${trailers.session}`);
  }
  return git(args, { cwd, input: baseMessage });
}
