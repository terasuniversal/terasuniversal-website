/**
 * The fixed git baseline that website contracts compare against (Public-First release, K-4).
 *
 * The S1–S6 contracts were written for an uncommitted working tree and compared every file with `HEAD`. Once the work
 * is committed on a release branch, `HEAD` already contains it, so those comparisons would silently compare a file with
 * itself. CONTRACT_BASE is the commit the work sits on top of: TERAS_CONTRACT_BASE when set, otherwise the merge base of
 * HEAD and origin/main -- the release base (789c04b) on release/public-first, and b9e6c2a on the original work branch.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

export const CONTRACT_BASE: string = process.env.TERAS_CONTRACT_BASE?.trim()
  || execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: repo, encoding: "utf8" }).trim();

/** Files changed against CONTRACT_BASE (committed or not) plus untracked files, in `git status --porcelain` style. */
export function changedSinceBase(paths: string[]): string[] {
  const tracked = execFileSync("git", ["diff", "--name-status", CONTRACT_BASE, "--", ...paths], { cwd: repo, encoding: "utf8" })
    .split("\n").filter(Boolean).map((line) => {
      const [status, file] = line.split("\t");
      return status === "A" ? `?? ${file}` : `${status === "D" ? " D" : " M"} ${file}`;
    });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", ...paths], { cwd: repo, encoding: "utf8" })
    .split("\n").filter(Boolean).map((file) => `?? ${file}`);
  return [...new Set([...tracked, ...untracked])];
}
