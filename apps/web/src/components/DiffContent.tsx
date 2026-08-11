import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { DiffResponse } from "../types";
import { FileRail } from "./FileRail";
import { Icon } from "./Icon";

type DiffContentProps = {
  data: DiffResponse;
  files: FileDiffMetadata[];
  current: FileDiffMetadata;
  selected: number;
  onSelect: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
};

export function DiffContent({ data, files, current, selected, onSelect, onPrevious, onNext }: DiffContentProps) {
  const updated = data.generatedAt
    ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(
        new Date(data.generatedAt),
      )
    : "—";

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

      <FileRail files={files} selected={selected} onSelect={onSelect} />

      <main className="diff-stage">
        <div className="file-heading">
          <div className="file-icon">
            <Icon name="file" size={17} />
          </div>
          <div>
            <p>{current.name.split("/").slice(0, -1).join("/") || "root"}</p>
            <h2>{current.name.split("/").at(-1)}</h2>
          </div>
          <span className="change-label">{current.type}</span>
        </div>
        <div className="diff-frame" key={`${current.name}-${data.revision}`}>
          <FileDiff
            fileDiff={current}
            disableWorkerPool
            options={{
              diffStyle: "unified",
              overflow: "wrap",
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
      </main>

      <footer className="review-dock">
        <button type="button" onClick={onPrevious} aria-label="前のファイル">
          <Icon name="arrow" />
        </button>
        <div>
          <span>
            {selected + 1} / {files.length}
          </span>
          <small>更新 {updated}</small>
        </div>
        <button className="next-button" type="button" onClick={onNext} aria-label="次のファイル">
          <Icon name="chevron" />
        </button>
      </footer>
    </>
  );
}
