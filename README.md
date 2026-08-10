# Pocket Diff

スマホから端末内の Git 差分を確認する、Tailnet 内限定ビューアです。差分描画には [`@pierre/diffs`](https://diffs.com/) を使用しています。

macOS、Linux、Windowsで動作するNode.jsアプリです。起動時に許可したフォルダからGitリポジトリを検出し、スマホ画面で切り替えられます。ブラウザから任意の端末内パスを指定することはできず、絶対パスもAPIに含めません。

## セットアップ

各端末にNode.js 20以降、Git、Tailscaleをインストールします。

```bash
git clone https://github.com/hidenariTakeuchi/diff.git
cd pocket-diff
npm install
npm run build
```

Gitリポジトリを保存している親フォルダを指定して起動します。`--root` は複数指定できます。

```bash
npm start -- --root /path/to/projects --root /path/to/work
```

Windows PowerShellでも同じ形式です。

```powershell
npm start -- --root C:\Users\you\source --root D:\work
```

探索の深さは既定で4階層、最大8階層です。大きな親フォルダでは小さくしてください。

```bash
npm start -- --root /path/to/projects --depth 2
```

環境変数を使う場合は、OS標準のパス区切り文字で複数指定できます。

```bash
DIFF_ROOTS=/path/to/projects:/path/to/work npm start
```

従来の単一リポジトリ用 `DIFF_REPO` も利用できます。引数も環境変数もない場合は、起動したカレントフォルダだけを探索します。

## Tailnet内へ公開

別のターミナルでlocalhostのサーバーをTailnet内だけに公開します。

```bash
tailscale serve --bg http://127.0.0.1:4173
tailscale serve status
```

表示された `https://<device-name>.<tailnet-name>.ts.net` をスマホで開きます。スマホも同じTailnetに参加している必要があります。

標準のHTTPS URLを別サービスが使用中なら、専用ポートを指定できます。

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:4173
```

停止する場合：

```bash
tailscale serve --https=8443 off
```

## 開発

```bash
npm run dev -- --root /path/to/projects
```

既定では `127.0.0.1:4173` だけで待ち受けます。Tailnet限定運用では `HOST=0.0.0.0` を指定しないでください。未追跡ファイルも表示しますが、1 MiBを超える未追跡ファイルとバイナリ内容は読み込みません。`node_modules`、`dist`、`.git` などはリポジトリ探索から除外します。シンボリックリンクも探索しません。

## 確認

```bash
npm test
npm run build
```
