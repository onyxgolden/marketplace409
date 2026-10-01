/**
 * githubActionsDeps.mjs — Slice 9: GITHUB_TOKEN network adapters for the
 * nightly self-heal runner on a GitHub Actions runner.
 *
 * The driver's local defaults (prepareFixPr.defaultPushBranch/defaultOpenPr)
 * use this VM's credential surrogate and cannot run on GitHub's runners.
 * These adapters do the same two mutations plus the runner's fix-PR listing
 * with the workflow's GITHUB_TOKEN, via git and the preinstalled `gh` CLI.
 *
 *   makeGithubActionsDeps({ token, repo, exec })
 *
 * Returns { pushBranch, openPr, listFixPrs }. `exec(cmd, args, opts)` is
 * injectable for hermetic tests; the default shells out. Token values are
 * never included in thrown error text.
 */

import { execFileSync } from "node:child_process";

function defaultExec(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts }).trim();
}

function redact(token, text) {
  return String(text).split(token).join("***");
}

export function makeGithubActionsDeps({ token, repo, exec = defaultExec } = {}) {
  if (!token) throw new Error("github actions deps require a token");
  if (!repo || !repo.includes("/")) throw new Error("github actions deps require repo as \"owner/name\"");

  const pushUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
  const ghEnv = { GH_TOKEN: token };

  const pushBranch = ({ worktree, branch }) => {
    if (!worktree || !branch) throw new Error("pushBranch requires worktree and branch");
    try {
      exec("git", ["-C", worktree, "push", pushUrl, `${branch}:${branch}`]);
    } catch (e) {
      const detail = redact(token, (e && e.message) || e).slice(0, 300);
      throw new Error(`push failed: ${detail}`);
    }
  };

  const openPr = ({ branch, title, body }) => {
    if (!branch || !title) throw new Error("openPr requires branch and title");
    let out;
    try {
      out = exec("gh", ["pr", "create", "--head", branch, "--base", "main", "--title", title, "--body", body || ""], {
        env: ghEnv,
      });
    } catch (e) {
      const detail = redact(token, (e && e.message) || e).slice(0, 300);
      throw new Error(`open PR failed: ${detail}`);
    }
    const url = String(out).trim().split("\n").pop();
    const m = /\/pull\/(\d+)\/?$/.exec(url || "");
    if (!m) throw new Error(`unexpected gh pr create output: ${String(url).slice(0, 200)}`);
    return { number: Number(m[1]), url };
  };

  const listFixPrs = () => {
    let out;
    try {
      out = exec("gh", ["pr", "list", "--state", "all", "--limit", "100", "--json", "number,state,headRefName,title"], {
        env: ghEnv,
      });
    } catch (e) {
      const detail = redact(token, (e && e.message) || e).slice(0, 300);
      throw new Error(`list fix PRs failed: ${detail}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(String(out));
    } catch {
      throw new Error("list fix PRs returned malformed JSON");
    }
    return (Array.isArray(parsed) ? parsed : []).map((pr) => ({
      number: pr.number,
      state: String(pr.state || "").toLowerCase(),
      head: pr.headRefName,
      title: pr.title,
    }));
  };

  return { pushBranch, openPr, listFixPrs };
}
