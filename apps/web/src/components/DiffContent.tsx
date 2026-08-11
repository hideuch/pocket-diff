import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useState } from "react";
import type { DiffResponse } from "../types";
import { FileRail } from "./FileRail";
import { Icon } from "./Icon";

type DiffContentProps = {
  activeRepoId: string;
  data: DiffResponse;
  files: FileDiffMetadata[];
  current: FileDiffMetadata;
  selected: number;
  onSelect: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
};

const LINE_WRAP_KEY = "pocket-diff:line-wrap";

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]);

function patchBlockAt(patch: string, index: number) {
  return patch.split(/(?=^diff --git )/m).filter((block) => block.startsWith("diff --git "))[index] || "";
}

function isImageFile(name: string) {
  return IMAGE_EXTENSIONS.has(name.split(".").at(-1)?.toLowerCase() || "");
}

export function DiffContent({
  activeRepoId,
  data,
  files,
  current,
  selected,
  onSelect,
  onPrevious,
  onNext,
}: DiffContentProps) {
  const [wrapLines, setWrapLines] = useState(() => window.localStorage.getItem(LINE_WRAP_KEY) !== "scroll");
  const patchBlock = patchBlockAt(data.patch, selected);
  const isBinary = /^Binary files .+ differ$|^GIT binary patch$/m.test(patchBlock);
  const isImage = isImageFile(current.name);
  const isRename = current.type === "rename-pure" || current.type === "rename-changed";
  const showsTextDiff = !isImage && !isBinary && current.type !== "rename-pure" && current.hunks.length > 0;
  const updated = data.generatedAt
    ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(
        new Date(data.generatedAt),
      )
    : "—";

  const toggleLineWrap = () => {
    setWrapLines((currentValue) => {
      const nextValue = !currentValue;
      window.localStorage.setItem(LINE_WRAP_KEY, nextValue ? "wrap" : "scroll");
      return nextValue;
    });
  };

  return (
    <>
      <section className="change-summary" aria-label="変更の概要">
        <div>
          <p className="eyebrow">LOCAL CHANGES</p>
          <h1>
            {data.summary.files}
            <small> files</small>
          </h1>
        </div>
        <div className="change-counts">
          <span className="additions">+{data.summary.additions}</span>
          <span className="deletions">−{data.summary.deletions}</span>
        </div>
        <div className="change-meter" aria-hidden="true">
          <span style={{ flexGrow: Math.max(data.summary.additions, 1) }} />
          <i style={{ flexGrow: Math.max(data.summary.deletions, 1) }} />
        </div>
      </section>

      <FileRail
        files={files}
        selected={selected}
        updated={updated}
        onSelect={onSelect}
        onPrevious={onPrevious}
        onNext={onNext}
      />

      <main className="diff-stage">
        <div className="file-heading">
          <div className="file-icon">
            <Icon name="file" size={17} />
          </div>
          <div>
            <p>{current.name.split("/").slice(0, -1).join("/") || "root"}</p>
            <h2>{current.name.split("/").at(-1)}</h2>
          </div>
          <div className="file-heading-actions">
            <span className="change-label">{current.type}</span>
            {showsTextDiff ? (
              <button
                aria-label={wrapLines ? "コードの折り返しを無効にする" : "コードの折り返しを有効にする"}
                aria-pressed={wrapLines}
                className="wrap-toggle"
                onClick={toggleLineWrap}
                title={wrapLines ? "折返し中。押すと横スクロール表示" : "横スクロール中。押すと折返し表示"}
                type="button"
              >
                <Icon name="wrap" size={16} />
              </button>
            ) : null}
          </div>
        </div>
        {isRename ? <RenameNotice currentName={current.name} previousName={current.prevName} /> : null}
        {isImage ? (
          <ImagePreview
            key={`${current.name}-${data.revision}`}
            activeRepoId={activeRepoId}
            currentName={current.name}
            previousName={current.prevName}
            revision={data.revision}
            type={current.type}
          />
        ) : isBinary ? (
          <BinaryNotice />
        ) : current.type === "rename-pure" ? null : current.hunks.length === 0 ? (
          <EmptyFileNotice />
        ) : (
          <div className="diff-frame" key={`${current.name}-${data.revision}-${wrapLines ? "wrap" : "scroll"}`}>
            <FileDiff
              fileDiff={current}
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
      </main>
    </>
  );
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
