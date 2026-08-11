import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const REFRESH_MS = 3000;
const LAST_REPO_KEY = "pocket-diff:last-repository";
const API_BASE = `${import.meta.env.BASE_URL}api`;

function Icon({ name, size = 18 }) {
  const paths = {
    branch: <path d="M6 3v9a3 3 0 0 0 3 3h6M6 3a2 2 0 1 0 0 .01M15 15a2 2 0 1 0 0 .01M15 5a2 2 0 1 0 0 .01M15 7v3" />,
    refresh: <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />,
    file: <path d="M7 3h7l4 4v14H7zM14 3v5h5" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    arrow: <path d="m15 18-6-6 6-6" />,
    down: <path d="m7 10 5 5 5-5" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    search: <path d="m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0" />,
    repo: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v16H6.5A2.5 2.5 0 0 1 4 16.5zM4 16.5A2.5 2.5 0 0 1 6.5 14H19" />,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function FileRail({ files, selected, onSelect }) {
  return (
    <nav className="file-rail" aria-label="変更ファイル">
      {files.map((file, index) => (
        <button className={`file-pill ${index === selected ? "is-selected" : ""}`} key={`${file.name}-${index}`} onClick={() => onSelect(index)} type="button">
          <span className={`change-dot change-${file.type}`} />
          <span className="file-pill-name">{file.name.split("/").at(-1)}</span>
          <span className="file-pill-count">{index + 1}/{files.length}</span>
        </button>
      ))}
    </nav>
  );
}

function RepositoryPicker({ repositories, activeId, onClose, onSelect, onRefresh }) {
  const [query, setQuery] = useState("");
  const dialogRef = useRef(null);
  const filtered = repositories.filter((repository) =>
    `${repository.name} ${repository.label} ${repository.branch}`.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => { dialogRef.current?.focus(); }, []);

  useEffect(() => {
    const closeOnEscape = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="picker-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="repo-picker" role="dialog" aria-modal="true" aria-labelledby="repo-picker-title" tabIndex={-1}>
        <div className="picker-grabber" aria-hidden="true" />
        <header className="picker-header">
          <div><p className="eyebrow">ON THIS DEVICE</p><h2 id="repo-picker-title">リポジトリを選ぶ</h2></div>
          <button type="button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button>
        </header>
        <label className="repo-search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・ブランチで検索" />
        </label>
        <div className="repo-list">
          {filtered.map((repository) => (
            <button className={`repo-row ${repository.id === activeId ? "is-active" : ""}`} key={repository.id} onClick={() => onSelect(repository.id)} type="button">
              <span className="repo-row-icon"><Icon name="repo" size={17} /></span>
              <span className="repo-row-copy">
                <strong>{repository.name}</strong>
                <small>{repository.label} · {repository.branch}</small>
              </span>
              <span className={`dirty-count ${repository.changes === 0 ? "is-clean" : ""}`}>{repository.changes === 0 ? "clean" : repository.changes}</span>
            </button>
          ))}
          {filtered.length === 0 ? <p className="repo-list-empty">一致するリポジトリはありません</p> : null}
        </div>
        <button className="rescan-button" onClick={onRefresh} type="button"><Icon name="refresh" size={15} />フォルダを再検索</button>
      </section>
    </div>
  );
}

function EmptyState({ noRepositories = false }) {
  return (
    <main className="empty-state">
      <div className="empty-glyph" aria-hidden="true"><span /><span /><span /></div>
      <p className="eyebrow">{noRepositories ? "NO REPOSITORIES FOUND" : "WORKING TREE IS CLEAN"}</p>
      <h1>{noRepositories ? "Gitフォルダが見つかりません" : "差分はまだありません"}</h1>
      <p>{noRepositories ? "起動時に --root でGitリポジトリを含むフォルダを指定してください。" : "Claude がファイルを編集すると、ここに自動で表示されます。この画面は開いたままで大丈夫です。"}</p>
    </main>
  );
}

function ErrorState({ message, onRetry }) {
  return <main className="empty-state error-state"><p className="eyebrow">REPOSITORY UNAVAILABLE</p><h1>差分を読めませんでした</h1><p>{message}</p><button className="retry-button" onClick={onRetry} type="button">もう一度読む</button></main>;
}

export function App() {
  const [repositories, setRepositories] = useState(null);
  const [activeRepoId, setActiveRepoId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const revisionRef = useRef("");

  const loadRepositories = useCallback(async ({ refresh = false } = {}) => {
    try {
      const response = await fetch(`${API_BASE}/repos${refresh ? "?refresh=1" : ""}`, { cache: "no-cache" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || result.error);
      setRepositories(result.repositories);
      setError("");
      if (result.repositories.length > 0) {
        setActiveRepoId((current) => {
          const requested = new URL(window.location.href).searchParams.get("repo");
          const remembered = window.localStorage.getItem(LAST_REPO_KEY);
          return [current, requested, remembered].find((id) => result.repositories.some((repo) => repo.id === id)) || result.repositories[0].id;
        });
      }
    } catch (loadError) {
      setError(loadError.message || "リポジトリを検索できませんでした");
      setRepositories([]);
    }
  }, []);

  useEffect(() => { loadRepositories(); }, [loadRepositories]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!activeRepoId) return;
    if (!quiet) setRefreshing(true);
    try {
      const response = await fetch(`${API_BASE}/diff?repo=${encodeURIComponent(activeRepoId)}`, {
        cache: "no-cache",
        headers: revisionRef.current ? { "If-None-Match": `\"${revisionRef.current}\"` } : {},
      });
      if (response.status === 304) return;
      const next = await response.json();
      if (!response.ok) throw new Error(next.detail || next.error);
      revisionRef.current = next.revision;
      setData(next);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "接続を確認してください");
    } finally {
      setRefreshing(false);
    }
  }, [activeRepoId]);

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
    load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && load({ quiet: true }), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [activeRepoId, load]);

  const files = useMemo(() => {
    if (!data?.patch) return [];
    try { return parsePatchFiles(data.patch, `working-${data.revision}`).flatMap((entry) => entry.files); }
    catch { return []; }
  }, [data]);

  useEffect(() => { if (selected >= files.length) setSelected(Math.max(0, files.length - 1)); }, [files.length, selected]);

  const activeRepository = repositories?.find((repository) => repository.id === activeRepoId);
  const current = files[selected];
  const updated = data?.generatedAt ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(data.generatedAt)) : "—";
  const selectRepository = (id) => { setActiveRepoId(id); setPickerOpen(false); };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-label="Pocket Diff"><span>P</span><span>D</span></div>
        <button className="repo-title repo-switcher" onClick={() => setPickerOpen(true)} type="button" disabled={!repositories?.length}>
          <strong>{activeRepository?.name || "Pocket Diff"}<Icon name="down" size={13} /></strong>
          <span><Icon name="branch" size={13} />{activeRepository?.branch || (repositories === null ? "検索中" : "未選択")}</span>
        </button>
        <button className={`refresh-button ${refreshing ? "is-spinning" : ""}`} onClick={() => load()} type="button" aria-label="差分を更新" disabled={!activeRepoId}><Icon name="refresh" /></button>
      </header>

      {repositories?.length === 0 && !error ? <EmptyState noRepositories /> : null}
      {error && !data ? <ErrorState message={error} onRetry={() => repositories?.length ? load() : loadRepositories({ refresh: true })} /> : null}
      {files.length === 0 && data ? <EmptyState /> : null}

      {files.length > 0 ? <>
        <section className="change-summary" aria-label="変更の概要">
          <div><p className="eyebrow">LOCAL CHANGES</p><h1>{data.summary.files}<small> files</small></h1></div>
          <div className="change-counts"><span className="additions">+{data.summary.additions}</span><span className="deletions">−{data.summary.deletions}</span></div>
          <div className="change-meter" aria-hidden="true"><span style={{ flexGrow: Math.max(data.summary.additions, 1) }} /><i style={{ flexGrow: Math.max(data.summary.deletions, 1) }} /></div>
        </section>
        <FileRail files={files} selected={selected} onSelect={setSelected} />
        <main className="diff-stage">
          <div className="file-heading"><div className="file-icon"><Icon name="file" size={17} /></div><div><p>{current.name.split("/").slice(0, -1).join("/") || "root"}</p><h2>{current.name.split("/").at(-1)}</h2></div><span className="change-label">{current.type}</span></div>
          <div className="diff-frame" key={`${current.name}-${data.revision}`}><FileDiff fileDiff={current} disableWorkerPool options={{ diffStyle: "unified", overflow: "wrap", diffIndicators: "bars", lineDiffType: "word", hunkSeparators: "line-info-basic", disableFileHeader: true, stickyHeader: false, theme: "pierre-light", themeType: "light" }} /></div>
        </main>
        <footer className="review-dock"><button type="button" onClick={() => setSelected((selected - 1 + files.length) % files.length)} aria-label="前のファイル"><Icon name="arrow" /></button><div><span>{selected + 1} / {files.length}</span><small>更新 {updated}</small></div><button className="next-button" type="button" onClick={() => setSelected((selected + 1) % files.length)} aria-label="次のファイル"><Icon name="chevron" /></button></footer>
      </> : null}

      {pickerOpen ? <RepositoryPicker repositories={repositories || []} activeId={activeRepoId} onClose={() => setPickerOpen(false)} onSelect={selectRepository} onRefresh={async () => { await loadRepositories({ refresh: true }); }} /> : null}
      {error && data ? <div className="toast" role="status">更新できませんでした。前回の差分を表示中です。</div> : null}
    </div>
  );
}
