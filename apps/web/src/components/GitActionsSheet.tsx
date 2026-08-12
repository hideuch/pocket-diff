import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BOTTOM_SHEET_CLOSE_MS, useBottomSheetDrag } from "../hooks/useBottomSheetDrag";
import type { GitFileStatus, GitStatusResponse } from "../types";
import { Icon } from "./Icon";

type GitActionsSheetProps = {
  branch: string;
  busy: boolean;
  files: GitFileStatus[];
  onClose: () => void;
  onCommit: (message: string) => Promise<GitStatusResponse>;
  onDiscard: (path: string) => Promise<GitStatusResponse>;
  onStage: (path: string) => Promise<GitStatusResponse>;
  onStageAll: () => Promise<GitStatusResponse>;
  onUnstage: (path: string) => Promise<GitStatusResponse>;
  onUnstageAll: () => Promise<GitStatusResponse>;
};

const kindLabels: Record<GitFileStatus["kind"], string> = {
  modified: "変更",
  added: "追加",
  deleted: "削除",
  renamed: "移動",
  untracked: "未追跡",
};

export function GitActionsSheet({
  branch,
  busy,
  files,
  onClose,
  onCommit,
  onDiscard,
  onStage,
  onStageAll,
  onUnstage,
  onUnstageAll,
}: GitActionsSheetProps) {
  const [closing, setClosing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sheet = useRef<HTMLElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);
  const staged = useMemo(() => files.filter((file) => file.stage !== "unstaged"), [files]);
  const fullyStaged = useMemo(() => files.filter((file) => file.stage === "staged").length, [files]);

  const requestClose = useCallback(() => {
    if (closing || busy) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, BOTTOM_SHEET_CLOSE_MS);
  }, [busy, closing, onClose]);
  const sheetDrag = useBottomSheetDrag(requestClose);

  useEffect(() => {
    sheet.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && requestClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [requestClose]);

  useEffect(() => {
    if (confirmDiscard && !files.some((file) => file.path === confirmDiscard)) setConfirmDiscard(null);
  }, [confirmDiscard, files]);

  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current);
      window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  const showNotice = (value: string) => {
    setNotice(value);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 1800);
  };

  const stageFile = async (file: GitFileStatus) => {
    setError("");
    try {
      await onStage(file.path);
      showNotice(file.stage === "partial" ? "残りの変更を追加しました" : "ステージに追加しました");
    } catch (operationError) {
      setError(errorMessage(operationError));
    }
  };

  const unstageFile = async (file: GitFileStatus) => {
    setError("");
    try {
      await onUnstage(file.path);
      showNotice("ステージから外しました");
    } catch (operationError) {
      setError(errorMessage(operationError));
    }
  };

  const updateAllStages = async (stageAll: boolean) => {
    setError("");
    try {
      await (stageAll ? onStageAll() : onUnstageAll());
      showNotice(stageAll ? "すべてステージに追加しました" : "すべてステージから外しました");
    } catch (operationError) {
      setError(errorMessage(operationError));
    }
  };

  const discardFile = async (path: string) => {
    setError("");
    try {
      await onDiscard(path);
      setConfirmDiscard(null);
      showNotice("変更を破棄しました");
    } catch (operationError) {
      setError(errorMessage(operationError));
    }
  };

  const commit = async () => {
    const commitMessage = message.trim();
    if (!commitMessage || staged.length === 0) return;
    setError("");
    try {
      await onCommit(commitMessage);
      setMessage("");
      showNotice("コミットしました");
    } catch (operationError) {
      setError(errorMessage(operationError));
    }
  };

  return (
    <div
      className="git-sheet-backdrop"
      data-state={closing ? "closing" : "open"}
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
      role="presentation"
    >
      <section
        aria-labelledby="git-sheet-title"
        aria-modal="true"
        className={`git-sheet ${sheetDrag.dragging ? "is-dragging" : ""} ${sheetDrag.interacted ? "has-interacted" : ""}`}
        data-state={closing ? "closing" : "open"}
        ref={sheet}
        role="dialog"
        style={sheetDrag.sheetStyle}
        tabIndex={-1}
      >
        <div aria-hidden="true" className="picker-grabber" {...sheetDrag.handleProps} />
        <header className="git-sheet-header">
          <div>
            <p className="eyebrow">WORKING TREE</p>
            <h2 id="git-sheet-title">コミットを準備</h2>
            <span>
              <Icon name="branch" size={12} />
              {branch}
            </span>
          </div>
          <button aria-label="閉じる" disabled={busy} onClick={requestClose} type="button">
            <Icon name="close" />
          </button>
        </header>

        <div className="git-stage-progress" aria-label={`${staged.length}/${files.length}ファイルをステージ済み`}>
          <div className="git-stage-summary-row">
            <div>
              <strong>{staged.length}</strong>
              <span>/ {files.length} staged</span>
            </div>
            <div className="git-bulk-actions" role="group" aria-label="ステージの一括操作">
              <button disabled={busy || staged.length === 0} onClick={() => updateAllStages(false)} type="button">
                すべて外す
              </button>
              <button
                disabled={busy || fullyStaged === files.length}
                onClick={() => updateAllStages(true)}
                type="button"
              >
                すべて追加
              </button>
            </div>
          </div>
          <div className="git-stage-track" aria-hidden="true">
            <span style={{ width: `${files.length === 0 ? 0 : (staged.length / files.length) * 100}%` }} />
          </div>
          {fullyStaged !== staged.length ? <small>{staged.length - fullyStaged}件に未追加の変更あり</small> : null}
        </div>

        {error ? <p className="git-operation-message is-error">{error}</p> : null}
        {notice ? <p className="git-operation-message is-success">{notice}</p> : null}

        <div className="git-file-list" aria-label="変更ファイル">
          {files.length === 0 ? (
            <div className="git-clean-state">
              <span>
                <Icon name="check" size={18} />
              </span>
              <strong>作業ツリーはクリーンです</strong>
              <small>コミットされていない変更はありません</small>
            </div>
          ) : null}
          {files.map((file) => {
            const confirming = confirmDiscard === file.path;
            const fileName = file.path.split("/").at(-1);
            const folder = file.path.split("/").slice(0, -1).join("/") || "root";
            return (
              <div className={`git-file-row kind-${file.kind} ${confirming ? "is-confirming" : ""}`} key={file.path}>
                {confirming ? (
                  <div className="git-discard-confirmation">
                    <div>
                      <strong>{file.kind === "untracked" ? "ファイルを削除しますか？" : "変更を破棄しますか？"}</strong>
                      <small>{file.path}</small>
                    </div>
                    <button disabled={busy} onClick={() => setConfirmDiscard(null)} type="button">
                      戻る
                    </button>
                    <button
                      className="git-discard-confirm"
                      disabled={busy}
                      onClick={() => discardFile(file.path)}
                      type="button"
                    >
                      破棄
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="git-change-mark" />
                    <div className="git-file-copy">
                      <small>{folder}</small>
                      <strong>{fileName}</strong>
                      {file.previousPath ? <span>{file.previousPath} から移動</span> : null}
                    </div>
                    <span className="git-kind-label">{kindLabels[file.kind]}</span>
                    <button
                      aria-label={
                        file.stage === "staged"
                          ? `${file.path}をステージから外す`
                          : file.stage === "partial"
                            ? `${file.path}の残りの変更をステージに追加`
                            : `${file.path}をステージに追加`
                      }
                      className={`git-stage-button stage-${file.stage}`}
                      disabled={busy}
                      onClick={() => (file.stage === "staged" ? unstageFile(file) : stageFile(file))}
                      title={file.stage === "staged" ? "ステージから外す" : "ステージに追加"}
                      type="button"
                    >
                      {file.stage === "staged" ? <Icon name="check" size={14} /> : <Icon name="plus" size={14} />}
                    </button>
                    <button
                      aria-label={`${file.path}の変更を破棄`}
                      className="git-discard-button"
                      disabled={busy}
                      onClick={() => setConfirmDiscard(file.path)}
                      title="変更を破棄"
                      type="button"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <footer className="git-commit-composer">
          <label htmlFor="git-commit-message">コミットメッセージ</label>
          <div>
            <input
              autoComplete="off"
              disabled={busy}
              id="git-commit-message"
              maxLength={4096}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") commit();
              }}
              placeholder={staged.length === 0 ? "先にファイルを追加" : "変更内容を入力"}
              value={message}
            />
            <button disabled={busy || staged.length === 0 || !message.trim()} onClick={commit} type="button">
              <Icon name="gitCommit" size={16} />
              {busy ? "処理中" : `${staged.length}件をコミット`}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Git操作を完了できませんでした";
}
