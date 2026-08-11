import type { Repository } from "../types";
import { Icon } from "./Icon";

type AppHeaderProps = {
  activeRepository?: Repository;
  activeRepoId: string;
  hasRepositories: boolean;
  isLoadingRepositories: boolean;
  refreshing: boolean;
  onOpenRepositoryPicker: () => void;
  onRefresh: () => void;
};

export function AppHeader({
  activeRepository,
  activeRepoId,
  hasRepositories,
  isLoadingRepositories,
  refreshing,
  onOpenRepositoryPicker,
  onRefresh,
}: AppHeaderProps) {
  return (
    <header className="topbar">
      <div className="brand-mark" aria-label="Pocket Diff">
        <span>P</span>
        <span>D</span>
      </div>
      <button
        className="repo-title repo-switcher"
        onClick={onOpenRepositoryPicker}
        type="button"
        disabled={!hasRepositories}
      >
        <strong>
          {activeRepository?.name || "Pocket Diff"}
          <Icon name="down" size={13} />
        </strong>
        <span>
          <Icon name="branch" size={13} />
          {activeRepository?.branch || (isLoadingRepositories ? "検索中" : "未選択")}
        </span>
      </button>
      <button
        className={`refresh-button ${refreshing ? "is-spinning" : ""}`}
        onClick={onRefresh}
        type="button"
        aria-label="差分を更新"
        disabled={!activeRepoId}
      >
        <Icon name="refresh" />
      </button>
    </header>
  );
}
