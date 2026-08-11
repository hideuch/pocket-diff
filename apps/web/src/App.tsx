import { useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { DiffContent } from "./components/DiffContent";
import { RepositoryPicker } from "./components/RepositoryPicker";
import { EmptyState, ErrorState } from "./components/StatusStates";
import { usePocketDiff } from "./hooks/usePocketDiff";

export function App() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pocketDiff = usePocketDiff();

  const selectRepository = (id: string) => {
    pocketDiff.selectRepository(id);
    setPickerOpen(false);
  };

  return (
    <div className="app-shell">
      <AppHeader
        activeRepository={pocketDiff.activeRepository}
        activeRepoId={pocketDiff.activeRepoId}
        hasRepositories={Boolean(pocketDiff.repositories?.length)}
        isLoadingRepositories={pocketDiff.repositories === null}
        refreshing={pocketDiff.refreshing}
        onOpenRepositoryPicker={() => setPickerOpen(true)}
        onRefresh={() => pocketDiff.loadDiff()}
      />

      {pocketDiff.repositories?.length === 0 && !pocketDiff.error ? <EmptyState noRepositories /> : null}
      {pocketDiff.error && !pocketDiff.data ? (
        <ErrorState message={pocketDiff.error} onRetry={pocketDiff.retry} />
      ) : null}
      {pocketDiff.files.length === 0 && pocketDiff.data ? <EmptyState /> : null}

      {pocketDiff.files.length > 0 && pocketDiff.data && pocketDiff.current ? (
        <DiffContent
          activeRepoId={pocketDiff.activeRepoId}
          data={pocketDiff.data}
          files={pocketDiff.files}
          current={pocketDiff.current}
          selected={pocketDiff.selected}
          onSelect={pocketDiff.setSelected}
          onPrevious={pocketDiff.selectPrevious}
          onNext={pocketDiff.selectNext}
        />
      ) : null}

      {pickerOpen ? (
        <RepositoryPicker
          repositories={pocketDiff.repositories || []}
          activeId={pocketDiff.activeRepoId}
          onClose={() => setPickerOpen(false)}
          onSelect={selectRepository}
          onRefresh={pocketDiff.refreshRepositories}
        />
      ) : null}
      {pocketDiff.error && pocketDiff.data ? (
        <div className="toast" role="status">
          更新できませんでした。前回の差分を表示中です。
        </div>
      ) : null}
    </div>
  );
}
