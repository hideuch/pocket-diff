import { useCallback, useEffect, useRef, useState } from "react";
import { BOTTOM_SHEET_CLOSE_MS, useBottomSheetDrag } from "../hooks/useBottomSheetDrag";
import { APP_THEMES, type AppTheme } from "../themes";
import { Icon } from "./Icon";

export function ThemePicker({
  activeTheme,
  onClose,
  onSelect,
}: {
  activeTheme: AppTheme;
  onClose: () => void;
  onSelect: (theme: AppTheme) => void;
}) {
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, BOTTOM_SHEET_CLOSE_MS);
  }, [closing, onClose]);
  const sheetDrag = useBottomSheetDrag(requestClose);

  const selectTheme = (theme: AppTheme) => {
    if (closing) return;
    onSelect(theme);
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, BOTTOM_SHEET_CLOSE_MS);
  };

  useEffect(() => dialogRef.current?.focus(), []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && requestClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [requestClose]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return (
    <div
      className="picker-backdrop"
      data-state={closing ? "closing" : "open"}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <section
        ref={dialogRef}
        aria-labelledby="theme-picker-title"
        aria-modal="true"
        className={`repo-picker theme-picker ${sheetDrag.dragging ? "is-dragging" : ""} ${sheetDrag.interacted ? "has-interacted" : ""}`}
        data-state={closing ? "closing" : "open"}
        role="dialog"
        style={sheetDrag.sheetStyle}
        tabIndex={-1}
      >
        <div aria-hidden="true" className="picker-grabber" {...sheetDrag.handleProps} />
        <header className="picker-header">
          <div>
            <p className="eyebrow">APPEARANCE</p>
            <h2 id="theme-picker-title">テーマを選ぶ</h2>
          </div>
          <button type="button" onClick={requestClose} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </header>
        <div className="theme-list">
          {APP_THEMES.map((theme) => (
            <button
              aria-pressed={theme.id === activeTheme}
              className={`theme-row theme-${theme.id} ${theme.id === activeTheme ? "is-active" : ""}`}
              key={theme.id}
              onClick={() => selectTheme(theme.id)}
              type="button"
            >
              <span className="theme-swatch" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>
                <strong>{theme.label}</strong>
                <small>{theme.description}</small>
              </span>
              {theme.id === activeTheme ? <Icon name="check" size={16} /> : null}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
