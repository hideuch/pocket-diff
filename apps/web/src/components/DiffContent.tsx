import type { FileDiffMetadata } from "@pierre/diffs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DiffResponse } from "../types";
import { DiffPanel } from "./DiffPanel";
import { FileRail } from "./FileRail";

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

type ViewMode = "single" | "all";

const LINE_WRAP_KEY = "pocket-diff:line-wrap";
const VIEW_MODE_KEY = "pocket-diff:view-mode";

function patchBlocks(patch: string) {
  return patch.split(/(?=^diff --git )/m).filter((block) => block.startsWith("diff --git "));
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
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    window.localStorage.getItem(VIEW_MODE_KEY) === "all" ? "all" : "single",
  );
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const blocks = useMemo(() => patchBlocks(data.patch), [data.patch]);
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

  const changeViewMode = (nextMode: ViewMode) => {
    setViewMode(nextMode);
    window.localStorage.setItem(VIEW_MODE_KEY, nextMode);
    if (nextMode === "all") {
      window.requestAnimationFrame(() =>
        document.getElementById(`diff-file-${selected}`)?.scrollIntoView({ block: "start" }),
      );
    }
  };

  const selectAndScroll = (index: number) => {
    onSelect(index);
    if (viewMode === "all") {
      window.requestAnimationFrame(() =>
        document.getElementById(`diff-file-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  };

  const previous = () =>
    viewMode === "all" ? selectAndScroll((selected - 1 + files.length) % files.length) : onPrevious();
  const next = () => (viewMode === "all" ? selectAndScroll((selected + 1) % files.length) : onNext());

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

      <div className="view-mode-bar">
        <span>表示</span>
        <div className="view-mode-toggle" role="group" aria-label="差分の表示方法">
          <button
            aria-pressed={viewMode === "single"}
            className={viewMode === "single" ? "is-active" : ""}
            onClick={() => changeViewMode("single")}
            type="button"
          >
            1件
          </button>
          <button
            aria-pressed={viewMode === "all"}
            className={viewMode === "all" ? "is-active" : ""}
            onClick={() => changeViewMode("all")}
            type="button"
          >
            すべて
          </button>
        </div>
      </div>

      <FileRail
        files={files}
        railVisible={viewMode === "single"}
        selected={selected}
        updated={updated}
        onSelect={selectAndScroll}
        onPrevious={previous}
        onNext={next}
      />

      {viewMode === "all" ? (
        <AllDiffs
          activeRepoId={activeRepoId}
          blocks={blocks}
          data={data}
          files={files}
          selected={selected}
          selectedRef={selectedRef}
          wrapLines={wrapLines}
          onActive={onSelect}
          onToggleLineWrap={toggleLineWrap}
        />
      ) : (
        <main className="single-diff">
          <DiffPanel
            activeRepoId={activeRepoId}
            file={current}
            index={selected}
            isCurrent
            patchBlock={blocks[selected] || ""}
            revision={data.revision}
            total={files.length}
            virtualized={false}
            wrapLines={wrapLines}
            onToggleLineWrap={toggleLineWrap}
          />
        </main>
      )}
    </>
  );
}

function AllDiffs({
  activeRepoId,
  blocks,
  data,
  files,
  selected,
  selectedRef,
  wrapLines,
  onActive,
  onToggleLineWrap,
}: {
  activeRepoId: string;
  blocks: string[];
  data: DiffResponse;
  files: FileDiffMetadata[];
  selected: number;
  selectedRef: { current: number };
  wrapLines: boolean;
  onActive: (index: number) => void;
  onToggleLineWrap: () => void;
}) {
  const container = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!container.current || typeof IntersectionObserver === "undefined") return undefined;
    const visible = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        });
        const nearest = [...visible]
          .map((element) => [element, element.getBoundingClientRect().top] as const)
          .toSorted((left, right) => Math.abs(left[1] - 82) - Math.abs(right[1] - 82))[0];
        if (!nearest) return;
        const index = Number((nearest[0] as HTMLElement).dataset.diffIndex);
        if (Number.isInteger(index) && index !== selectedRef.current) onActive(index);
      },
      { rootMargin: "-72px 0px -62% 0px", threshold: 0 },
    );
    container.current
      .querySelectorAll<HTMLElement>("[data-diff-index]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [files.length, onActive, selectedRef]);

  return (
    <main className="all-diffs" ref={container}>
      {files.map((file, index) => (
        <DiffPanel
          activeRepoId={activeRepoId}
          file={file}
          index={index}
          isCurrent={index === selected}
          key={`${file.name}-${index}`}
          patchBlock={blocks[index] || ""}
          revision={data.revision}
          total={files.length}
          virtualized
          wrapLines={wrapLines}
          onToggleLineWrap={onToggleLineWrap}
        />
      ))}
    </main>
  );
}
