# Pocket Diff

スマホから端末内のGit差分を確認する、Tailnet内限定ビューアです。差分描画には[`@pierre/diffs`](https://diffs.com/)を使用しています。

macOS、Linux、Windows向けの単一Goバイナリとして動作します。利用端末にNode.jsやnpmは不要です。起動時に許可したフォルダからGitリポジトリを検出し、スマホ画面で切り替えられます。ブラウザから任意の端末内パスを指定することはできず、絶対パスもAPIに含めません。

## 必要なもの

- Git
- Tailscale（ログイン済み）
- privateリポジトリとReleaseを読めるGitHub CLI（インストール時のみ）

## ワンコマンドセットアップ

privateリポジトリから最新版を取得し、そのまま対話セットアップを開始します。

```bash
gh api -H "Accept: application/vnd.github.raw+json" \
  repos/hidenariTakeuchi/diff/contents/install.sh | sh
```

対話形式で次の項目を設定します。

- Gitリポジトリを置いている親フォルダ（複数指定可）
- リポジトリを探索する深さ
- Tailnet内のURLパス（既定は`/diff`）
- localhostポート（既定は`4173`）
- OSログイン時の自動起動
- Tailscale Serve

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

Node.jsはフロントエンドの開発・リリースビルドだけに使用します。

```bash
npm install
npm run build
go test ./...
go build -tags release -o build/pocket-diff ./cmd/pocket-diff
```

フロントエンドを開発する場合は、ターミナルを2つ使用します。

```bash
go run ./cmd/pocket-diff serve --root /path/to/projects
npm run dev
```

Viteは`http://127.0.0.1:5173`で起動し、APIをGoサーバーの`127.0.0.1:4173`へ転送します。

## リリース

`v*`形式のタグをpushするとGitHub ActionsがUIをビルドし、次のネイティブバイナリをGitHub Releaseへ登録します。

- macOS: Apple Silicon / Intel
- Linux: arm64 / amd64
- Windows: amd64

リリースバイナリにはReact UIが埋め込まれているため、利用端末のNode.jsには依存しません。Git差分は端末のGitコマンドを使用し、未追跡ファイルも表示します。ただし、1 MiBを超える未追跡ファイルとバイナリ内容は読み込みません。
