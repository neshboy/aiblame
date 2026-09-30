import { execFile, execFileSync } from "node:child_process";

/**
 * Thin, safe wrapper around the real `git` binary.
 *
 * Always invoked via execFileSync with an argv array (never a shell string),
 * so arguments can never be re-interpreted by a shell.
 */

export interface GitOptions {
  cwd: string;
  /** Optional data to pipe to the child process's stdin. */
  input?: string;
}

export class GitError extends Error {
  constructor(
    message: string,
    public readonly args: string[],
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

/** Run `git <args>` and return trimmed-free raw stdout as a string. */
export function git(args: string[], options: GitOptions): string {
  try {
    const result = execFileSync("git", args, {
      cwd: options.cwd,
      input: options.input,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 256,
    });
    return result;
  } catch (err: any) {
    const stderr = err?.stderr?.toString?.() ?? String(err?.message ?? err);
    throw new GitError(`git ${args.join(" ")} failed: ${stderr}`, args, stderr);
  }
}

/**
 * Async twin of `git()`, for call sites that blame/inspect many objects and
 * want to run several `git` child processes concurrently instead of paying
 * each spawn's latency serially (see `computeStats`).
 *
 * `execFile`'s callback/promise form has no `input` option (that's a
 * `*Sync`-only convenience), so stdin is written and closed by hand when
 * `options.input` is provided.
 */
export function gitAsync(args: string[], options: GitOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      { cwd: options.cwd, encoding: "utf8", maxBuffer: 1024 * 1024 * 256 },
      (err, stdout, stderr) => {
        if (err) {
          const stderrText = stderr?.toString?.() ?? String(err?.message ?? err);
          reject(new GitError(`git ${args.join(" ")} failed: ${stderrText}`, args, stderrText));
          return;
        }
        resolve(stdout.toString());
      },
    );
    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}

/** Run `git <args>`, returning null instead of throwing if git exits non-zero. */
export function gitOrNull(args: string[], options: GitOptions): string | null {
  try {
    return git(args, options);
  } catch {
    return null;
  }
}

/** Resolve the top-level directory of the git repo containing `cwd`. */
export function repoRoot(cwd: string): string {
  return git(["rev-parse", "--show-toplevel"], { cwd }).trim();
}
