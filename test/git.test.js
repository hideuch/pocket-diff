import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { collectDiff, __test__ } from "../server/git.js";

const exec = promisify(execFile);

test("countPatch counts files and changed lines", () => {
  const patch = "diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-old\n+new\n";
  assert.deepEqual(__test__.countPatch(patch), { files: 1, additions: 1, deletions: 1 });
});

test("collectDiff includes tracked and untracked changes", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "pocket-diff-test-"));
  await exec("git", ["init", "-q"], { cwd: repo });
  await exec("git", ["config", "user.name", "Pocket Diff Test"], { cwd: repo });
  await exec("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
  await writeFile(path.join(repo, "tracked.js"), "const value = 1;\n");
  await exec("git", ["add", "tracked.js"], { cwd: repo });
  await exec("git", ["commit", "-qm", "initial"], { cwd: repo });
  await writeFile(path.join(repo, "tracked.js"), "const value = 2;\n");
  await writeFile(path.join(repo, "new.js"), "export const ready = true;\n");

  const result = await collectDiff(repo);
  assert.equal(result.summary.files, 2);
  assert.match(result.patch, /diff --git a\/tracked\.js b\/tracked\.js/);
  assert.match(result.patch, /diff --git a\/new\.js b\/new\.js/);
  assert.equal(result.summary.additions, 2);
  assert.equal(result.summary.deletions, 1);
  assert.match(result.revision, /^[a-f0-9]{16}$/);
  assert.equal("root" in result, false);
});
