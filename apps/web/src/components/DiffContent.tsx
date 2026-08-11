import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useState } from "react";
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

const LINE_WRAP_KEY = "pocket-diff:line-wrap";

export function DiffContent({ data, files, current, selected, onSelect, onPrevious, onNext }: DiffContentProps) {
  const [wrapLines, setWrapLines] = useState(() => window.localStorage.getItem(LINE_WRAP_KEY) !== "scroll");
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
          </div>
        </div>
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
      </main>
    </>
  );
}
