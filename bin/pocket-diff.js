#!/usr/bin/env node

import { runCli } from "../cli/setup.js";

runCli().catch((error) => {
  console.error(`\nPocket Diff setup failed: ${error.message}`);
  process.exitCode = 1;
});
