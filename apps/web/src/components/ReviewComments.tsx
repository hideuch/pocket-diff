import type { SelectedLineRange } from "@pierre/diffs";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

const STORAGE_PREFIX = "pocket-diff:review-comments:v2";
const LEGACY_STORAGE_PREFIX = "pocket-diff:review-comments:v1";
const COMMENTS_CHANGED_EVENT = "pocket-diff:review-comments-changed";

export type ReviewCommentView = "diff" | "file";

export type ReviewComment = {
  id: string;
  view: ReviewCommentView;
  body: string;
  start: number;
  end: number;
  side?: SelectedLineRange["side"];
  endSide?: SelectedLineRange["endSide"];
  createdAt: string;
};

type NewReviewComment = Omit<ReviewComment, "id" | "createdAt">;

export type BranchReviewComment = ReviewComment & { path: string };

function readComments(key: string) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) || "[]") as unknown;
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (comment): comment is ReviewComment =>
        typeof comment === "object" &&
        comment !== null &&
        typeof (comment as ReviewComment).id === "string" &&
        typeof (comment as ReviewComment).body === "string" &&
        typeof (comment as ReviewComment).createdAt === "string" &&
        ((comment as ReviewComment).view === "diff" || (comment as ReviewComment).view === "file") &&
        Number.isInteger((comment as ReviewComment).start) &&
        Number.isInteger((comment as ReviewComment).end),
    );
  } catch {
    return [];
  }
}

function branchStoragePrefix(repoId: string, branch: string) {
  return `${STORAGE_PREFIX}:${repoId}:${encodeURIComponent(branch)}:`;
}

function mergeComments(...groups: ReviewComment[][]) {
  return [...new Map(groups.flat().map((comment) => [comment.id, comment])).values()];
}

function notifyCommentsChanged() {
  window.dispatchEvent(new Event(COMMENTS_CHANGED_EVENT));
}

export function readBranchReviewComments(repoId: string, branch: string): BranchReviewComment[] {
  const prefix = branchStoragePrefix(repoId, branch);
  const comments: BranchReviewComment[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const path = key.slice(prefix.length);
    comments.push(...readComments(key).map((comment) => Object.assign({ path }, comment)));
  }
  return comments.toSorted(
    (left, right) =>
      left.path.localeCompare(right.path) || left.start - right.start || left.createdAt.localeCompare(right.createdAt),
  );
}

export function useBranchReviewComments(repoId: string, branch: string) {
  const [comments, setComments] = useState<BranchReviewComment[]>(() => readBranchReviewComments(repoId, branch));

  useEffect(() => {
    const refresh = () => setComments(readBranchReviewComments(repoId, branch));
    refresh();
    window.addEventListener(COMMENTS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(COMMENTS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [branch, repoId]);

  return comments;
}

export function formatReviewCommentsForAgent({
  repository,
  branch,
  base,
  comments,
}: {
  repository: string;
  branch: string;
  base: string;
  comments: BranchReviewComment[];
}) {
  const grouped = comments.reduce((groups, comment) => {
    const fileComments = groups.get(comment.path) || [];
    fileComments.push(comment);
    groups.set(comment.path, fileComments);
    return groups;
  }, new Map<string, BranchReviewComment[]>());
  const sections = [...grouped.entries()].map(([path, fileComments]) => {
    const entries = fileComments.map((comment) => {
      const body = comment.body.replaceAll("\n", "\n  ");
      return `- ${formatReviewRange(comment, comment.view)}\n  ${body}`;
    });
    return `## ${path}\n\n${entries.join("\n\n")}`;
  });
  return [
    "対象箇所を確認し、必要な修正を行ってください。",
    "",
    `Repository: ${repository}`,
    `Branch: ${branch}`,
    `Base: ${base}`,
    `Comments: ${comments.length}`,
    "",
    ...sections,
  ].join("\n");
}

export function useReviewComments(repoId: string, branch: string, path: string, revision: string) {
  const storageKey = `${branchStoragePrefix(repoId, branch)}${path}`;
  const legacyStorageKey = `${LEGACY_STORAGE_PREFIX}:${repoId}:${revision}:${path}`;
  const [comments, setComments] = useState<ReviewComment[]>(() =>
    mergeComments(readComments(storageKey), readComments(legacyStorageKey)),
  );

  useEffect(() => {
    const stored = readComments(storageKey);
    const merged = mergeComments(stored, readComments(legacyStorageKey));
    setComments(merged);
    if (merged.length > stored.length) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(merged));
        notifyCommentsChanged();
      } catch {
        // Keep migrated comments available for this session when browser storage is unavailable.
      }
    }
  }, [legacyStorageKey, storageKey]);

  const updateComments = useCallback(
    (update: (current: ReviewComment[]) => ReviewComment[]) => {
      setComments((current) => {
        const next = update(current);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
          notifyCommentsChanged();
        } catch {
          // Keep comments available for this session when browser storage is unavailable.
        }
        return next;
      });
    },
    [storageKey],
  );

  const addComment = useCallback(
    (comment: NewReviewComment) => {
      const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      updateComments((current) => [...current, { ...comment, id, createdAt: new Date().toISOString() }]);
    },
    [updateComments],
  );

  const removeComment = useCallback(
    (id: string) => updateComments((current) => current.filter((comment) => comment.id !== id)),
    [updateComments],
  );

  return { comments, addComment, removeComment };
}

export function normalizeReviewRange(range: SelectedLineRange): SelectedLineRange {
  if (range.start <= range.end) return range;
  return {
    start: range.end,
    side: range.endSide,
    end: range.start,
    endSide: range.side,
  };
}

export function ReviewCommentComposer({
  fileName,
  range,
  view,
  onCancel,
  onSave,
}: {
  fileName: string;
  range: SelectedLineRange;
  view: ReviewCommentView;
  onCancel: () => void;
  onSave: (body: string) => void;
}) {
  const [body, setBody] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const save = () => {
    const trimmed = body.trim();
    if (trimmed) onSave(trimmed);
  };

  useEffect(() => textarea.current?.focus(), [range]);

  return createPortal(
    <aside className="review-comment-composer" aria-label="選択した行へのコメント">
      <header>
        <div className="review-comment-heading">
          <Icon name="comment" size={16} />
          <div>
            <strong>{formatReviewRange(range, view)}</strong>
            <small>{fileName}</small>
          </div>
        </div>
        <button aria-label="コメント入力を閉じる" onClick={onCancel} type="button">
          <Icon name="close" size={15} />
        </button>
      </header>
      <textarea
        ref={textarea}
        aria-label="コメント"
        placeholder="この行についてコメント"
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") save();
        }}
      />
      <footer>
        <small>この端末に保存されます</small>
        <div>
          <button className="comment-cancel-button" onClick={onCancel} type="button">
            キャンセル
          </button>
          <button className="comment-save-button" disabled={!body.trim()} onClick={save} type="button">
            コメントを保存
          </button>
        </div>
      </footer>
    </aside>,
    document.body,
  );
}

export function ReviewCommentAnnotation({
  comment,
  onDelete,
}: {
  comment: ReviewComment;
  onDelete: (id: string) => void;
}) {
  const created = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(comment.createdAt),
  );
  return (
    <article className="review-comment-annotation">
      <header>
        <span>
          <Icon name="comment" size={14} />
          {formatReviewRange(comment, comment.view)}
        </span>
        <time dateTime={comment.createdAt}>{created}</time>
        <button aria-label="コメントを削除" onClick={() => onDelete(comment.id)} type="button">
          <Icon name="close" size={13} />
        </button>
      </header>
      <p>{comment.body}</p>
    </article>
  );
}

function formatReviewRange(range: SelectedLineRange, view: ReviewCommentView) {
  const lines = range.start === range.end ? `L${range.start}` : `L${range.start}–${range.end}`;
  if (view === "file") return lines;
  const side = range.endSide || range.side;
  return `${side === "deletions" ? "変更前" : "変更後"} ${lines}`;
}
