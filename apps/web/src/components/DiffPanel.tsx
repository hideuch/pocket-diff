import type { FileDiffMetadata } from "@pierre/diffs";
import { File, FileDiff } from "@pierre/diffs/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { ApiError, FileResponse } from "../types";
import { Icon } from "./Icon";

type DiffPanelProps = {
  activeRepoId: string;
  expanded: boolean;
  file: FileDiffMetadata;
  index: number;
  isCurrent: boolean;
  patchBlock: string;
  revision: string;
  total: number;
  wrapLines: boolean;
  onToggleExpanded: () => void;
  onToggleLineWrap: () => void;
};

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]);
const FILE_COLLAPSE_MS = 240;
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
  expanded,
  file,
  index,
  isCurrent,
  patchBlock,
  revision,
  total,
  wrapLines,
  onToggleExpanded,
  onToggleLineWrap,
}: DiffPanelProps) {
  const [bodyMounted, setBodyMounted] = useState(true);
  const [fullFileView, setFullFileView] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const collapseTimer = useRef<number | undefined>(undefined);
  const copyTimer = useRef<number | undefined>(undefined);
  const isBinary = /^Binary files .+ differ$|^GIT binary patch$/m.test(patchBlock);
  const isImage = isImageFile(file.name);
  const isRename = file.type === "rename-pure" || file.type === "rename-changed";
  const canShowFullFile = !isImage && !isBinary;
  const showsTextDiff = !isImage && !isBinary && file.type !== "rename-pure" && file.hunks.length > 0;
  const diffBody = (
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
  const body = fullFileView ? (
    <FullFileView activeRepoId={activeRepoId} file={file} revision={revision} wrapLines={wrapLines} />
  ) : (
    diffBody
  );

  useEffect(() => {
    if (expanded) setBodyMounted(true);
  }, [expanded]);

  useEffect(
    () => () => {
      window.clearTimeout(collapseTimer.current);
      window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const copyPath = async () => {
    try {
      await copyText(file.name);
      setPathCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setPathCopied(false), 1600);
    } catch {
      setPathCopied(false);
    }
  };

  const toggleExpanded = () => {
    window.clearTimeout(collapseTimer.current);
    if (expanded) {
      onToggleExpanded();
      collapseTimer.current = window.setTimeout(() => setBodyMounted(false), FILE_COLLAPSE_MS);
      return;
    }
    setBodyMounted(true);
    window.requestAnimationFrame(onToggleExpanded);
  };

  return (
    <article
      className={`diff-stage diff-file-panel change-${file.type} ${isCurrent ? "is-current" : ""} ${expanded ? "is-expanded" : "is-collapsed"}`}
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
          <span className="all-diff-position">
            {index + 1}/{total}
          </span>
          <span className="visually-hidden">変更種別: {getChangeTypeLabel(file.type)}</span>
          {canShowFullFile ? (
            <button
              aria-label={fullFileView ? `${file.name}の差分を表示` : `${file.name}のファイル全体を表示`}
              aria-pressed={fullFileView}
              className="full-file-toggle"
              onClick={() => setFullFileView((current) => !current)}
              title={fullFileView ? "差分表示に戻す" : "ファイル全体を表示"}
              type="button"
            >
              <Icon name="document" size={15} />
            </button>
          ) : null}
          <button
            aria-label={pathCopied ? `${file.name}をコピーしました` : `${file.name}をコピー`}
            className={`copy-path-toggle ${pathCopied ? "is-copied" : ""}`}
            onClick={copyPath}
            title={pathCopied ? "コピーしました" : "ファイルパスをコピー"}
            type="button"
          >
            <Icon name={pathCopied ? "check" : "copy"} size={15} />
          </button>
          {showsTextDiff || fullFileView ? (
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
          <button
            aria-expanded={expanded}
            aria-label={expanded ? `${file.name}を折りたたむ` : `${file.name}を展開する`}
            className={`file-collapse-toggle ${expanded ? "is-expanded" : ""}`}
            onClick={toggleExpanded}
            title={expanded ? "ファイルを折りたたむ" : "ファイルを展開する"}
            type="button"
          >
            <Icon name="chevron" size={15} />
          </button>
        </div>
      </div>
      <div aria-hidden={!expanded} className={`diff-panel-collapse ${expanded ? "is-expanded" : ""}`} inert={!expanded}>
        <div className="diff-panel-collapse-inner">
          {bodyMounted ? (
            <VirtualizedDiffBody estimatedHeight={estimateBodyHeight(file, isImage, isBinary)}>
              {body}
            </VirtualizedDiffBody>
          ) : null}
        </div>
      </div>
    </article>
  );
}

type FullFileState =
  | { status: "loading" }
  | { status: "ready"; data: FileResponse }
  | { status: "error"; message: string };

function FullFileView({
  activeRepoId,
  file,
  revision,
  wrapLines,
}: {
  activeRepoId: string;
  file: FileDiffMetadata;
  revision: string;
  wrapLines: boolean;
}) {
  const deleted = file.type === "deleted";
  const source = deleted ? "head" : "working";
  const name = deleted ? file.prevName || file.name : file.name;
  const [state, setState] = useState<FullFileState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setState({ status: "loading" });
      try {
        const params = new URLSearchParams({ repo: activeRepoId, path: name, source, revision });
        const response = await fetch(`${import.meta.env.BASE_URL}api/file?${params}`, {
          cache: "no-cache",
          signal: controller.signal,
        });
        const result = (await response.json()) as FileResponse & ApiError;
        if (!response.ok) throw new Error(result.detail || result.error || "ファイルを読み込めませんでした");
        setState({ status: "ready", data: result });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "ファイルを読み込めませんでした",
        });
      }
    };
    load();
    return () => controller.abort();
  }, [activeRepoId, name, revision, source]);

  if (state.status === "loading") {
    return (
      <div className="full-file-loading" role="status">
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="special-file-view" role="alert">
        <div className="special-view-icon">
          <Icon name="document" size={22} />
        </div>
        <strong>ファイル全体を表示できません</strong>
        <p>{state.message}</p>
      </div>
    );
  }

  const lines = state.data.content === "" ? 0 : state.data.content.split("\n").length;
  return (
    <div className={`full-file-view ${wrapLines ? "is-wrapped" : "is-scrollable"}`}>
      <div className="full-file-meta">
        <span>
          <Icon name="document" size={14} />
          FILE CONTENT
        </span>
        <span>{state.data.source === "head" ? "削除前 (HEAD)" : "作業ツリー"}</span>
        <small>
          {lines} lines · {formatBytes(state.data.size)}
        </small>
      </div>
      {state.data.content === "" ? (
        <div className="full-file-empty">空のファイルです</div>
      ) : (
        <File
          key={`${name}-${revision}-${wrapLines ? "wrap" : "scroll"}`}
          className="full-file-code"
          disableWorkerPool
          file={{ name, contents: state.data.content }}
          options={{
            disableFileHeader: true,
            disableLineNumbers: false,
            overflow: wrapLines ? "wrap" : "scroll",
            stickyHeader: false,
            theme: "pierre-light",
            themeType: "light",
          }}
        />
      )}
    </div>
  );
}

function getChangeTypeLabel(type: FileDiffMetadata["type"]) {
  switch (type) {
    case "new":
      return "追加";
    case "deleted":
      return "削除";
    case "rename-pure":
    case "rename-changed":
      return "名前変更";
    default:
      return "変更";
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Unable to copy file path");
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
