import type { FileDiffMetadata } from "@pierre/diffs";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BOTTOM_SHEET_CLOSE_MS, useBottomSheetDrag } from "../hooks/useBottomSheetDrag";
import { Icon } from "./Icon";

type FileRailProps = {
  files: FileDiffMetadata[];
  selected: number;
  updated: string;
  onSelect: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
};

export function FileRail({ files, selected, updated, onSelect, onPrevious, onNext }: FileRailProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const selectedRow = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const filteredTree = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const visibleFiles = normalizedQuery
      ? files.filter((file) => file.name.toLowerCase().includes(normalizedQuery))
      : files;
    return buildFileTree(visibleFiles, files);
  }, [files, query]);
  const current = files[selected];
  const currentPath = fileParts(current.name);

  const openDrawer = () => {
    const folders = current.name.split("/").slice(0, -1);
    setCollapsedFolders((collapsed) => {
      const next = new Set(collapsed);
      folders.reduce((path, folder) => {
        const nextPath = path ? `${path}/${folder}` : folder;
        next.delete(nextPath);
        return nextPath;
      }, "");
      return next;
    });
    setQuery("");
    window.clearTimeout(closeTimer.current);
    sheetDrag.reset();
    setDrawerClosing(false);
    setDrawerOpen(true);
  };

  const closeDrawer = useCallback(() => {
    if (!drawerOpen || drawerClosing) return;
    setDrawerClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setDrawerOpen(false);
      setDrawerClosing(false);
    }, BOTTOM_SHEET_CLOSE_MS);
  }, [drawerClosing, drawerOpen]);

  const sheetDrag = useBottomSheetDrag(closeDrawer);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    drawer.current?.focus();
    selectedRow.current?.scrollIntoView({ block: "center" });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && closeDrawer();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeDrawer, drawerOpen]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const selectFile = (index: number) => {
    onSelect(index);
    closeDrawer();
  };

  const toggleFolder = (path: string) => {
    setCollapsedFolders((collapsed) => {
      const next = new Set(collapsed);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <>
      <footer className="review-dock">
        <button type="button" onClick={onPrevious} aria-label="前のファイル">
          <Icon name="arrow" />
        </button>
        <button className="mobile-file-switcher" type="button" onClick={openDrawer}>
          <span className="mobile-file-icon">
            <Icon name="folder" size={15} />
          </span>
          <span className="mobile-file-copy">
            <small>{currentPath.folder}</small>
            <strong>{currentPath.name}</strong>
          </span>
          <span className="mobile-file-position">
            {selected + 1}
            <i>/</i>
            {files.length}
          </span>
          <Icon name="down" size={13} />
        </button>
        <div className="review-status">
          <span>
            {selected + 1} / {files.length}
          </span>
          <small>更新 {updated}</small>
        </div>
        <button className="next-button" type="button" onClick={onNext} aria-label="次のファイル">
          <Icon name="chevron" />
        </button>
      </footer>

      {drawerOpen ? (
        <div
          className="file-drawer-backdrop"
          data-state={drawerClosing ? "closing" : "open"}
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && closeDrawer()}
        >
          <section
            aria-labelledby="file-drawer-title"
            aria-modal="true"
            className={`file-drawer ${sheetDrag.dragging ? "is-dragging" : ""} ${sheetDrag.interacted ? "has-interacted" : ""}`}
            data-state={drawerClosing ? "closing" : "open"}
            ref={drawer}
            role="dialog"
            style={sheetDrag.sheetStyle}
            tabIndex={-1}
          >
            <div aria-hidden="true" className="picker-grabber" {...sheetDrag.handleProps} />
            <header className="file-drawer-header">
              <div>
                <p className="eyebrow">WORKING TREE</p>
                <h2 id="file-drawer-title">変更ファイル</h2>
              </div>
              <span className="file-total">{files.length}</span>
              <button type="button" onClick={closeDrawer} aria-label="閉じる">
                <Icon name="close" />
              </button>
            </header>
            <label className="file-search">
              <Icon name="search" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ファイル名・フォルダで検索"
              />
            </label>
            <div className="file-drawer-list">
              <div className="file-tree" role="tree" aria-label="変更ファイルのツリー">
                {filteredTree.files.map((entry) => (
                  <TreeFile
                    entry={entry}
                    key={`${entry.file.name}-${entry.index}`}
                    onSelect={selectFile}
                    selected={selected}
                    selectedRow={selectedRow}
                  />
                ))}
                {filteredTree.children.map((node) => (
                  <TreeFolder
                    collapsedFolders={collapsedFolders}
                    forceExpanded={Boolean(query.trim())}
                    key={node.path}
                    node={node}
                    onSelect={selectFile}
                    onToggle={toggleFolder}
                    selected={selected}
                    selectedRow={selectedRow}
                  />
                ))}
              </div>
              {filteredTree.count === 0 ? <p className="file-list-empty">一致するファイルはありません</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

type IndexedFile = { file: FileDiffMetadata; index: number };
type FileTreeNode = {
  name: string;
  path: string;
  count: number;
  children: FileTreeNode[];
  files: IndexedFile[];
};
type MutableFileTreeNode = Omit<FileTreeNode, "children"> & { children: Map<string, MutableFileTreeNode> };

type TreeFolderProps = {
  node: FileTreeNode;
  selected: number;
  collapsedFolders: Set<string>;
  forceExpanded: boolean;
  selectedRow: RefObject<HTMLButtonElement | null>;
  onSelect: (index: number) => void;
  onToggle: (path: string) => void;
};

function TreeFolder({
  node,
  selected,
  collapsedFolders,
  forceExpanded,
  selectedRow,
  onSelect,
  onToggle,
}: TreeFolderProps) {
  const expanded = forceExpanded || !collapsedFolders.has(node.path);

  return (
    <div className="file-tree-folder">
      <button
        aria-expanded={expanded}
        className="file-tree-folder-row"
        onClick={() => onToggle(node.path)}
        role="treeitem"
        type="button"
      >
        <span className={`tree-chevron ${expanded ? "is-expanded" : ""}`}>
          <Icon name="chevron" size={13} />
        </span>
        <Icon name="folder" size={15} />
        <strong>{node.name}</strong>
        <small>{node.count}</small>
      </button>
      <div aria-hidden={!expanded} className={`file-tree-collapse ${expanded ? "is-expanded" : ""}`} inert={!expanded}>
        <div className="file-tree-children" role="group">
          {node.files.map((entry) => (
            <TreeFile
              entry={entry}
              key={`${entry.file.name}-${entry.index}`}
              onSelect={onSelect}
              selected={selected}
              selectedRow={selectedRow}
            />
          ))}
          {node.children.map((child) => (
            <TreeFolder
              collapsedFolders={collapsedFolders}
              forceExpanded={forceExpanded}
              key={child.path}
              node={child}
              onSelect={onSelect}
              onToggle={onToggle}
              selected={selected}
              selectedRow={selectedRow}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

type TreeFileProps = {
  entry: IndexedFile;
  selected: number;
  selectedRow: RefObject<HTMLButtonElement | null>;
  onSelect: (index: number) => void;
};

function TreeFile({ entry, selected, selectedRow, onSelect }: TreeFileProps) {
  const isSelected = entry.index === selected;
  return (
    <button
      aria-current={isSelected ? "true" : undefined}
      className={`file-drawer-row ${isSelected ? "is-selected" : ""}`}
      onClick={() => onSelect(entry.index)}
      ref={isSelected ? selectedRow : undefined}
      role="treeitem"
      type="button"
    >
      <span className={`change-dot change-${entry.file.type}`} />
      <span>{entry.file.name.split("/").at(-1)}</span>
      <small>{entry.file.type}</small>
    </button>
  );
}

function buildFileTree(files: FileDiffMetadata[], sourceFiles: FileDiffMetadata[]): FileTreeNode {
  const root: MutableFileTreeNode = { name: "", path: "", count: 0, children: new Map(), files: [] };

  files.forEach((file) => {
    const parts = file.name.split("/");
    const folders = parts.slice(0, -1);
    const entry = { file, index: sourceFiles.indexOf(file) };
    let current = root;
    current.count += 1;

    folders.forEach((name) => {
      const path = current.path ? `${current.path}/${name}` : name;
      let child = current.children.get(name);
      if (!child) {
        child = { name, path, count: 0, children: new Map(), files: [] };
        current.children.set(name, child);
      }
      child.count += 1;
      current = child;
    });
    current.files.push(entry);
  });

  return freezeNode(root);
}

function freezeNode(node: MutableFileTreeNode): FileTreeNode {
  return { ...node, children: [...node.children.values()].map(freezeNode) };
}

function fileParts(path: string) {
  const parts = path.split("/");
  return { folder: parts.slice(0, -1).join("/") || "repository root", name: parts.at(-1) };
}
