import type { FileDiffMetadata } from "@pierre/diffs";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { DiffResponse } from "../types";
import type { AppThemeDefinition } from "../themes";
import { DiffPanel, renderDiffBodiesForScroll, setDiffVirtualizationPaused } from "./DiffPanel";
import { FileRail } from "./FileRail";
import { clearBranchReviewComments, formatReviewCommentsForAgent, useBranchReviewComments } from "./ReviewComments";
import { Icon } from "./Icon";

type DiffContentProps = {
  activeRepoId: string;
  data: DiffResponse;
  files: FileDiffMetadata[];
  selected: number;
  stagedFiles: number;
  changedFiles: number;
  theme: AppThemeDefinition;
  onDiscardLines: (path: string, side: "additions" | "deletions", start: number, end: number) => Promise<void>;
  onOpenGitActions: () => void;
  onSelect: (index: number) => void;
};

const NO_WRAP_FILES_KEY = "pocket-diff:no-wrap-files";
const FILE_HEADER_GAP = 4;
const MAX_SMOOTH_SCROLL_VIEWPORTS = 2;
const TARGET_RENDER_TIMEOUT_MS = 1200;
const TARGET_STABLE_FRAMES = 4;
const SCROLL_SETTLE_FALLBACK_MS = 1000;
const STABLE_LAYOUT_MS = 750;
const MAX_LAYOUT_SETTLE_MS = 5000;

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

function DiffContentView({
  activeRepoId,
  data,
  files,
  selected,
  stagedFiles,
  changedFiles,
  theme,
  onDiscardLines,
  onOpenGitActions,
  onSelect,
}: DiffContentProps) {
  const [noWrapFiles, setNoWrapFiles] = useState<Set<string>>(() => storedFileSet(NO_WRAP_FILES_KEY));
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());
  const [reviewFileKey, setReviewFileKey] = useState<string | null>(null);
  const [commentsCopied, setCommentsCopied] = useState(false);
  const [confirmingCommentDelete, setConfirmingCommentDelete] = useState(false);
  const commentsCopyTimer = useRef<number | undefined>(undefined);
  const scrollFrame = useRef<number | undefined>(undefined);
  const scrollFallbackTimer = useRef<number | undefined>(undefined);
  const scrollAbortController = useRef<AbortController | undefined>(undefined);
  const scrollIntentAbortController = useRef<AbortController | undefined>(undefined);
  const programmaticScroll = useRef(false);
  const scrollTarget = useRef<number | null>(null);
  const reviewComments = useBranchReviewComments(activeRepoId, data.branch);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const blocks = useMemo(() => patchBlocks(data.patch), [data.patch]);
  useEffect(
    () => () => {
      window.clearTimeout(commentsCopyTimer.current);
      window.clearTimeout(scrollFallbackTimer.current);
      window.cancelAnimationFrame(scrollFrame.current || 0);
      scrollAbortController.current?.abort();
      scrollIntentAbortController.current?.abort();
      setDiffVirtualizationPaused(false);
    },
    [],
  );
  useEffect(() => {
    if (reviewComments.length === 0) setConfirmingCommentDelete(false);
  }, [reviewComments.length]);

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

  const deleteReviewComments = () => {
    clearBranchReviewComments(activeRepoId, data.branch);
    setConfirmingCommentDelete(false);
    setCommentsCopied(false);
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
    scrollTarget.current = index;
    programmaticScroll.current = true;
    window.clearTimeout(scrollFallbackTimer.current);
    window.cancelAnimationFrame(scrollFrame.current || 0);
    scrollAbortController.current?.abort();
    scrollIntentAbortController.current?.abort();
    setDiffVirtualizationPaused(true);
    let preparedPanels: HTMLElement[] = [];
    const intentController = new AbortController();
    scrollIntentAbortController.current = intentController;
    const stopTracking = () => {
      if (scrollTarget.current !== index) return;
      intentController.abort();
      window.clearTimeout(scrollFallbackTimer.current);
      window.cancelAnimationFrame(scrollFrame.current || 0);
      programmaticScroll.current = false;
      scrollTarget.current = null;
    };
    const stopForUserIntent = () => {
      if (scrollTarget.current !== index) return;
      scrollAbortController.current?.abort();
      stopTracking();
      setDiffVirtualizationPaused(false, preparedPanels);
    };
    const stopOnScrollKey = (event: KeyboardEvent) => {
      if (isScrollKey(event)) stopForUserIntent();
    };
    window.addEventListener("wheel", stopForUserIntent, { passive: true, signal: intentController.signal });
    window.addEventListener("touchstart", stopForUserIntent, { passive: true, signal: intentController.signal });
    window.addEventListener("pointerdown", stopForUserIntent, { passive: true, signal: intentController.signal });
    window.addEventListener("keydown", stopOnScrollKey, { signal: intentController.signal });

    scrollFrame.current = window.requestAnimationFrame(async () => {
      const target = document.getElementById(`diff-file-${index}`);
      if (!target) {
        stopTracking();
        setDiffVirtualizationPaused(false);
        return;
      }

      const controller = new AbortController();
      scrollAbortController.current = controller;
      preparedPanels = renderDiffBodiesForScroll(target);
      await waitForDiffBodies(preparedPanels, index, scrollTarget);
      if (scrollTarget.current !== index) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const destination = fileHeaderScrollDestination(target);
      const scrollBehavior =
        reducedMotion || Math.abs(window.scrollY - destination) > window.innerHeight * MAX_SMOOTH_SCROLL_VIEWPORTS
          ? "auto"
          : "smooth";
      let finished = false;
      let virtualizationResumed = false;
      const finishScroll = () => {
        if (finished || scrollTarget.current !== index) return;
        finished = true;
        window.clearTimeout(scrollFallbackTimer.current);
        controller.abort();
        if (!virtualizationResumed) setDiffVirtualizationPaused(false, preparedPanels);
        const settleStartedAt = performance.now();
        let stableSince: number | null = null;
        const settleLayout = () => {
          if (scrollTarget.current !== index) return;
          const now = performance.now();
          if (alignFileHeader(index, "auto")) stableSince ??= now;
          else stableSince = null;

          if (
            (stableSince !== null && now - stableSince >= STABLE_LAYOUT_MS) ||
            now - settleStartedAt >= MAX_LAYOUT_SETTLE_MS
          ) {
            stopTracking();
            return;
          }
          scrollFrame.current = window.requestAnimationFrame(settleLayout);
        };
        scrollFrame.current = window.requestAnimationFrame(settleLayout);
      };

      if (scrollBehavior === "smooth") {
        onSelect(index);
        window.addEventListener("scrollend", finishScroll, { once: true, signal: controller.signal });
        scrollFallbackTimer.current = window.setTimeout(finishScroll, SCROLL_SETTLE_FALLBACK_MS);
        window.scrollTo({ top: destination, behavior: scrollBehavior });
      } else if (reducedMotion) {
        commitScrollPosition(target, preparedPanels, () => onSelect(index));
        virtualizationResumed = true;
      } else {
        await transitionToScrollPosition(target, preparedPanels, () => onSelect(index));
        virtualizationResumed = true;
      }
      if (scrollBehavior === "auto") runAfterAnimationFrames(finishScroll, 3);
    });
  };

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
        changedFiles={changedFiles}
        files={files}
        selected={selected}
        stagedFiles={stagedFiles}
        onOpenGitActions={onOpenGitActions}
        onSelect={selectAndScroll}
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
        programmaticScroll={programmaticScroll}
        theme={theme}
        onActive={onSelect}
        onDiscardLines={onDiscardLines}
        onToggleFile={toggleFile}
        onToggleLineWrap={toggleLineWrap}
        onReviewFileChange={setReviewFileKey}
      />

      {reviewComments.length > 0 ? (
        <>
          <div className="review-export-clearance" aria-hidden="true" />
          <div
            aria-label="コメントの一括操作"
            className={`review-export-bar ${commentsCopied ? "is-copied" : ""} ${confirmingCommentDelete ? "is-confirming-delete" : ""}`}
            role="group"
          >
            {confirmingCommentDelete ? (
              <>
                <span className="review-delete-prompt">{reviewComments.length}件をすべて削除しますか？</span>
                <button onClick={() => setConfirmingCommentDelete(false)} type="button">
                  キャンセル
                </button>
                <button className="review-delete-confirm" onClick={deleteReviewComments} type="button">
                  削除
                </button>
              </>
            ) : (
              <>
                <button
                  aria-label={`${reviewComments.length}件のコメントをコピー`}
                  className="review-export-copy"
                  onClick={copyReviewComments}
                  type="button"
                >
                  <Icon name={commentsCopied ? "check" : "copy"} size={14} />
                  <span>{commentsCopied ? "コピーしました" : `${reviewComments.length}件のコメントをコピー`}</span>
                </button>
                <button
                  aria-label={`${reviewComments.length}件のコメントをすべて削除`}
                  className="review-export-delete"
                  onClick={() => setConfirmingCommentDelete(true)}
                  type="button"
                >
                  <Icon name="trash" size={14} />
                </button>
              </>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}

export const DiffContent = memo(DiffContentView);

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
  programmaticScroll,
  theme,
  onActive,
  onDiscardLines,
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
  programmaticScroll: { current: boolean };
  theme: AppThemeDefinition;
  onActive: (index: number) => void;
  onDiscardLines: DiffContentProps["onDiscardLines"];
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
        if (programmaticScroll.current) return;
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
  }, [files.length, onActive, programmaticScroll, selectedRef]);

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
            codeTheme={theme.codeTheme}
            codeThemeType={theme.themeType}
            wrapLines={!noWrapFiles.has(fileKey)}
            onDiscardLines={onDiscardLines}
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

function isScrollKey(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  return ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key);
}

function alignFileHeader(index: number, behavior: ScrollBehavior) {
  const target = document.getElementById(`diff-file-${index}`);
  if (!target) return true;
  const destination = fileHeaderScrollDestination(target);
  const aligned = Math.abs(window.scrollY - destination) < 0.5;
  if (!aligned) window.scrollTo({ top: destination, behavior });
  return aligned;
}

function fileHeaderScrollDestination(target: HTMLElement) {
  const headerBottom = document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect().bottom || 0;
  const targetTop = window.scrollY + target.getBoundingClientRect().top - headerBottom - FILE_HEADER_GAP;
  const maxScrollTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return Math.min(Math.max(targetTop, 0), maxScrollTop);
}

function waitForDiffBodies(panels: HTMLElement[], index: number, scrollTarget: { current: number | null }) {
  const startedAt = performance.now();
  let stableFrames = 0;
  let previousHeight = -1;
  return new Promise<void>((resolve) => {
    const check = () => {
      if (scrollTarget.current !== index || performance.now() - startedAt >= TARGET_RENDER_TIMEOUT_MS) {
        resolve();
        return;
      }
      const bodies = panels.flatMap((panel) => {
        const body = panel.querySelector<HTMLElement>(".virtual-diff-body");
        return body ? [body] : [];
      });
      if (bodies.some((body) => body.querySelector(".virtual-diff-placeholder"))) stableFrames = 0;
      else {
        const height = bodies.reduce((total, body) => total + body.getBoundingClientRect().height, 0);
        if (Math.abs(height - previousHeight) < 0.5) stableFrames += 1;
        else stableFrames = 0;
        previousHeight = height;
      }
      if (stableFrames >= TARGET_STABLE_FRAMES) resolve();
      else window.requestAnimationFrame(check);
    };
    window.requestAnimationFrame(check);
  });
}

function commitScrollPosition(target: HTMLElement, visiblePanels: HTMLElement[], select: () => void) {
  flushSync(() => {
    select();
    setDiffVirtualizationPaused(false, visiblePanels);
  });
  window.scrollTo({ top: fileHeaderScrollDestination(target), behavior: "auto" });
}

async function transitionToScrollPosition(target: HTMLElement, visiblePanels: HTMLElement[], select: () => void) {
  const update = () => {
    commitScrollPosition(target, visiblePanels, select);
  };
  if (!document.startViewTransition) {
    update();
    return;
  }
  try {
    const transition = document.startViewTransition(update);
    await transition.updateCallbackDone;
  } catch {
    update();
  }
}

function runAfterAnimationFrames(callback: () => void, frames: number) {
  if (frames <= 0) {
    callback();
    return;
  }
  window.requestAnimationFrame(() => runAfterAnimationFrames(callback, frames - 1));
}
