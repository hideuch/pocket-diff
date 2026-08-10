import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectDiff } from "./git.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function securityHeaders(_request, response, next) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
  );
  next();
}

export async function createApp({ catalog, development = false }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/repos", async (request, response) => {
    response.setHeader("Cache-Control", "private, no-cache");
    try {
      const repositories = await catalog.publicList({ force: request.query.refresh === "1" });
      response.json({ repositories });
    } catch (error) {
      response.status(422).json({ error: "リポジトリを検索できませんでした", detail: error.message });
    }
  });

  app.get("/api/diff", async (request, response) => {
    response.setHeader("Cache-Control", "private, no-cache");
    try {
      const repoPath = await catalog.resolve(request.query.repo);
      if (!repoPath) {
        response.status(404).json({ error: "リポジトリが見つかりません", detail: "一覧から選び直してください" });
        return;
      }
      const data = await collectDiff(repoPath);
      const etag = `\"${data.revision}\"`;
      response.setHeader("ETag", etag);
      if (request.headers["if-none-match"] === etag) {
        response.status(304).end();
        return;
      }
      response.json(data);
    } catch (error) {
      response.status(422).json({
        error: "差分を読み込めませんでした",
        detail: error.stderr?.trim() || error.message,
      });
    }
  });

  if (development) {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const dist = path.resolve(here, "../dist");
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get("/{*splat}", (_request, response) => response.sendFile(path.join(dist, "index.html")));
  }

  return app;
}
