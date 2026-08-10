import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_DEPTH = 4;
const CACHE_MS = 10_000;
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".cache",
  ".next",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "Library",
  "node_modules",
  "Pods",
  "target",
  "vendor",
]);

function unique(values) {
  return [...new Set(values)];
}

export function parseServerOptions(argv = process.argv.slice(2), env = process.env) {
  const roots = [];
  let maxDepth = Number.parseInt(env.DIFF_SCAN_DEPTH || String(DEFAULT_DEPTH), 10);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root" && argv[index + 1]) roots.push(argv[++index]);
    else if (argument.startsWith("--root=")) roots.push(argument.slice("--root=".length));
    else if (argument === "--depth" && argv[index + 1]) maxDepth = Number.parseInt(argv[++index], 10);
    else if (argument.startsWith("--depth=")) maxDepth = Number.parseInt(argument.slice("--depth=".length), 10);
  }

  if (roots.length === 0 && env.DIFF_ROOTS) roots.push(...env.DIFF_ROOTS.split(path.delimiter));
  if (roots.length === 0 && env.DIFF_REPO) roots.push(env.DIFF_REPO);
  if (roots.length === 0) roots.push(process.cwd());

  return {
    roots: unique(roots.filter(Boolean).map((root) => path.resolve(root))),
    maxDepth: Number.isFinite(maxDepth) ? Math.max(0, Math.min(maxDepth, 8)) : DEFAULT_DEPTH,
  };
}

async function isRepository(directory) {
  try {
    await stat(path.join(directory, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function walk(root, maxDepth) {
  const repositories = [];

  async function visit(directory, depth) {
    if (await isRepository(directory)) repositories.push(directory);
    if (depth >= maxDepth) return;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || SKIP_DIRECTORIES.has(entry.name)) continue;
      await visit(path.join(directory, entry.name), depth + 1);
    }
  }

  await visit(root, 0);
  return repositories;
}

async function git(directory, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

function countStatusEntries(porcelain) {
  const entries = porcelain.split("\0").filter(Boolean);
  let count = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const status = entries[index].slice(0, 2);
    count += 1;
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return count;
}

async function describeRepository(repositoryPath, scanRoot) {
  const canonical = await realpath(repositoryPath);
  const [branch, statusOutput] = await Promise.all([
    git(canonical, ["branch", "--show-current"]),
    git(canonical, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);
  const relative = path.relative(scanRoot, canonical);
  const label = relative && relative !== "." ? relative.split(path.sep).join("/") : path.basename(canonical);

  return {
    id: createHash("sha256").update(canonical).digest("hex").slice(0, 16),
    name: path.basename(canonical),
    label,
    branch: branch.trim() || "detached HEAD",
    changes: countStatusEntries(statusOutput),
    path: canonical,
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class RepositoryCatalog {
  constructor({ roots, maxDepth = DEFAULT_DEPTH, cacheMs = CACHE_MS }) {
    this.roots = roots;
    this.maxDepth = maxDepth;
    this.cacheMs = cacheMs;
    this.repositories = [];
    this.lastScan = 0;
  }

  async scan({ force = false } = {}) {
    if (!force && Date.now() - this.lastScan < this.cacheMs) return this.repositories;

    const canonicalRoots = [];
    for (const root of this.roots) {
      try {
        const canonical = await realpath(root);
        if ((await stat(canonical)).isDirectory()) canonicalRoots.push(canonical);
      } catch {
        // An unavailable configured root is ignored so another root can still work.
      }
    }

    const discovered = [];
    for (const root of canonicalRoots) {
      for (const repositoryPath of await walk(root, this.maxDepth)) {
        discovered.push({ repositoryPath, scanRoot: root });
      }
    }

    const deduplicated = [...new Map(discovered.map((item) => [item.repositoryPath, item])).values()];
    const described = await mapWithConcurrency(deduplicated, 6, async (item) => {
      try {
        return await describeRepository(item.repositoryPath, item.scanRoot);
      } catch {
        return null;
      }
    });

    this.repositories = described
      .filter(Boolean)
      .sort((left, right) => Number(right.changes > 0) - Number(left.changes > 0) || left.label.localeCompare(right.label));
    this.lastScan = Date.now();
    return this.repositories;
  }

  async publicList(options) {
    return (await this.scan(options)).map(({ path: _path, ...repository }) => repository);
  }

  async resolve(id) {
    let repository = (await this.scan()).find((item) => item.id === id);
    if (!repository) repository = (await this.scan({ force: true })).find((item) => item.id === id);
    return repository?.path;
  }
}

export const __test__ = { countStatusEntries };
