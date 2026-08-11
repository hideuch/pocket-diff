import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

type DiffPanelProps = {
  activeRepoId: string;
  file: FileDiffMetadata;
  index: number;
  isCurrent: boolean;
  patchBlock: string;
  revision: string;
  total: number;
  virtualized: boolean;
  wrapLines: boolean;
  onToggleLineWrap: () => void;
};

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]);
const visibilityCallbacks = new WeakMap<Element, (visible: boolean) => void>();
let visibilityObserver: IntersectionObserver | undefined;

function getVisibilityObserver() {
  if (visibilityObserver || typeof IntersectionObserver === "undefined") return visibilityObserver;
  visibilityObserver = new IntersectionObserver(
    (entries) => entries.forEach((entry) => visibilityCallbacks.get(entry.target)?.(entry.isIntersecting)),
    { rootMargin: "1000px 0px", threshold: 0 },
  );
  return visibilityObserver;
}

function isImageFile(name: string) {
  return IMAGE_EXTENSIONS.has(name.split(".").at(-1)?.toLowerCase() || "");
}

export function DiffPanel({
  activeRepoId,
  file,
  index,
  isCurrent,
  patchBlock,
  revision,
  total,
  virtualized,
  wrapLines,
  onToggleLineWrap,
}: DiffPanelProps) {
  const isBinary = /^Binary files .+ differ$|^GIT binary patch$/m.test(patchBlock);
  const isImage = isImageFile(file.name);
  const isRename = file.type === "rename-pure" || file.type === "rename-changed";
  const showsTextDiff = !isImage && !isBinary && file.type !== "rename-pure" && file.hunks.length > 0;
  const body = (
    <>
      {isRename ? <RenameNotice currentName={file.name} previousName={file.prevName} /> : null}
      {isImage ? (
        <ImagePreview
          key={`${file.name}-${revision}`}
          activeRepoId={activeRepoId}
          currentName={file.name}
          previousName={file.prevName}
          revision={revision}
          type={file.type}
        />
      ) : isBinary ? (
        <BinaryNotice />
      ) : file.type === "rename-pure" ? null : file.hunks.length === 0 ? (
        <EmptyFileNotice />
      ) : (
        <div className="diff-frame" key={`${file.name}-${revision}-${wrapLines ? "wrap" : "scroll"}`}>
          <FileDiff
            fileDiff={file}
            disableWorkerPool
            options={{
              diffStyle: "unified",
              overflow: wrapLines ? "wrap" : "scroll",
              diffIndicators: "bars",
              lineDiffType: "word",
              hunkSeparators: "line-info-basic",
              disableFileHeader: true,
              stickyHeader: false,
              theme: "pierre-light",
              themeType: "light",
            }}
          />
        </div>
      )}
    </>
  );

  return (
    <article
      className={`diff-stage diff-file-panel ${isCurrent ? "is-current" : ""}`}
      data-diff-index={index}
      id={`diff-file-${index}`}
    >
      <div className="file-heading">
        <div className="file-icon">
          <Icon name="file" size={17} />
        </div>
        <div>
          <p>{file.name.split("/").slice(0, -1).join("/") || "root"}</p>
          <h2>{file.name.split("/").at(-1)}</h2>
        </div>
        <div className="file-heading-actions">
          {virtualized ? (
            <span className="all-diff-position">
              {index + 1}/{total}
            </span>
          ) : null}
          <span className="change-label">{file.type}</span>
          {showsTextDiff ? (
            <button
              aria-label={wrapLines ? "コードの折り返しを無効にする" : "コードの折り返しを有効にする"}
              aria-pressed={wrapLines}
              className="wrap-toggle"
              onClick={onToggleLineWrap}
              title={wrapLines ? "折返し中。押すと横スクロール表示" : "横スクロール中。押すと折返し表示"}
              type="button"
            >
              <Icon name="wrap" size={16} />
            </button>
          ) : null}
        </div>
      </div>
      {virtualized ? (
        <VirtualizedDiffBody estimatedHeight={estimateBodyHeight(file, isImage, isBinary)}>{body}</VirtualizedDiffBody>
      ) : (
        body
      )}
    </article>
  );
}

function VirtualizedDiffBody({ children, estimatedHeight }: { children: ReactNode; estimatedHeight: number }) {
  const host = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState(estimatedHeight);

  useEffect(() => {
    const element = host.current;
    const observer = getVisibilityObserver();
    if (!element || !observer) {
      setRendered(true);
      return undefined;
    }
    visibilityCallbacks.set(element, setRendered);
    observer.observe(element);
    return () => {
      observer.unobserve(element);
      visibilityCallbacks.delete(element);
    };
  }, []);

  useEffect(() => {
    if (!rendered || !content.current || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setMeasuredHeight(Math.max(entry.contentRect.height, 1)));
    observer.observe(content.current);
    return () => observer.disconnect();
  }, [rendered]);

  return (
    <div className="virtual-diff-body" ref={host} style={rendered ? undefined : { height: measuredHeight }}>
      {rendered ? <div ref={content}>{children}</div> : <div className="virtual-diff-placeholder" aria-hidden="true" />}
    </div>
  );
}

function estimateBodyHeight(file: FileDiffMetadata, isImage: boolean, isBinary: boolean) {
  if (isImage) return 330;
  if (isBinary || file.type === "rename-pure" || file.hunks.length === 0) return 190;
  return Math.max(160, Math.min(40_000, file.unifiedLineCount * 20 + (file.type === "rename-changed" ? 90 : 16)));
}

function RenameNotice({ currentName, previousName }: { currentName: string; previousName?: string }) {
  return (
    <div className="rename-notice" role="status">
      <div className="special-view-icon rename-view-icon">
        <Icon name="rename" size={20} />
      </div>
      <div className="rename-copy">
        <strong>ファイル名を変更しました</strong>
        <div className="rename-paths">
          <code>{previousName || "以前のファイル"}</code>
          <Icon name="chevron" size={14} />
          <code>{currentName}</code>
        </div>
      </div>
    </div>
  );
}

function BinaryNotice() {
  return (
    <div className="special-file-view" role="status">
      <div className="special-view-icon">
        <Icon name="binary" size={22} />
      </div>
      <strong>バイナリファイルです</strong>
      <p>内容の差分はテキストとして表示できません。</p>
    </div>
  );
}

function EmptyFileNotice() {
  return (
    <div className="special-file-view" role="status">
      <div className="special-view-icon">
        <Icon name="file" size={22} />
      </div>
      <strong>内容が空のファイルです</strong>
      <p>表示できる行の変更はありません。</p>
    </div>
  );
}

function ImagePreview({
  activeRepoId,
  currentName,
  previousName,
  revision,
  type,
}: {
  activeRepoId: string;
  currentName: string;
  previousName?: string;
  revision: string;
  type: FileDiffMetadata["type"];
}) {
  const [failed, setFailed] = useState(false);
  const [dimensions, setDimensions] = useState("");
  const deleted = type === "deleted";
  const source = deleted ? "head" : "working";
  const name = deleted ? previousName || currentName : currentName;
  const params = new URLSearchParams({ repo: activeRepoId, path: name, source, revision });
  const imageURL = `${import.meta.env.BASE_URL}api/image?${params}`;

  return (
    <div className="image-preview">
      <div className="image-preview-meta">
        <span>{deleted ? "変更前の画像" : "変更後の画像"}</span>
        {dimensions ? <code>{dimensions}</code> : null}
      </div>
      <div className="image-canvas">
        {failed ? (
          <div className="image-error" role="status">
            <Icon name="image" size={24} />
            <strong>画像を読み込めませんでした</strong>
            <p>ファイル形式またはサイズを確認してください。</p>
          </div>
        ) : (
          <img
            alt={`${name} のプレビュー`}
            src={imageURL}
            onError={() => setFailed(true)}
            onLoad={(event) =>
              setDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)
            }
          />
        )}
      </div>
    </div>
  );
}
