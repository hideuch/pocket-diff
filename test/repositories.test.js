import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { RepositoryCatalog, __test__, parseServerOptions } from "../server/repositories.js";

const exec = promisify(execFile);

async function createRepository(directory, { dirty = false } = {}) {
  await mkdir(directory, { recursive: true });
  await exec("git", ["init", "-q"], { cwd: directory });
  await exec("git", ["config", "user.name", "Pocket Diff Test"], { cwd: directory });
  await exec("git", ["config", "user.email", "test@example.invalid"], { cwd: directory });
  await writeFile(path.join(directory, "README.md"), "# Test\n");
  await exec("git", ["add", "README.md"], { cwd: directory });
  await exec("git", ["commit", "-qm", "initial"], { cwd: directory });
  if (dirty) await writeFile(path.join(directory, "change.js"), "export const changed = true;\n");
}

test("parseServerOptions accepts repeatable portable roots and clamps depth", () => {
  const options = parseServerOptions(["--root", "./one", "--root=./two", "--depth=99"], {});
  assert.deepEqual(options.roots, [path.resolve("./one"), path.resolve("./two")]);
  assert.equal(options.maxDepth, 8);
});

test("status parser counts a rename as one change", () => {
  assert.equal(__test__.countStatusEntries("R  new.js\0old.js\0?? other.js\0"), 2);
});

test("catalog discovers repositories but never publishes absolute paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pocket-diff-catalog-"));
  await createRepository(path.join(root, "clean"));
  await createRepository(path.join(root, "group", "dirty"), { dirty: true });
  await mkdir(path.join(root, "group", "not-a-repo"), { recursive: true });

  const catalog = new RepositoryCatalog({ roots: [root], maxDepth: 2, cacheMs: 0 });
  const repositories = await catalog.publicList();
  assert.equal(repositories.length, 2);
  assert.equal(repositories[0].name, "dirty");
  assert.equal(repositories[0].changes, 1);
  assert.equal(repositories.some((repository) => "path" in repository), false);

  const resolved = await catalog.resolve(repositories[0].id);
  assert.equal(resolved, await realpath(path.join(root, "group", "dirty")));
  assert.equal(await catalog.resolve("not-allowlisted"), undefined);
});
