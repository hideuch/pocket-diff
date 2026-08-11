import type { FileDiffMetadata } from "@pierre/diffs";

type FileRailProps = {
  files: FileDiffMetadata[];
  selected: number;
  onSelect: (index: number) => void;
};

export function FileRail({ files, selected, onSelect }: FileRailProps) {
  return (
    <nav className="file-rail" aria-label="変更ファイル">
      {files.map((file, index) => (
        <button
          className={`file-pill ${index === selected ? "is-selected" : ""}`}
          key={`${file.name}-${index}`}
          onClick={() => onSelect(index)}
          type="button"
        >
          <span className={`change-dot change-${file.type}`} />
          <span className="file-pill-name">{file.name.split("/").at(-1)}</span>
          <span className="file-pill-count">
            {index + 1}/{files.length}
          </span>
        </button>
      ))}
    </nav>
  );
}
