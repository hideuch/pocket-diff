import { parsePatchFiles } from "@pierre/diffs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApiError,
  DiffResponse,
  GitFileStatus,
  GitMutationAction,
  GitMutationInput,
  GitStatusResponse,
  Repository,
} from "../types";

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
  const [gitBusy, setGitBusy] = useState(false);
  const [gitFilesStatus, setGitFilesStatus] = useState<GitFileStatus[]>([]);
  const revisionRef = useRef("");
  const statusRevisionRef = useRef("");
  const changeTokenRef = useRef("");
  const gitBusyRef = useRef(false);

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
    async ({ quiet = false, force = false }: { quiet?: boolean; force?: boolean } = {}) => {
      if (!activeRepoId) return;
      if (quiet && gitBusyRef.current && !force) return;
      if (!quiet) setRefreshing(true);
      try {
        const response = await fetch(`${API_BASE}/diff?repo=${encodeURIComponent(activeRepoId)}`, {
          cache: "no-cache",
          headers: !force && revisionRef.current ? { "If-None-Match": `"${revisionRef.current}"` } : {},
        });
        if (response.status === 304) return;
        const next = (await response.json()) as DiffResponse & ApiError;
        if (!response.ok) throw new Error(next.detail || next.error);
        revisionRef.current = next.revision;
        statusRevisionRef.current = next.statusRevision;
        changeTokenRef.current = next.changeToken;
        setGitFilesStatus(next.filesStatus);
        setData(next);
        setError("");
        return next;
      } catch (loadError) {
        setError(errorMessage(loadError, "接続を確認してください"));
      } finally {
        setRefreshing(false);
      }
    },
    [activeRepoId],
  );

  const loadGitStatus = useCallback(async () => {
    if (!activeRepoId || gitBusyRef.current) return;
    try {
      const response = await fetch(`${API_BASE}/git/status?repo=${encodeURIComponent(activeRepoId)}`, {
        cache: "no-store",
      });
      const next = (await response.json()) as GitStatusResponse & ApiError;
      if (!response.ok) throw new Error(next.detail || next.error);
      const previousChangeToken = changeTokenRef.current;
      statusRevisionRef.current = next.statusRevision;
      changeTokenRef.current = next.changeToken;
      setGitFilesStatus(next.filesStatus);
      if (previousChangeToken && previousChangeToken !== next.changeToken) {
        await loadDiff({ quiet: true, force: true });
      }
      setError("");
    } catch (loadError) {
      setError(errorMessage(loadError, "接続を確認してください"));
    }
  }, [activeRepoId, loadDiff]);

  useEffect(() => {
    if (!activeRepoId) return undefined;
    revisionRef.current = "";
    statusRevisionRef.current = "";
    changeTokenRef.current = "";
    setData(null);
    setGitFilesStatus([]);
    setError("");
    setSelected(0);
    window.localStorage.setItem(LAST_REPO_KEY, activeRepoId);
    const url = new URL(window.location.href);
    url.searchParams.set("repo", activeRepoId);
    window.history.replaceState(null, "", url);
    loadDiff();
    const timer = window.setInterval(() => document.visibilityState === "visible" && loadGitStatus(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [activeRepoId, loadDiff, loadGitStatus]);

  const files = useMemo(() => {
    if (!data?.patch) return [];
    try {
      return parsePatchFiles(data.patch, `working-${data.revision}`).flatMap((entry) => entry.files);
    } catch {
      return [];
    }
  }, [data?.patch, data?.revision]);

  useEffect(() => {
    if (selected >= files.length) setSelected(Math.max(0, files.length - 1));
  }, [files.length, selected]);

  const activeRepository = repositories?.find((repository) => repository.id === activeRepoId);
  const current = files[selected];

  const mutateGit = useCallback(
    async (action: GitMutationAction, input: GitMutationInput) => {
      if (!activeRepoId || !statusRevisionRef.current || !changeTokenRef.current) {
        throw new Error("リポジトリが選択されていません");
      }
      const previousFilesStatus = gitFilesStatus;
      const previousStatusRevision = statusRevisionRef.current;
      const previousChangeToken = changeTokenRef.current;
      if ((action === "stage" || action === "unstage") && input.path) {
        const nextStage = action === "stage" ? "staged" : "unstaged";
        setGitFilesStatus((currentStatuses) =>
          currentStatuses.map((file) =>
            file.path === input.path || file.previousPath === input.path ? { ...file, stage: nextStage } : file,
          ),
        );
      }
      if (action === "stage-all" || action === "unstage-all") {
        const nextStage = action === "stage-all" ? "staged" : "unstaged";
        setGitFilesStatus((currentStatuses) => currentStatuses.map((file) => ({ ...file, stage: nextStage })));
      }
      gitBusyRef.current = true;
      setGitBusy(true);
      try {
        const response = await fetch(`${API_BASE}/git/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: activeRepoId,
            statusRevision: previousStatusRevision,
            changeToken: previousChangeToken,
            ...input,
          }),
        });
        const next = (await response.json()) as GitStatusResponse & ApiError;
        if (!response.ok) {
          throw new Error(next.detail || next.error || "Git操作を完了できませんでした");
        }
        statusRevisionRef.current = next.statusRevision;
        changeTokenRef.current = next.changeToken;
        setGitFilesStatus(next.filesStatus);
        if (action === "discard" || action === "discard-lines" || action === "commit") {
          await loadDiff({ quiet: true, force: true });
        }
        setError("");
        return next;
      } catch (operationError) {
        statusRevisionRef.current = previousStatusRevision;
        changeTokenRef.current = previousChangeToken;
        setGitFilesStatus(previousFilesStatus);
        window.setTimeout(() => loadGitStatus(), 0);
        throw operationError;
      } finally {
        gitBusyRef.current = false;
        setGitBusy(false);
      }
    },
    [activeRepoId, gitFilesStatus, loadDiff, loadGitStatus],
  );

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
    gitBusy,
    gitFilesStatus,
    setSelected,
    selectRepository: setActiveRepoId,
    loadDiff,
    mutateGit,
    refreshRepositories: () => loadRepositories({ refresh: true }),
    retry: () => (repositories?.length ? loadDiff() : loadRepositories({ refresh: true })),
    selectPrevious: () => setSelected((selected - 1 + files.length) % files.length),
    selectNext: () => setSelected((selected + 1) % files.length),
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
