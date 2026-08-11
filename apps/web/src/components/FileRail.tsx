import type { FileDiffMetadata } from "@pierre/diffs";
import { useEffect, useMemo, useRef } from "react";
import { Icon } from "./Icon";

type FileRailProps = {
  files: FileDiffMetadata[];
  selected: number;
  onSelect: (index: number) => void;
};

export function FileRail({ files, selected, onSelect }: FileRailProps) {
  const selectedItem = useRef<HTMLButtonElement>(null);
  const groups = useMemo(() => groupByFolder(files), [files]);

  useEffect(() => {
    selectedItem.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selected]);

  return (
    <nav className="file-rail" aria-label="変更ファイル">
      {groups.map((group) => {
        const path = folderParts(group.folder);
        return (
          <section className="folder-group" aria-label={`${group.folder} フォルダ`} key={group.folder}>
            <div className="folder-group-heading" title={group.folder}>
              <Icon name="folder" size={13} />
              <span className="folder-path">
                {path.parents ? <span>{path.parents}/</span> : null}
                <strong>{path.current}</strong>
              </span>
              <small>{group.files.length}</small>
            </div>
            <div className="folder-files">
              {group.files.map(({ file, index }) => (
                <button
                  aria-current={index === selected ? "true" : undefined}
                  className={`file-pill ${index === selected ? "is-selected" : ""}`}
                  key={`${file.name}-${index}`}
                  onClick={() => onSelect(index)}
                  ref={index === selected ? selectedItem : undefined}
                  title={file.name}
                  type="button"
                >
                  <span className={`change-dot change-${file.type}`} />
                  <span className="file-pill-name">{file.name.split("/").at(-1)}</span>
                  <span className="file-pill-count">
                    {index + 1}/{files.length}
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </nav>
  );
}

function groupByFolder(files: FileDiffMetadata[]) {
  const groups = new Map<string, { file: FileDiffMetadata; index: number }[]>();
  files.forEach((file, index) => {
    const folder = file.name.split("/").slice(0, -1).join("/") || "repository root";
    groups.set(folder, [...(groups.get(folder) || []), { file, index }]);
  });
  return [...groups].map(([folder, groupedFiles]) => ({ folder, files: groupedFiles }));
}

function folderParts(folder: string) {
  if (folder === "repository root") return { parents: "", current: folder };
  const parts = folder.split("/");
  return { parents: parts.slice(0, -1).join("/"), current: parts.at(-1) };
}
