import { git } from "./git";
import { appendTrailers } from "./trailers";

export interface CommitOptions {
  message: string;
  agent: string;
  model?: string;
  session?: string;
}

/**
 * Produce a real, well-formed commit whose message carries the AI Blame
 * trailers, using git's own `interpret-trailers` to append them (so the
 * result is guaranteed to be something `git log` / `git interpret-trailers
 * --parse` recognize natively - not a hand-rolled string template).
 */
export function makeCommit(cwd: string, options: CommitOptions): string {
  const finalMessage = appendTrailers(cwd, options.message, {
    agent: options.agent,
    model: options.model,
    session: options.session,
  });
  git(["commit", "-F", "-"], { cwd, input: finalMessage });
  return git(["rev-parse", "HEAD"], { cwd }).trim();
}
