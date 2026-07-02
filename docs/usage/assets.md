# アセットの準備（.sspj → .ssab）

プレイヤーが再生するのは SpriteStudio の `.sspj` ではなく、パース不要の
ランタイムバイナリ **`.ssab`** です。変換ツールは `.sspj` と参照ファイル
（`.ssae` / `.ssee` / `.ssqe` / `.ssce`）を解析し、`.ssab`（アニメーション）と
必要に応じて `.ssqb`（シーケンスパック）を生成します。

変換には 3 つの経路があります。用途で選んでください。

| ツール | 向いている用途 | 導入 |
|---|---|---|
| [`ssconverter-web`](#ssconverter-web-ブラウザツール) | 手元で数個を手軽に変換 | インストール不要（ブラウザ） |
| [`SSConverterGUI`](#ssconvertergui-デスクトップguiツール) | GUI で手軽に変換したい | [Releases](https://github.com/cri-middleware/SSConverterGUI/releases) からバイナリ取得 |
| [`ssconverter-cli`](#ssconverter-cli-cli-ci-開発者向け) | CI / バッチ / 再現性 | [SDK Releases](https://github.com/cri-middleware/SpriteStudio-SDK/releases) からバイナリ取得 |

全体の流れは [トップページの概要図](/#概要-sspj-描画まで) を参照してください。

## ssconverter-web（ブラウザツール）

ブラウザ上で `.sspj` プロジェクトを変換し、結果を **ZIP** でダウンロードする
ツールです。インストール不要で、WASM 版コンバータをそのままブラウザで実行します。

::: warning 対応ブラウザ
フォルダ選択に **File System Access API**（`showDirectoryPicker` / ディレクトリの
ドラッグ＆ドロップ）を使うため、**Chromium 系ブラウザ（Chrome / Edge など）** が
必要です。Firefox / Safari では動作しません。
:::

### 手順

1. 開発サーバーを起動します。

   ```bash
   pnpm --filter ssconverter-web dev
   ```

2. **プロジェクトフォルダ**をドロップ領域にドラッグ＆ドロップするか、`Browse...`
   で選択します。
   - フォルダ内の `.sspj` は **ちょうど 1 つ**にしてください（0 個・複数はエラー）。
   - `.DS_Store` などの隠しファイルは無視されます。
3. 必要なら **Embedded Assets** にチェックを入れます（テクスチャを `.ssab` に
   埋め込む。下記参照）。
4. **⚡ Convert & Download** を押すと、変換して ZIP が自動ダウンロードされます。

WASM の初期化状況・変換状況はステータスバッジに、詳細はログ欄に表示されます
（コンバータのバージョンと ssab スキーマ版数も確認できます）。

### 出力（ZIP の中身）

| モード | ZIP 名 | ルートフォルダ | 内容 |
|---|---|---|---|
| 通常 | `<name>_<timestamp>.zip` | `<name>/` | `.ssab`（＋ `.ssqb`）＋ 参照テクスチャ |
| Embedded | `<name>_emb_<timestamp>.zip` | `<name>_emb/` | テクスチャを `.ssab` に埋め込み（別ファイルなし） |

ダウンロードした ZIP を展開し、`.ssab`（と通常モードのテクスチャ）を配信場所に
置きます（[配置とテクスチャ解決](#配置とテクスチャ解決)）。

## SSConverterGUI（デスクトップGUIツール）

デスクトップ上で動作する、`.sspj` を `.ssab` に変換するための GUI ツールです。
**[SSConverterGUI Releases](https://github.com/cri-middleware/SSConverterGUI/releases)** から OS 向けのバイナリをダウンロードして使用してください。

## ssconverter-cli（CLI・CI / 開発者向け）

SpriteStudio-SDK が配布する**ビルド時 CLI**です（`libssconverter` のラッパーで、
SDK のリリース成果物と同じ変換パイプライン）。CI やバッチ変換、再現性が必要な
場面に向きます。

### 入手

- **プリビルドバイナリ（推奨）**: Windows / macOS / Linux 版を
  **[SpriteStudio-SDK の Releases](https://github.com/cri-middleware/SpriteStudio-SDK/releases)**
  からダウンロード。ビルド環境は不要です。
- **ソースからビルド**: Rust ツールチェーンがあれば SDK リポジトリのルートで
  `cargo install --path cli`。

### Single モード（単一プロジェクト）

出力先を `-o` で指定できます。

```bash
# 変換（出力先を指定）
ssconverter-cli project.sspj -o ./public/assets

# 参照アセット（画像など）を .ssab に埋め込む
ssconverter-cli project.sspj --embedded
```

| オプション | 説明 |
|---|---|
| `-o`, `--out-dir <dir>` | 出力ディレクトリ（Single モードのみ） |
| `-e`, `--embedded` | 参照アセットを `.ssab` に埋め込む |
| `-h`, `--help` | ヘルプ表示 |

### Batch モード（複数・ディレクトリ一括）

複数のファイルパスや、`.sspj` を含むディレクトリ（再帰）を渡します。
**このモードでは `--out-dir` は無効**で、各出力はソースの隣に `<name>/` として
書き出されます。

```bash
# 複数ファイルを指定
ssconverter-cli project1.sspj project2.sspj

# ディレクトリ内の .sspj をすべて変換（再帰）
ssconverter-cli ./assets/projects ./extra_assets
```

### 出力

| モード | 出力ディレクトリ | 内容 |
|---|---|---|
| 通常 | `<name>/` | `.ssab`（アニメーションごと）＋ `.ssqb`（`.ssqe` 参照時）＋ 参照テクスチャのコピー |
| `--embedded` | `<name>_emb/` | 上記と同じだが、参照アセットを各 `.ssab` に埋め込み（テクスチャの別コピーなし） |

詳細は SDK の
[ssconverter-cli README](https://github.com/cri-middleware/SpriteStudio-SDK/blob/main/cli/README.md)
を参照してください。

## 配置とテクスチャ解決

- 生成した `.ssab` と一緒に出力されたテクスチャ画像は、アプリケーションの静的アセットとして Web サーバーから配信できる場所に配置します。
- テクスチャ画像はデフォルトで `.ssab` と同じ階層にあるものとして読み込まれます。画像の配置場所が異なる場合は、各プレイヤーの読み込みメソッド（例: `player.load(ssabUrl, assetBaseUrl)`）でテクスチャの基準 URL を指定してください。
- **Embedded（埋め込み）**で変換した `.ssab` は、ファイル内にテクスチャを内包するため画像ファイルの別配置は不要です。アセットが単一ファイルで完結するため管理に便利です。

読み込み・再生の手順は [クイックスタート](/setup/quickstart) を参照してください。
