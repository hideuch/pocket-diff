import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createLaunchAgent, createSystemdUnit, parseCliArgs, __test__ } from "../cli/setup.js";

const config = { roots: ["/code/one", "/code/two"], depth: 3, port: 4173, basePath: "/diff" };

test("setup argument parser supports repeatable roots and unattended flags", () => {
  const options = parseCliArgs(["--root", "./one", "--root=./two", "--base-path=diff/", "--port=5000", "--yes", "--dry-run"]);
  assert.deepEqual(options.roots, [path.resolve("./one"), path.resolve("./two")]);
  assert.equal(options.basePath, "/diff");
  assert.equal(options.port, 5000);
  assert.equal(options.yes, true);
  assert.equal(options.dryRun, true);
});

test("base path normalization keeps root deployments empty", () => {
  assert.equal(__test__.normalizeBasePath("/"), "");
  assert.equal(__test__.normalizeBasePath("review/"), "/review");
});

test("launch agent contains all allowlisted roots and port", () => {
  const plist = createLaunchAgent({ nodePath: "/node", serverPath: "/app/server/index.js", config, logDirectory: "/logs" });
  assert.match(plist, /<string>\/code\/one<\/string>/);
  assert.match(plist, /<string>\/code\/two<\/string>/);
  assert.match(plist, /<key>PORT<\/key><string>4173<\/string>/);
});

test("systemd unit restarts the server and preserves subpath", () => {
  const unit = createSystemdUnit({ nodePath: "/node", serverPath: "/app/server/index.js", config });
  assert.match(unit, /Restart=always/);
  assert.match(unit, /--base-path" "\/diff"/);
});
