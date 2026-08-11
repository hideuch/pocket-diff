import type { FileDiffMetadata } from "@pierre/diffs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DiffResponse } from "../types";
import { DiffPanel } from "./DiffPanel";
import { FileRail } from "./FileRail";
import { formatReviewCommentsForAgent, useBranchReviewComments } from "./ReviewComments";
import { Icon } from "./Icon";

type DiffContentProps = {
  activeRepoId: string;
  data: DiffResponse;
  files: FileDiffMetadata[];
  selected: number;
  onSelect: (index: number) => void;
};

const NO_WRAP_FILES_KEY = "pocket-diff:no-wrap-files";

function patchBlocks(patch: string) {
  return patch.split(/(?=^diff --git )/m).filter((block) => block.startsWith("diff --git "));
}

function storedFileSet(key: string) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) || "[]");
    return new Set<string>(
      Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [],
    );
  } catch {
    return new Set<string>();
  }
}

export function DiffContent({ activeRepoId, data, files, selected, onSelect }: DiffContentProps) {
  const [noWrapFiles, setNoWrapFiles] = useState<Set<string>>(() => storedFileSet(NO_WRAP_FILES_KEY));
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());
  const [reviewFileKey, setReviewFileKey] = useState<string | null>(null);
  const [commentsCopied, setCommentsCopied] = useState(false);
  const commentsCopyTimer = useRef<number | undefined>(undefined);
  const reviewComments = useBranchReviewComments(activeRepoId, data.branch);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const blocks = useMemo(() => patchBlocks(data.patch), [data.patch]);
  const updated = data.generatedAt
    ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(
        new Date(data.generatedAt),
      )
    : "—";

  useEffect(() => () => window.clearTimeout(commentsCopyTimer.current), []);

  const copyReviewComments = async () => {
    if (reviewComments.length === 0) return;
    const text = formatReviewCommentsForAgent({
      repository: data.repo,
      branch: data.branch,
      base: data.base,
      comments: reviewComments,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCommentsCopied(true);
      window.clearTimeout(commentsCopyTimer.current);
      commentsCopyTimer.current = window.setTimeout(() => setCommentsCopied(false), 1800);
    } catch {
      setCommentsCopied(false);
    }
  };

  const toggleLineWrap = (fileKey: string) => {
    setNoWrapFiles((currentFiles) => {
      const nextFiles = new Set(currentFiles);
      if (nextFiles.has(fileKey)) nextFiles.delete(fileKey);
      else nextFiles.add(fileKey);
      window.localStorage.setItem(NO_WRAP_FILES_KEY, JSON.stringify([...nextFiles]));
      return nextFiles;
    });
  };

  const selectAndScroll = (index: number) => {
    onSelect(index);
    window.requestAnimationFrame(() =>
      document.getElementById(`diff-file-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  const previous = () => selectAndScroll((selected - 1 + files.length) % files.length);
  const next = () => selectAndScroll((selected + 1) % files.length);
  const toggleFile = (fileKey: string) => {
    setCollapsedFiles((currentFiles) => {
      const nextFiles = new Set(currentFiles);
      if (nextFiles.has(fileKey)) nextFiles.delete(fileKey);
      else nextFiles.add(fileKey);
      return nextFiles;
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
        onSelect={selectAndScroll}
        onPrevious={previous}
        onNext={next}
      />

      <AllDiffs
        activeRepoId={activeRepoId}
        blocks={blocks}
        collapsedFiles={collapsedFiles}
        data={data}
        files={files}
        noWrapFiles={noWrapFiles}
        reviewFileKey={reviewFileKey}
        selected={selected}
        selectedRef={selectedRef}
        onActive={onSelect}
        onToggleFile={toggleFile}
        onToggleLineWrap={toggleLineWrap}
        onReviewFileChange={setReviewFileKey}
      />

      {reviewComments.length > 0 ? (
        <>
          <div className="review-export-clearance" aria-hidden="true" />
          <button
            aria-label={`${reviewComments.length}件のコメントをコピー`}
            className={`review-export-bar ${commentsCopied ? "is-copied" : ""}`}
            onClick={copyReviewComments}
            type="button"
          >
            <Icon name={commentsCopied ? "check" : "copy"} size={14} />
            <span>{commentsCopied ? "コピーしました" : `${reviewComments.length}件のコメントをコピー`}</span>
          </button>
        </>
      ) : null}
    </>
  );
}

function AllDiffs({
  activeRepoId,
  blocks,
  collapsedFiles,
  data,
  files,
  noWrapFiles,
  reviewFileKey,
  selected,
  selectedRef,
  onActive,
  onToggleFile,
  onToggleLineWrap,
  onReviewFileChange,
}: {
  activeRepoId: string;
  blocks: string[];
  collapsedFiles: Set<string>;
  data: DiffResponse;
  files: FileDiffMetadata[];
  noWrapFiles: Set<string>;
  reviewFileKey: string | null;
  selected: number;
  selectedRef: { current: number };
  onActive: (index: number) => void;
  onToggleFile: (fileKey: string) => void;
  onToggleLineWrap: (fileKey: string) => void;
  onReviewFileChange: (fileKey: string | null) => void;
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
      {files.map((file, index) => {
        const fileKey = `${activeRepoId}:${file.prevName || ""}:${file.name}`;
        return (
          <DiffPanel
            activeRepoId={activeRepoId}
            branch={data.branch}
            expanded={!collapsedFiles.has(fileKey)}
            file={file}
            index={index}
            isCurrent={index === selected}
            key={fileKey}
            patchBlock={blocks[index] || ""}
            revision={data.revision}
            reviewActive={reviewFileKey === fileKey}
            total={files.length}
            wrapLines={!noWrapFiles.has(fileKey)}
            onToggleExpanded={() => onToggleFile(fileKey)}
            onToggleLineWrap={() => onToggleLineWrap(fileKey)}
            onActivateReview={() => onReviewFileChange(fileKey)}
            onDeactivateReview={() => onReviewFileChange(null)}
          />
        );
      })}
    </main>
  );
}
