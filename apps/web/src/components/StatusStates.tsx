type EmptyStateProps = {
  noRepositories?: boolean;
};

export function EmptyState({ noRepositories = false }: EmptyStateProps) {
  return (
    <main className="empty-state">
      <div className="empty-glyph" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="eyebrow">{noRepositories ? "NO REPOSITORIES FOUND" : "WORKING TREE IS CLEAN"}</p>
      <h1>{noRepositories ? "Gitフォルダが見つかりません" : "差分はまだありません"}</h1>
      <p>
        {noRepositories
          ? "起動時に --root でGitリポジトリを含むフォルダを指定してください。"
          : "Claude がファイルを編集すると、ここに自動で表示されます。この画面は開いたままで大丈夫です。"}
      </p>
    </main>
  );
}

type ErrorStateProps = {
  message: string;
  onRetry: () => void;
};

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <main className="empty-state error-state">
      <p className="eyebrow">REPOSITORY UNAVAILABLE</p>
      <h1>差分を読めませんでした</h1>
      <p>{message}</p>
      <button className="retry-button" onClick={onRetry} type="button">
        もう一度読む
      </button>
    </main>
  );
}
