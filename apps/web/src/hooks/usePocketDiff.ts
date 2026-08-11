import { parsePatchFiles } from "@pierre/diffs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiError, DiffResponse, Repository } from "../types";

const REFRESH_MS = 3000;
const LAST_REPO_KEY = "pocket-diff:last-repository";
const API_BASE = `${import.meta.env.BASE_URL}api`;

export function usePocketDiff() {
  const [repositories, setRepositories] = useState<Repository[] | null>(null);
  const [activeRepoId, setActiveRepoId] = useState("");
  const [data, setData] = useState<DiffResponse | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const revisionRef = useRef("");

  const loadRepositories = useCallback(async ({ refresh = false }: { refresh?: boolean } = {}) => {
    try {
      const response = await fetch(`${API_BASE}/repos${refresh ? "?refresh=1" : ""}`, { cache: "no-cache" });
      const result = (await response.json()) as { repositories: Repository[] } & ApiError;
      if (!response.ok) throw new Error(result.detail || result.error);
      setRepositories(result.repositories);
      setError("");
      if (result.repositories.length > 0) {
        setActiveRepoId((current) => {
          const requested = new URL(window.location.href).searchParams.get("repo");
          const remembered = window.localStorage.getItem(LAST_REPO_KEY);
          return (
            [current, requested, remembered].find((id) => result.repositories.some((repo) => repo.id === id)) ||
            result.repositories[0].id
          );
        });
      }
    } catch (loadError) {
      setError(errorMessage(loadError, "リポジトリを検索できませんでした"));
      setRepositories([]);
    }
  }, []);

  useEffect(() => {
    loadRepositories();
  }, [loadRepositories]);

  const loadDiff = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (!activeRepoId) return;
      if (!quiet) setRefreshing(true);
      try {
        const response = await fetch(`${API_BASE}/diff?repo=${encodeURIComponent(activeRepoId)}`, {
          cache: "no-cache",
          headers: revisionRef.current ? { "If-None-Match": `"${revisionRef.current}"` } : {},
        });
        if (response.status === 304) return;
        const next = (await response.json()) as DiffResponse & ApiError;
        if (!response.ok) throw new Error(next.detail || next.error);
        revisionRef.current = next.revision;
        setData(next);
        setError("");
      } catch (loadError) {
        setError(errorMessage(loadError, "接続を確認してください"));
      } finally {
        setRefreshing(false);
      }
    },
    [activeRepoId],
  );

  useEffect(() => {
    if (!activeRepoId) return undefined;
    revisionRef.current = "";
    setData(null);
    setError("");
    setSelected(0);
    window.localStorage.setItem(LAST_REPO_KEY, activeRepoId);
    const url = new URL(window.location.href);
    url.searchParams.set("repo", activeRepoId);
    window.history.replaceState(null, "", url);
    loadDiff();
    const timer = window.setInterval(
      () => document.visibilityState === "visible" && loadDiff({ quiet: true }),
      REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, [activeRepoId, loadDiff]);

  const files = useMemo(() => {
    if (!data?.patch) return [];
    try {
      return parsePatchFiles(data.patch, `working-${data.revision}`).flatMap((entry) => entry.files);
    } catch {
      return [];
    }
  }, [data]);

  useEffect(() => {
    if (selected >= files.length) setSelected(Math.max(0, files.length - 1));
  }, [files.length, selected]);

  const activeRepository = repositories?.find((repository) => repository.id === activeRepoId);
  const current = files[selected];

  return {
    repositories,
    activeRepoId,
    activeRepository,
    data,
    error,
    files,
    current,
    selected,
    refreshing,
    setSelected,
    selectRepository: setActiveRepoId,
    loadDiff,
    refreshRepositories: () => loadRepositories({ refresh: true }),
    retry: () => (repositories?.length ? loadDiff() : loadRepositories({ refresh: true })),
    selectPrevious: () => setSelected((selected - 1 + files.length) % files.length),
    selectNext: () => setSelected((selected + 1) % files.length),
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
