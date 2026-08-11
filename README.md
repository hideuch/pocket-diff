# Pocket Diff

スマホから端末内のGit差分を確認する、Tailnet内限定ビューアです。差分描画には[`@pierre/diffs`](https://diffs.com/)を使用しています。

macOS、Linux、Windows向けの単一Goバイナリとして動作します。利用端末にNode.jsやnpmは不要です。起動時に許可したフォルダからGitリポジトリを検出し、スマホ画面で切り替えられます。ブラウザから任意の端末内パスを指定することはできず、絶対パスもAPIに含めません。

## 必要なもの

- Git
- Tailscale（ログイン済み）
- curl（インストール時のみ）

## ワンコマンドセットアップ

GitHub Releaseから最新版を取得し、そのまま対話セットアップを開始します。

```bash
curl -fsSL https://raw.githubusercontent.com/hidenariTakeuchi/diff/main/install.sh | sh
```

対話形式で次の項目を設定します。

- Gitリポジトリを置いている親フォルダ（複数指定可）
- リポジトリを探索する深さ
- Tailnet内のURLパス（既定は`/diff`）
- localhostポート（既定は`4173`）
- OSログイン時の自動起動
- Tailscale Serve
- 署名を検証する自動アップデート（既定で有効）

セットアップ後は、同じTailnetに参加しているスマホから表示された`https://<device>.<tailnet>.ts.net/diff/`を開きます。macOSではLaunchAgent、Linuxではsystemd user service、Windowsではタスクスケジューラへ登録します。

すでにバイナリを取得している場合は次を実行します。

```bash
pocket-diff setup
```

引数だけのセットアップも利用できます。

```bash
pocket-diff setup \
  --yes \
  --root ~/repos \
  --root ~/work \
  --depth 2 \
  --base-path /diff \
  --port 4173
```

環境を確認するには次を実行します。

```bash
pocket-diff doctor
```

## 自動アップデートと署名検証

リリース版は起動時と6時間ごとに更新を確認します。更新が見つかった場合は、ダウンロードしたOS・CPU向けアーカイブについて次をすべて検証してから実行ファイルを差し替えます。

- SHA-256ダイジェスト
- Sigstore署名と証明書チェーン
- Rekor透明性ログと署名時刻
- 署名元が`hidenariTakeuchi/diff`の保護されたRelease workflowであること
- 署名対象が該当する`v*`タグと公開リポジトリであること
- 現在より新しいSemantic Versionであり、ダウングレードではないこと

検証に失敗した場合は更新を中止し、現在のバイナリをそのまま使用します。長期秘密鍵はリポジトリやGitHub Secretsへ保存せず、GitHub Actions OIDCによるkeyless署名を使用します。

手動で確認・更新する場合：

```bash
pocket-diff update --check
pocket-diff update
```

自動更新を無効化する場合はセットアップ時に`--no-auto-update`を指定するか、サービスの環境変数へ`POCKET_DIFF_AUTO_UPDATE=0`を設定します。

## 手動起動

サービス登録を使わず、その場で起動できます。`--root`は複数指定できます。

```bash
pocket-diff serve \
  --root /path/to/projects \
  --root /path/to/work \
  --depth 2 \
  --base-path /diff
```

既定では`127.0.0.1:4173`だけで待ち受けます。Tailnet限定運用では`--host 0.0.0.0`を指定しないでください。

Tailnetへ手動で公開する場合：

```bash
tailscale serve --bg --set-path=/diff http://127.0.0.1:4173
```

## 開発

このリポジトリはpnpm workspaceとTurborepoで構成したmonorepoです。React UIはTypeScript（TSX）、サーバーと配布バイナリはGoで実装しています。

```text
apps/
├── web/          React + TypeScript + Vite
└── pocket-diff/  Goサーバー・ネイティブバイナリ
```

開発ツールのバージョンはmiseで固定しています。最初に次を実行してください。

```bash
mise install
mise run setup
```

主要なコマンドはリポジトリのルートから実行できます。

```bash
pnpm dev        # Web UIとGoサーバーを起動
pnpm typecheck  # TypeScriptを検査
pnpm test       # workspace全体をテスト
pnpm build      # UI埋め込み済みGoバイナリをビルド
pnpm check      # 上記の検査・テスト・ビルドを一括実行
```

開発サーバーへ対象フォルダを渡す場合は環境変数を使用します。

```bash
DIFF_ROOTS=/path/to/projects pnpm dev
```

Viteは`http://127.0.0.1:5173`で起動し、APIをGoサーバーの`127.0.0.1:4173`へ転送します。ビルドしたバイナリは`apps/pocket-diff/dist/pocket-diff`に生成されます。

Node.js、pnpm、miseが必要なのは開発時だけです。配布する単一GoバイナリにはReact UIが埋め込まれるため、利用端末にはいずれも必要ありません。

## リリース

`v*`形式のタグをpushするとGitHub ActionsがUIをビルドし、次のネイティブバイナリをGitHub Releaseへ登録します。

- macOS: Apple Silicon / Intel
- Linux: arm64 / amd64
- Windows: amd64

リリースバイナリにはReact UIが埋め込まれているため、利用端末のNode.jsには依存しません。Git差分は端末のGitコマンドを使用し、未追跡ファイルも表示します。ただし、1 MiBを超える未追跡ファイルとバイナリ内容は読み込みません。
