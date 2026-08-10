import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_DIFF_BYTES = 24 * 1024 * 1024;
const MAX_UNTRACKED_BYTES = 1024 * 1024;

async function git(repoPath, args, { allowDifference = false } = {}) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoPath,
      encoding: "utf8",
      maxBuffer: MAX_DIFF_BYTES,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    });
    return stdout;
  } catch (error) {
    if (allowDifference && error.code === 1) return error.stdout ?? "";
    throw error;
  }
}

function parseZeroSeparated(value) {
  return value.split("\0").filter(Boolean);
}

function countPatch(patch) {
  let additions = 0;
  let deletions = 0;
  let files = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) files += 1;
    else if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }

  return { additions, deletions, files };
}

async function hasHead(repoPath) {
  try {
    await git(repoPath, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

async function untrackedPatch(repoPath) {
  const raw = await git(repoPath, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const names = parseZeroSeparated(raw);
  const patches = [];
  const skipped = [];

  for (const name of names) {
    const absolute = path.resolve(repoPath, name);
    const relative = path.relative(repoPath, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;

    const info = await stat(absolute);
    if (!info.isFile()) continue;
    if (info.size > MAX_UNTRACKED_BYTES) {
      skipped.push(name);
      continue;
    }

    const sample = await readFile(absolute);
    if (sample.includes(0)) {
      patches.push(
        `diff --git a/${name} b/${name}\nnew file mode 100644\nBinary files /dev/null and b/${name} differ\n`,
      );
      continue;
    }

    const diff = await git(
      repoPath,
      ["diff", "--no-index", "--no-ext-diff", "--no-color", "--", "/dev/null", name],
      { allowDifference: true },
    );
    if (diff) patches.push(diff);
  }

  return { patch: patches.join("\n"), skipped };
}

export async function collectDiff(repoPath) {
  const root = (await git(repoPath, ["rev-parse", "--show-toplevel"])).trim();
  const branch = (await git(root, ["branch", "--show-current"])).trim() || "detached HEAD";
  const headExists = await hasHead(root);
  let tracked = "";

  if (headExists) {
    tracked = await git(root, [
      "diff",
      "--no-ext-diff",
      "--no-color",
      "--find-renames",
      "--unified=3",
      "HEAD",
      "--",
    ]);
  } else {
    const staged = await git(root, ["diff", "--cached", "--no-ext-diff", "--no-color", "--unified=3", "--"]);
    const unstaged = await git(root, ["diff", "--no-ext-diff", "--no-color", "--unified=3", "--"]);
    tracked = `${staged}\n${unstaged}`.trim();
  }

  const untracked = await untrackedPatch(root);
  const patch = [tracked, untracked.patch].filter(Boolean).join("\n");
  const revision = createHash("sha256").update(patch).digest("hex").slice(0, 16);

  return {
    repo: path.basename(root),
    branch,
    base: headExists ? "HEAD" : "empty repository",
    patch,
    revision,
    summary: countPatch(patch),
    skipped: untracked.skipped,
    generatedAt: new Date().toISOString(),
  };
}

export const __test__ = { countPatch, parseZeroSeparated };
