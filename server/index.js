import { createApp } from "./app.js";
import { RepositoryCatalog, parseServerOptions } from "./repositories.js";

const port = Number.parseInt(process.env.PORT || "4173", 10);
const host = process.env.HOST || "127.0.0.1";
const repositoryOptions = parseServerOptions();
const catalog = new RepositoryCatalog(repositoryOptions);
const development = process.argv.includes("--dev");
const app = await createApp({ catalog, development, basePath: repositoryOptions.basePath });

app.listen(port, host, () => {
  console.log(`Pocket Diff: http://${host}:${port}`);
  console.log(`Search roots: ${repositoryOptions.roots.join(", ")}`);
  console.log(`Scan depth: ${repositoryOptions.maxDepth}`);
  if (repositoryOptions.basePath) console.log(`Base path: ${repositoryOptions.basePath}/`);
  if (host === "127.0.0.1") {
    console.log(`Tailnet HTTPS: tailscale serve --bg http://127.0.0.1:${port}`);
  }
});
