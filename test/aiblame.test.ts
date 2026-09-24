import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildReport } from "../src/report";
import { computeStats } from "../src/stats";
import { makeCommit } from "../src/commit";

/** Run real git in the scratch repo. Never a shell string - argv array only. */
function git(cwd: string, args: string[], input?: string): string {
  return execFileSync("git", args, { cwd, input, encoding: "utf8" });
}

describe("ai-blame", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "aiblame-test-"));
    git(repo, ["init", "-q"]);
    git(repo, ["config", "user.name", "Jane Doe"]);
    git(repo, ["config", "user.email", "jane@example.com"]);
    // Deterministic line endings regardless of the host's global git config.
    git(repo, ["config", "core.autocrlf", "false"]);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("attributes every line to the human author when a commit carries no AI Blame trailers", () => {
    fs.writeFileSync(path.join(repo, "file.txt"), "alpha\nbeta\ngamma\n");
    git(repo, ["add", "file.txt"]);
    git(repo, ["commit", "-q", "-m", "plain human commit"]);

    const report = buildReport(repo, "file.txt");
    expect(report).toHaveLength(3);
    expect(report.map((l) => l.content)).toEqual(["alpha", "beta", "gamma"]);
    for (const line of report) {
      expect(line.isAi).toBe(false);
      expect(line.agent).toBeNull();
      expect(line.author).toBe("Jane Doe");
      expect(line.label).toBe("[human: Jane Doe]");
    }
  });

  it("attributes specific lines to the AI agent/model/session recorded via ai-blame commit", () => {
    fs.writeFileSync(path.join(repo, "file.txt"), "alpha\nbeta\ngamma\n");
    git(repo, ["add", "file.txt"]);
    git(repo, ["commit", "-q", "-m", "plain human commit"]);

    fs.writeFileSync(path.join(repo, "file.txt"), "alpha\nBETA-changed\ngamma\ndelta\n");
    git(repo, ["add", "file.txt"]);
    const sha = makeCommit(repo, {
      message: "AI edits line 2 and adds line 4",
      agent: "claude-code",
      model: "claude-sonnet-5",
      session: "sess-1",
    });

    // Cross-check against the real `git interpret-trailers --parse`, not
    // just our own code's belief about what it wrote.
    const body = git(repo, ["log", "-1", "--format=%B", sha]);
    const parsed = execFileSync("git", ["interpret-trailers", "--parse"], {
      cwd: repo,
      input: body,
      encoding: "utf8",
    });
    expect(parsed).toContain("Ai-Agent: claude-code");
    expect(parsed).toContain("Ai-Model: claude-sonnet-5");
    expect(parsed).toContain("Ai-Session: sess-1");

    const report = buildReport(repo, "file.txt");
    expect(report[0]).toMatchObject({ content: "alpha", isAi: false, author: "Jane Doe" });
    expect(report[1]).toMatchObject({
      content: "BETA-changed",
      isAi: true,
      agent: "claude-code",
      model: "claude-sonnet-5",
      session: "sess-1",
      label: "[claude-code/claude-sonnet-5]",
    });
    expect(report[2]).toMatchObject({ content: "gamma", isAi: false });
    expect(report[3]).toMatchObject({ content: "delta", isAi: true, agent: "claude-code" });
  });

  it("computes a correct repo-wide AI vs. human line percentage", () => {
    fs.writeFileSync(path.join(repo, "a.txt"), "1\n2\n3\n4\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-q", "-m", "human file"]);

    fs.writeFileSync(path.join(repo, "b.txt"), "1\n2\n");
    git(repo, ["add", "b.txt"]);
    makeCommit(repo, { message: "ai file", agent: "claude-code", model: "claude-sonnet-5" });

    const stats = computeStats(repo);
    expect(stats.totalLines).toBe(6);
    expect(stats.aiLines).toBe(2);
    expect(stats.humanLines).toBe(4);
    expect(stats.aiPercent).toBeCloseTo((2 / 6) * 100, 5);
    expect(stats.humanPercent).toBeCloseTo((4 / 6) * 100, 5);
    expect(stats.byAgent).toEqual([{ key: "claude-code/claude-sonnet-5", lines: 2 }]);
  });

  it("supports an agent with no model (Ai-Agent only)", () => {
    fs.writeFileSync(path.join(repo, "file.txt"), "one\n");
    git(repo, ["add", "file.txt"]);
    makeCommit(repo, { message: "agent, no model recorded", agent: "some-bot" });

    const report = buildReport(repo, "file.txt");
    expect(report[0].isAi).toBe(true);
    expect(report[0].agent).toBe("some-bot");
    expect(report[0].model).toBeNull();
    expect(report[0].label).toBe("[some-bot]");
  });

  it("re-attributes a line to whichever commit last touched it, same as plain git blame", () => {
    fs.writeFileSync(path.join(repo, "file.txt"), "one\n");
    git(repo, ["add", "file.txt"]);
    makeCommit(repo, { message: "ai origin", agent: "claude-code", model: "claude-sonnet-5" });

    let report = buildReport(repo, "file.txt");
    expect(report[0].isAi).toBe(true);

    fs.writeFileSync(path.join(repo, "file.txt"), "one-edited-by-human\n");
    git(repo, ["add", "file.txt"]);
    git(repo, ["commit", "-q", "-m", "human edit overwrites the AI-authored line"]);

    report = buildReport(repo, "file.txt");
    expect(report).toHaveLength(1);
    expect(report[0].isAi).toBe(false);
    expect(report[0].author).toBe("Jane Doe");
    expect(report[0].content).toBe("one-edited-by-human");
  });

  it("works end-to-end through the built CLI binary (dist/cli.js)", () => {
    // Spawns three separate `node dist/cli.js` child processes; generous
    // timeout to stay reliable on slower/cold Windows CI-like environments.
    const cli = path.join(__dirname, "..", "dist", "cli.js");
    expect(fs.existsSync(cli)).toBe(true);

    fs.writeFileSync(path.join(repo, "file.txt"), "alpha\nbeta\n");
    git(repo, ["add", "file.txt"]);
    git(repo, ["commit", "-q", "-m", "human commit"]);

    fs.writeFileSync(path.join(repo, "file.txt"), "alpha\nBETA\n");
    git(repo, ["add", "file.txt"]);
    const commitOut = execFileSync(
      "node",
      [cli, "commit", "-m", "AI edit", "--agent", "claude-code", "--model", "claude-sonnet-5"],
      { cwd: repo, encoding: "utf8" },
    );
    expect(commitOut).toMatch(/Committed [0-9a-f]{12} with Ai-Agent: claude-code, Ai-Model: claude-sonnet-5/);

    const reportOut = execFileSync("node", [cli, "file.txt"], { cwd: repo, encoding: "utf8" });
    expect(reportOut).toMatch(/\[human: Jane Doe]\s+alpha/);
    expect(reportOut).toMatch(/\[claude-code\/claude-sonnet-5]\s+BETA/);

    const statsOut = execFileSync("node", [cli, "stats"], { cwd: repo, encoding: "utf8" });
    expect(statsOut).toContain("AI-attributed:    1 (50.0%)");
    expect(statsOut).toContain("Human-attributed: 1 (50.0%)");
  }, 20000);

  it("rejects an ai-blame commit missing --agent", () => {
    fs.writeFileSync(path.join(repo, "file.txt"), "one\n");
    git(repo, ["add", "file.txt"]);
    const cli = path.join(__dirname, "..", "dist", "cli.js");
    expect(() =>
      execFileSync("node", [cli, "commit", "-m", "no agent"], { cwd: repo, encoding: "utf8", stdio: "pipe" }),
    ).toThrow();
  }, 20000);
});
