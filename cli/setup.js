import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 4173;
const DEFAULT_DEPTH = 2;
const DEFAULT_BASE_PATH = "/diff";

function normalizeBasePath(value) {
  if (!value || value === "/") return "";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

export function parseCliArgs(argv) {
  const options = { roots: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root" && argv[index + 1]) options.roots.push(path.resolve(argv[++index]));
    else if (argument.startsWith("--root=")) options.roots.push(path.resolve(argument.slice(7)));
    else if (argument === "--depth" && argv[index + 1]) options.depth = Number.parseInt(argv[++index], 10);
    else if (argument.startsWith("--depth=")) options.depth = Number.parseInt(argument.slice(8), 10);
    else if (argument === "--port" && argv[index + 1]) options.port = Number.parseInt(argv[++index], 10);
    else if (argument.startsWith("--port=")) options.port = Number.parseInt(argument.slice(7), 10);
    else if (argument === "--base-path" && argv[index + 1]) options.basePath = normalizeBasePath(argv[++index]);
    else if (argument.startsWith("--base-path=")) options.basePath = normalizeBasePath(argument.slice(12));
    else if (argument === "--yes" || argument === "-y") options.yes = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--no-service") options.service = false;
    else if (argument === "--no-tailscale") options.tailscale = false;
  }
  return options;
}

function run(command, args, { allowFailure = false, capture = false, cwd } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error && !allowFailure) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
  return result;
}

async function exists(target) {
  try { await access(target, constants.F_OK); return true; }
  catch { return false; }
}

async function defaultRoot() {
  for (const candidate of [path.join(os.homedir(), "repos"), path.join(os.homedir(), "projects"), process.cwd()]) {
    if (await exists(candidate)) return candidate;
  }
  return process.cwd();
}

async function collectAnswers(options) {
  const defaults = {
    root: await defaultRoot(),
    depth: options.depth ?? DEFAULT_DEPTH,
    port: options.port ?? DEFAULT_PORT,
    basePath: options.basePath ?? DEFAULT_BASE_PATH,
  };

  if (options.yes || !process.stdin.isTTY) {
    return {
      roots: options.roots.length ? options.roots : [defaults.root],
      depth: defaults.depth,
      port: defaults.port,
      basePath: defaults.basePath,
      service: options.service !== false,
      tailscale: options.tailscale !== false,
    };
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  console.log("\nPocket Diff setup\n");
  const rootAnswer = await prompt.question(`Gitフォルダの親ディレクトリ（複数はカンマ区切り） [${defaults.root}]: `);
  const depthAnswer = await prompt.question(`探索する深さ [${defaults.depth}]: `);
  const pathAnswer = await prompt.question(`Tailnet内のURLパス [${defaults.basePath || "/"}]: `);
  const portAnswer = await prompt.question(`localhostポート [${defaults.port}]: `);
  const serviceAnswer = await prompt.question("OS起動時に自動起動しますか？ [Y/n]: ");
  const tailscaleAnswer = await prompt.question("Tailscale Serveを設定しますか？ [Y/n]: ");
  prompt.close();

  const roots = (rootAnswer || defaults.root).split(",").map((value) => path.resolve(value.trim())).filter(Boolean);
  return {
    roots,
    depth: Number.parseInt(depthAnswer, 10) || defaults.depth,
    port: Number.parseInt(portAnswer, 10) || defaults.port,
    basePath: normalizeBasePath(pathAnswer || defaults.basePath),
    service: !/^n/i.test(serviceAnswer),
    tailscale: !/^n/i.test(tailscaleAnswer),
  };
}

function serverArguments(config, serverPath) {
  const args = [serverPath];
  for (const root of config.roots) args.push("--root", root);
  args.push("--depth", String(config.depth));
  if (config.basePath) args.push("--base-path", config.basePath);
  return args;
}

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function createLaunchAgent({ nodePath, serverPath, config, logDirectory }) {
  const argumentsXml = [nodePath, ...serverArguments(config, serverPath)].map((value) => `      <string>${xml(value)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.pocket-diff</string>
    <key>ProgramArguments</key>
    <array>
${argumentsXml}
    </array>
    <key>EnvironmentVariables</key>
    <dict><key>PORT</key><string>${config.port}</string></dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${xml(path.join(logDirectory, "pocket-diff.log"))}</string>
    <key>StandardErrorPath</key><string>${xml(path.join(logDirectory, "pocket-diff-error.log"))}</string>
  </dict>
</plist>
`;
}

function systemdQuote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function createSystemdUnit({ nodePath, serverPath, config }) {
  const command = [nodePath, ...serverArguments(config, serverPath)].map(systemdQuote).join(" ");
  return `[Unit]\nDescription=Pocket Diff\nAfter=network.target\n\n[Service]\nExecStart=${command}\nEnvironment=PORT=${config.port}\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`;
}

async function installRuntime(config, options) {
  const home = process.env.POCKET_DIFF_HOME || path.join(os.homedir(), ".pocket-diff");
  const installDirectory = path.join(home, "app");
  if (options.dryRun) return { home, installDirectory, serverPath: path.join(installDirectory, "server", "index.js") };

  const base = config.basePath ? `${config.basePath}/` : "/";
  console.log(`\nBuilding for ${base} ...`);
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--", `--base=${base}`], { cwd: packageRoot });

  await rm(installDirectory, { recursive: true, force: true });
  await mkdir(installDirectory, { recursive: true });
  for (const directory of ["server", "dist"]) await cp(path.join(packageRoot, directory), path.join(installDirectory, directory), { recursive: true });
  await cp(path.join(packageRoot, "package.json"), path.join(installDirectory, "package.json"));
  const lockfile = path.join(packageRoot, "package-lock.json");
  if (await exists(lockfile)) await cp(lockfile, path.join(installDirectory, "package-lock.json"));
  await writeFile(path.join(home, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

  console.log("Installing runtime dependencies ...");
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--omit=dev", "--ignore-scripts"], { cwd: installDirectory });
  return { home, installDirectory, serverPath: path.join(installDirectory, "server", "index.js") };
}

async function configureService(config, runtime, options) {
  if (!config.service) return;
  if (options.dryRun) { console.log(`[dry-run] Configure ${process.platform} background service`); return; }

  if (process.platform === "darwin") {
    const agents = path.join(os.homedir(), "Library", "LaunchAgents");
    const plist = path.join(agents, "com.pocket-diff.plist");
    await mkdir(agents, { recursive: true });
    await writeFile(plist, createLaunchAgent({ nodePath: process.execPath, serverPath: runtime.serverPath, config, logDirectory: runtime.home }));
    const domain = `gui/${process.getuid()}`;
    run("launchctl", ["bootout", `${domain}/com.pocket-diff`], { allowFailure: true });
    run("launchctl", ["remove", "com.pocket-diff"], { allowFailure: true });
    run("launchctl", ["bootstrap", domain, plist]);
    return;
  }

  if (process.platform === "linux") {
    const unitDirectory = path.join(os.homedir(), ".config", "systemd", "user");
    const unit = path.join(unitDirectory, "pocket-diff.service");
    await mkdir(unitDirectory, { recursive: true });
    await writeFile(unit, createSystemdUnit({ nodePath: process.execPath, serverPath: runtime.serverPath, config }));
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", "--now", "pocket-diff.service"]);
    return;
  }

  if (process.platform === "win32") {
    const commandFile = path.join(runtime.home, "start-pocket-diff.cmd");
    const args = serverArguments(config, runtime.serverPath).map((value) => `"${value.replaceAll('"', '""')}"`).join(" ");
    await writeFile(commandFile, `@echo off\r\nset PORT=${config.port}\r\n"${process.execPath}" ${args}\r\n`);
    run("schtasks.exe", ["/Create", "/F", "/SC", "ONLOGON", "/TN", "PocketDiff", "/TR", commandFile]);
    run("schtasks.exe", ["/Run", "/TN", "PocketDiff"]);
    return;
  }

  throw new Error(`Automatic service setup is not supported on ${process.platform}`);
}

function tailscaleUrl(config) {
  const status = run("tailscale", ["status", "--json"], { capture: true, allowFailure: true });
  if (status.status !== 0) return null;
  try {
    const data = JSON.parse(status.stdout);
    const dns = data.Self?.DNSName?.replace(/\.$/, "");
    return dns ? `https://${dns}${config.basePath || ""}/` : null;
  } catch { return null; }
}

async function configureTailscale(config, options) {
  if (!config.tailscale) return null;
  const available = run("tailscale", ["version"], { capture: true, allowFailure: true });
  if (available.status !== 0) {
    console.warn("\nTailscale CLI was not found. Install and sign in to Tailscale, then rerun setup.");
    return null;
  }
  const args = ["serve", "--bg"];
  if (config.basePath) args.push(`--set-path=${config.basePath}`);
  args.push(`http://127.0.0.1:${config.port}`);
  if (options.dryRun) { console.log(`[dry-run] tailscale ${args.join(" ")}`); return "(dry-run)"; }
  run("tailscale", args);
  return tailscaleUrl(config);
}

async function setup(options) {
  const config = await collectAnswers(options);
  config.depth = Math.max(0, Math.min(config.depth, 8));
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error("Port must be between 1024 and 65535");
  for (const root of config.roots) {
    if (!(await exists(root))) throw new Error(`Root folder does not exist: ${root}`);
  }

  console.log("\nConfiguration");
  console.log(`  Git roots: ${config.roots.join(", ")}`);
  console.log(`  Scan depth: ${config.depth}`);
  console.log(`  Local port: ${config.port}`);
  console.log(`  URL path: ${config.basePath || "/"}`);

  const runtime = await installRuntime(config, options);
  await configureService(config, runtime, options);
  const url = await configureTailscale(config, options);
  console.log("\nPocket Diff is ready.");
  if (url) console.log(`Open: ${url}`);
  else console.log(`Local: http://127.0.0.1:${config.port}${config.basePath || ""}/`);
}

async function doctor() {
  console.log(`Node: ${process.version}`);
  for (const command of ["git", "tailscale"]) {
    const result = run(command, ["version"], { capture: true, allowFailure: true });
    console.log(`${command}: ${result.status === 0 ? result.stdout.trim().split("\n")[0] : "not found"}`);
  }
  const configPath = path.join(process.env.POCKET_DIFF_HOME || path.join(os.homedir(), ".pocket-diff"), "config.json");
  console.log(`Config: ${await exists(configPath) ? configPath : "not installed"}`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "setup";
  const optionArgs = command === "setup" ? argv.slice(command === argv[0] ? 1 : 0) : argv.slice(1);
  if (command === "setup") return setup(parseCliArgs(optionArgs));
  if (command === "doctor") return doctor();
  if (command === "help" || command === "--help" || command === "-h") {
    console.log("Pocket Diff\n\n  pocket-diff setup [--root PATH] [--depth N] [--base-path /diff] [--port 4173]\n  pocket-diff doctor");
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

export const __test__ = { normalizeBasePath };
