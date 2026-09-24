# AI Blame

`git blame`, extended with AI-agent provenance.

As AI coding agents write more and more of the code in real repositories,
"who wrote this line" is quietly turning into "was this line written by a
human or by an agent, and which one, running which model?" AI Blame answers
that with a small, documented git commit-trailer convention plus a real CLI
that correlates real `git blame` output with real commit trailers - no
external database, no editor plugin, no changes to how git itself works.

It ships two things:

1. **A convention**: three optional git [trailers](https://git-scm.com/docs/git-interpret-trailers)
   (`Ai-Agent`, `Ai-Model`, `Ai-Session`) that any tool can add to commit
   messages it produces, and any tool can read back with plain `git log` /
   `git interpret-trailers`.
2. **A CLI** (`ai-blame`) that reads real git history - `git log` for
   trailers, `git blame --porcelain` for per-line authorship - and reports,
   line by line, which lines were last touched by which agent/model/session,
   and which were touched by a human.

## The trailer convention

Any commit can carry these trailers in its message, in the blank-line-separated
trailer block at the end of the message body (exactly like `Signed-off-by` or
`Co-authored-by` - this is standard git, not something AI Blame invents):

```
<subject line>

<optional body>

Ai-Agent: claude-code
Ai-Model: claude-sonnet-5
Ai-Session: 5f2c1a9e-...
```

| Trailer      | Required | Meaning                                                              |
| ------------ | -------- | --------------------------------------------------------------------|
| `Ai-Agent`   | yes      | Identifier of the agent/tool that authored the change (free-form, e.g. `claude-code`, `cursor`, `copilot-workspace`). |
| `Ai-Model`   | no       | Identifier of the underlying model (e.g. `claude-sonnet-5`, `gpt-5`). |
| `Ai-Session` | no       | Free-form session/conversation/run id, for tying a commit back to a specific agent run. |

A commit with **no** `Ai-Agent` trailer is treated as a plain human commit.
Because this is a real git trailer block, it's readable without AI Blame at
all:

```sh
git log --format=%B -1 <sha> | git interpret-trailers --parse
```

Any tool, in any language, can adopt this convention just by appending the
same trailer block to its own commits - AI Blame doesn't need to be involved
in making the commit for it to later be recognized.

## Install

```sh
npm install
npm run build
npm link   # optional: puts `ai-blame` on your PATH
```

(Requires Node.js 18+ and a real `git` binary on `PATH`.)

## Quick start

```sh
# Make a commit with AI Blame trailers (a thin wrapper around `git commit`
# that appends a correctly-formed trailer block via `git interpret-trailers`):
ai-blame commit -m "Refactor the parser" \
  --agent claude-code --model claude-sonnet-5 --session my-session-id

# See who/what last touched each line of a file:
ai-blame src/parser.ts
#    12  [human: Jane Doe]              function parse(input: string) {
#    13  [claude-code/claude-sonnet-5]    const tokens = tokenize(input);
#    14  [claude-code/claude-sonnet-5]    return buildTree(tokens);
#    15  [human: Jane Doe]              }

# Repo-wide (or path-scoped) AI vs. human line percentage:
ai-blame stats
# Files scanned: 42
# Total lines:   9134
# AI-attributed:    3021 (33.1%)
# Human-attributed: 6113 (66.9%)
#
# By agent:
#   claude-code/claude-sonnet-5: 2810 lines
#   copilot: 211 lines

ai-blame stats src/   # scope stats to a subtree
```

You don't have to use `ai-blame commit` to benefit from this - any commit,
from any tool, that includes an `Ai-Agent` trailer will be picked up by
`ai-blame <file>` and `ai-blame stats`.

## How it works

- `ai-blame <file>` runs real `git blame --porcelain <file>`, which gives the
  exact commit SHA that last touched every line (this is git's own blame
  algorithm - AI Blame does not reimplement it). For each distinct commit
  SHA it encounters, it fetches the commit's message (`git log --format=%B`)
  and hands that message to the real `git interpret-trailers --parse` to
  extract the `Ai-Agent`/`Ai-Model`/`Ai-Session` trailers - the trailer-block
  detection and parsing is done by git itself, not guessed at. Results are
  cached per commit SHA per run.
- `ai-blame stats [path]` lists every real tracked file (`git ls-files`,
  optionally scoped to `path`), blames each one, and tallies AI- vs.
  human-attributed lines the same way.
- `ai-blame commit -m <message> --agent <agent> [--model <model>] [--session <id>]`
  pipes your message through `git interpret-trailers --trailer "Ai-Agent: ..."`
  (and `Ai-Model`/`Ai-Session` if given) to append a well-formed trailer
  block, then runs a real `git commit -F -` with the result. The output is
  ordinary git history: `git log`, `git show`, and `git interpret-trailers`
  all read it natively.

Everything shells out to the real `git` binary via Node's
`child_process.execFileSync` with argv arrays (never an interpolated shell
string), so arguments can't be reinterpreted by a shell.

## Limitations

- **Only forward-looking.** AI Blame can only report provenance for commits
  that actually carry the trailer convention. It cannot retroactively figure
  out which lines in your existing history were AI-written if those commits
  never recorded it - there is no way to reconstruct that after the fact.
- **Attribution moves with the line, like normal `git blame`.** If a line
  written by an agent is later edited by a human commit (or vice versa),
  `ai-blame` will report whoever's commit last touched that line - exactly
  like `git blame` itself. It shows current attribution, not a full history
  of every hand that has ever touched a line (use `git log -L` /
  `git blame -w` upstream of a line for that).
- **The convention is self-reported.** Nothing stops a human from adding an
  `Ai-Agent` trailer to their own commit, or an agent from omitting it.
  AI Blame reports what the trailers say, the same way `git blame` reports
  whatever name/email is in the commit's author field.
- **No rename/merge-history heroics beyond what `git blame` already does.**
  AI Blame relies entirely on stock `git blame` for line-level attribution,
  so its behavior around renames, merges and binary files is exactly git's.
- **Trailer matching is by exact key name** (`Ai-Agent`, `Ai-Model`,
  `Ai-Session`, case-insensitive), via `git interpret-trailers --parse`. A
  typo'd key won't be picked up.

## Development

```sh
npm install
npm test     # builds (tsc) then runs the vitest suite against real, throwaway
             # git repos created and committed to on the fly
```

## License

MIT - see [LICENSE](./LICENSE).
