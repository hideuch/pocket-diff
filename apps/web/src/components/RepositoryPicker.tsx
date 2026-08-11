import { useCallback, useEffect, useRef, useState } from "react";
import { BOTTOM_SHEET_CLOSE_MS, useBottomSheetDrag } from "../hooks/useBottomSheetDrag";
import type { Repository } from "../types";
import { Icon } from "./Icon";

type RepositoryPickerProps = {
  repositories: Repository[];
  activeId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRefresh: () => Promise<void>;
};

export function RepositoryPicker({ repositories, activeId, onClose, onSelect, onRefresh }: RepositoryPickerProps) {
  const [query, setQuery] = useState("");
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const filtered = repositories.filter((repository) =>
    `${repository.name} ${repository.label} ${repository.branch}`.toLowerCase().includes(query.toLowerCase()),
  );

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, BOTTOM_SHEET_CLOSE_MS);
  }, [closing, onClose]);
  const sheetDrag = useBottomSheetDrag(requestClose);

  const selectRepository = (id: string) => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(() => onSelect(id), BOTTOM_SHEET_CLOSE_MS);
  };

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && requestClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [requestClose]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return (
    <div
      className="picker-backdrop"
      data-state={closing ? "closing" : "open"}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <section
        ref={dialogRef}
        className={`repo-picker ${sheetDrag.dragging ? "is-dragging" : ""} ${sheetDrag.interacted ? "has-interacted" : ""}`}
        data-state={closing ? "closing" : "open"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="repo-picker-title"
        style={sheetDrag.sheetStyle}
        tabIndex={-1}
      >
        <div aria-hidden="true" className="picker-grabber" {...sheetDrag.handleProps} />
        <header className="picker-header">
          <div>
            <p className="eyebrow">ON THIS DEVICE</p>
            <h2 id="repo-picker-title">リポジトリを選ぶ</h2>
          </div>
          <button type="button" onClick={requestClose} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </header>
        <label className="repo-search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・ブランチで検索" />
        </label>
        <div className="repo-list">
          {filtered.map((repository) => (
            <button
              className={`repo-row ${repository.id === activeId ? "is-active" : ""}`}
              key={repository.id}
              onClick={() => selectRepository(repository.id)}
              type="button"
            >
              <span className="repo-row-icon">
                <Icon name="repo" size={17} />
              </span>
              <span className="repo-row-copy">
                <strong>{repository.name}</strong>
                <small>
                  {repository.label} · {repository.branch}
                </small>
              </span>
              <span className={`dirty-count ${repository.changes === 0 ? "is-clean" : ""}`}>
                {repository.changes === 0 ? "clean" : repository.changes}
              </span>
            </button>
          ))}
          {filtered.length === 0 ? <p className="repo-list-empty">一致するリポジトリはありません</p> : null}
        </div>
        <button className="rescan-button" onClick={onRefresh} type="button">
          <Icon name="refresh" size={15} />
          フォルダを再検索
        </button>
      </section>
    </div>
  );
}
