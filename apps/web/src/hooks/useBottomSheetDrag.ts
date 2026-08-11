import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

type DragHandleProps = {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export const BOTTOM_SHEET_CLOSE_MS = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280;

export function useBottomSheetDrag(onDismiss: () => void) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const startY = useRef(0);
  const startTime = useRef(0);
  const offsetRef = useRef(0);
  const draggingRef = useRef(false);
  const pointerID = useRef<number | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!draggingRef.current || event.pointerId !== pointerID.current) return;
      offsetRef.current = Math.max(0, event.clientY - startY.current);
      setOffset(offsetRef.current);
    };
    const finish = (event: PointerEvent, cancelled = false) => {
      if (!draggingRef.current || event.pointerId !== pointerID.current) return;
      const elapsed = Math.max(performance.now() - startTime.current, 1);
      const velocity = offsetRef.current / elapsed;
      draggingRef.current = false;
      pointerID.current = null;
      setDragging(false);
      if (!cancelled && (offsetRef.current >= 88 || (offsetRef.current >= 24 && velocity >= 0.55))) {
        dismissRef.current();
        return;
      }
      offsetRef.current = 0;
      setOffset(0);
    };
    const end = (event: PointerEvent) => finish(event);
    const cancel = (event: PointerEvent) => finish(event, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
    };
  }, []);

  const handleProps: DragHandleProps = {
    onPointerDown: (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      startY.current = event.clientY;
      startTime.current = performance.now();
      offsetRef.current = 0;
      pointerID.current = event.pointerId;
      setInteracted(true);
      setOffset(0);
      draggingRef.current = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
  };

  return {
    dragging,
    interacted,
    handleProps,
    reset: () => {
      offsetRef.current = 0;
      draggingRef.current = false;
      pointerID.current = null;
      setOffset(0);
      setDragging(false);
      setInteracted(false);
    },
    sheetStyle: { "--sheet-drag-y": `${offset}px` } as CSSProperties,
  };
}
