#!/usr/bin/env node
import { buildReport, formatReportLine } from "./report";
import { computeStats, formatStats } from "./stats";
import { makeCommit } from "./commit";

const USAGE = `ai-blame - git blame, extended with AI-agent provenance

Usage:
  ai-blame <file>                                 show per-line AI/human attribution for <file>
  ai-blame stats [path]                            repo-wide AI vs. human line percentage
  ai-blame commit -m <message> --agent <agent> [--model <model>] [--session <id>]
                                                    make a commit with Ai-Agent/Ai-Model/Ai-Session trailers

Options:
  -h, --help       show this help
  -v, --version     show version
`;

function printUsage(stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(USAGE);
}

function runReport(cwd: string, filePath: string, out: NodeJS.WriteStream): number {
  const report = buildReport(cwd, filePath);
  for (const line of report) {
    out.write(formatReportLine(line) + "\n");
  }
  return 0;
}

function runStats(cwd: string, path: string | undefined, out: NodeJS.WriteStream): number {
  const stats = computeStats(cwd, path);
  out.write(formatStats(stats) + "\n");
  return 0;
}

interface ParsedCommitArgs {
  message?: string;
  agent?: string;
  model?: string;
  session?: string;
}

function parseCommitArgs(args: string[]): ParsedCommitArgs {
  const parsed: ParsedCommitArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const takeValue = () => {
      const value = args[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "-m":
      case "--message":
        parsed.message = takeValue();
        break;
      case "--agent":
        parsed.agent = takeValue();
        break;
      case "--model":
        parsed.model = takeValue();
        break;
      case "--session":
        parsed.session = takeValue();
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return parsed;
}

function runCommit(cwd: string, args: string[], out: NodeJS.WriteStream): number {
  const parsed = parseCommitArgs(args);
  if (!parsed.message) throw new Error("commit requires -m/--message <message>");
  if (!parsed.agent) throw new Error("commit requires --agent <agent>");
  const sha = makeCommit(cwd, {
    message: parsed.message,
    agent: parsed.agent,
    model: parsed.model,
    session: parsed.session,
  });
  out.write(`Committed ${sha.slice(0, 12)} with Ai-Agent: ${parsed.agent}` +
    (parsed.model ? `, Ai-Model: ${parsed.model}` : "") +
    (parsed.session ? `, Ai-Session: ${parsed.session}` : "") +
    "\n");
  return 0;
}

export function main(argv: string[], cwd: string = process.cwd(), out: NodeJS.WriteStream = process.stdout, err: NodeJS.WriteStream = process.stderr): number {
  const [command, ...rest] = argv;

  if (!command || command === "-h" || command === "--help") {
    printUsage(out);
    return command ? 0 : 1;
  }
  if (command === "-v" || command === "--version") {
    out.write(require("../package.json").version + "\n");
    return 0;
  }

  try {
    if (command === "stats") {
      return runStats(cwd, rest[0], out);
    }
    if (command === "commit") {
      return runCommit(cwd, rest, out);
    }
    // Default command: treat the first argument as a file path.
    return runReport(cwd, command, out);
  } catch (e: any) {
    err.write(`ai-blame: ${e?.message ?? e}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
