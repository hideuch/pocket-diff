import { useEffect, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { DiffContent } from "./components/DiffContent";
import { RepositoryPicker } from "./components/RepositoryPicker";
import { EmptyState, ErrorState } from "./components/StatusStates";
import { ThemePicker } from "./components/ThemePicker";
import { usePocketDiff } from "./hooks/usePocketDiff";
import { getAppTheme, isAppTheme, type AppTheme } from "./themes";

const THEME_STORAGE_KEY = "pocket-diff:theme";

export function App() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [theme, setTheme] = useState<AppTheme>(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isAppTheme(stored) ? stored : "light";
  });
  const pocketDiff = usePocketDiff();
  const themeDefinition = getAppTheme(theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = themeDefinition.themeType;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, themeDefinition.themeType]);

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
        onOpenThemePicker={() => setThemePickerOpen(true)}
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
          selected={pocketDiff.selected}
          theme={themeDefinition}
          onSelect={pocketDiff.setSelected}
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
      {themePickerOpen ? (
        <ThemePicker activeTheme={theme} onClose={() => setThemePickerOpen(false)} onSelect={setTheme} />
      ) : null}
      {pocketDiff.error && pocketDiff.data ? (
        <div className="toast" role="status">
          更新できませんでした。前回の差分を表示中です。
        </div>
      ) : null}
    </div>
  );
}
