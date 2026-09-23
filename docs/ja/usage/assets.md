# アセットの準備（.sspj → .ssab）

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

プレイヤーが再生するのは SpriteStudio の `.sspj` ではなく、パース不要のランタイムバイナリ **`.ssab`** です。変換ツールは `.sspj` と参照ファイル（`.ssae` / `.ssee` / `.ssqe` / `.ssce`）を解析し、`.ssab`（アニメーション）と必要に応じて `.ssqb`（シーケンスパック）を生成します。

変換には 3 つのツール経路があります。用途で選んでください。加えて、変換そのものを自作アプリに組み込みたい場合は、ライブラリ **`@spritestudio/ssconverter-core`** を使います。

::: tip 手元に `.sspj` がまだ無いときは
[SpriteStudio 公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら
[Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)、エフェクトを含むものなら
[パーティクル](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample)
が手頃です。ダウンロードしたプロジェクトは、下のどのツールにもそのまま渡せます。
:::

| ツール | 向いている用途 | 導入 |
|---|---|---|
| [`ssconverter-web`](#ssconverter-web-ブラウザツール) | 手元で数個を手軽に変換 | ブラウザで開く（<a href="../../ssconverter/" target="_blank" rel="noreferrer">/ssconverter/</a> 🚧 初回リリースの公開後に有効） |
| [`SSConverterGUI`](#ssconvertergui-デスクトップguiツール) | GUI で手軽に変換したい | [Releases](https://github.com/cri-middleware/SSConverterGUI/releases) からバイナリ取得 |
| [`ssconverter-cli`](#ssconverter-cli-cli-ci-開発者向け) | CI / バッチ / 再現性 | [SDK Releases](https://github.com/cri-middleware/SpriteStudio-SDK/releases) からバイナリ取得 |
| [`@spritestudio/ssconverter-core@beta`](#ssconverter-core-ライブラリ-自作アプリへの組み込み) | 変換を自作アプリ/サービスに組み込む | `npm i @spritestudio/ssconverter-core@beta` |

全体の流れは [トップページの概要図](/ja/#概要-sspj-描画まで) を参照してください。

## ssconverter-web（ブラウザツール）

ブラウザ上で `.sspj` プロジェクトを変換し、結果を **ZIP** でダウンロードするツールです。WASM 版コンバータをそのままブラウザで実行します。

このドキュメントと同じ場所（<a href="../../ssconverter/" target="_blank" rel="noreferrer">/ssconverter/</a>）でホストしているため、インストールは不要です（🚧 初回リリースの公開後に有効になります）。同梱の Node CLI は開発者向けのツールです。

::: warning 対応ブラウザ
フォルダ選択に **File System Access API**（`showDirectoryPicker` / ディレクトリのドラッグ＆ドロップ）を使うため、**Chromium 系ブラウザ（Chrome / Edge など）** が必要です。Firefox / Safari では動作しません。
:::

### 手順

1. <a href="../../ssconverter/" target="_blank" rel="noreferrer">コンバータ</a>を開きます。リポジトリを clone している場合は、以下でも同じツールを起動できます。

   ```bash
   pnpm --filter @spritestudio/ssconverter-web dev
   ```

2. **プロジェクトフォルダ**をドロップ領域にドラッグ＆ドロップするか、`Browse...`
   で選択します。
   - フォルダ内の `.sspj` は **ちょうど 1 つ**にしてください（0 個・複数はエラー）。
   - `.DS_Store` などの隠しファイルは無視されます。
3. 必要なら **Embedded Assets** にチェックを入れます（テクスチャを `.ssab` に埋め込む。下記参照）。
4. **⚡ Convert & Download** を押すと、変換して ZIP が自動ダウンロードされます。

WASM の初期化状況・変換状況はステータスバッジに、詳細はログ欄に表示されます（コンバータのバージョンと ssab スキーマ版数も確認できます）。

### 出力（ZIP の中身）

| モード | ZIP 名 | ルートフォルダ | 内容 |
|---|---|---|---|
| 通常 | `<name>_<timestamp>.zip` | `<name>/` | `.ssab`（＋ `.ssqb`）＋ 参照テクスチャ |
| Embedded | `<name>_emb_<timestamp>.zip` | `<name>_emb/` | テクスチャを `.ssab` に埋め込み（別ファイルなし） |

ダウンロードした ZIP を展開し、`.ssab`（と通常モードのテクスチャ）を配信場所に置きます（[配置とテクスチャ解決](#配置とテクスチャ解決)）。

## SSConverterGUI（デスクトップGUIツール）

デスクトップ上で動作する、`.sspj` を `.ssab` に変換するための GUI ツールです。
**[SSConverterGUI Releases](https://github.com/cri-middleware/SSConverterGUI/releases)** から OS 向けのバイナリをダウンロードして使用してください。

## ssconverter-cli（CLI・CI / 開発者向け）

SpriteStudio-SDK が配布する**ネイティブのビルド時 CLI**です（`libssconverter` のラッパーで、SDK のリリース成果物と同じ変換パイプライン）。CI やバッチ変換、再現性が必要な場面に向きます。

### 入手

- **プリビルドバイナリ**: Windows / macOS / Linux 版を
  **[SpriteStudio-SDK の Releases](https://github.com/cri-middleware/SpriteStudio-SDK/releases)**
  からダウンロードします。ビルド環境は不要です。
- **ソースからビルド**: Rust ツールチェーンがあれば SDK リポジトリのルートで
  `cargo install --path cli` を実行します。

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

複数のファイルパスや、`.sspj` を含むディレクトリ（再帰）を渡します。**このモードでは `--out-dir` は無効**で、各出力はソースの隣に `<name>/` として書き出されます。

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

## ssconverter-core（ライブラリ / 自作アプリへの組み込み）

上記のツール類ではなく、**変換そのものを自分の JavaScript/TypeScript アプリやサービスに組み込みたい**場合は、変換エンジンを npm ライブラリとして提供する
**[`@spritestudio/ssconverter-core`](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/packages/ssconverter-core)**
を使います。Rust `libssconverter` の WebAssembly ビルドに、エルゴノミックな
TypeScript API を被せたもので、これ単体は npm で公開しています。

**バイト入力・バイト出力**で、ファイルシステムにも DOM にも依存しません。そのため同じコアがブラウザ・Node・Web Worker・エッジランタイムのいずれでも動作します（`ssconverter-web` のブラウザ UI と Node CLI もこのコアの上に載っています）。

📂 **<a href="../../examples/sspj-preview/" target="_blank" rel="noreferrer">.sspj を落として再生する</a>**
は、このライブラリと WebGL プレイヤーを 1 ページに載せたものです。ソース（[`examples/sspj-preview`](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/examples/sspj-preview)）は以下の内容が実際に動く形になっています。ブラウザでフォルダを読み、変換し、サーバもビルドも介さずそのままプレイヤーに渡す、という一連の流れです。

```bash
npm i @spritestudio/ssconverter-core@beta
```

```ts
import {
  init,
  convertProject,
  locateProject,
  version,
  ssabSchemaVersion,
} from '@spritestudio/ssconverter-core';

// ブラウザ: 同梱 wasm を URL で読み込む
import wasmUrl from '@spritestudio/ssconverter-core/wasm/ssconverter_bg.wasm?url';
await init(wasmUrl);

// Node: wasm のバイト列を自分で読んで渡す
// import { readFile } from 'node:fs/promises';
// const wasmPath = new URL(
//   import.meta.resolve('@spritestudio/ssconverter-core/wasm/ssconverter_bg.wasm'),
// );
// await init(await readFile(wasmPath));

console.log(`converter ${version()} (ssab v${ssabSchemaVersion()})`);

// files: プロジェクトディレクトリ内の全パス（.sspj を含む）→ バイト列
const { stem } = locateProject(files.keys());
const result = convertProject(files, { embedded: false });

for (const [name, bytes] of result.output) {
  /* `${stem}/${name}` として書き出す */
}
for (const [dest, src] of result.assets) {
  /* 参照テクスチャ src を dest にコピー（非 embedded 時のみ） */
}
```

I/O（ファイル読み書き・ZIP 化・ダウンロード）は呼び出し側（ホスト）の担当です。
API の一覧は
[`ssconverter-core` の README](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/packages/ssconverter-core#api)
を参照してください。

## 配置とテクスチャ解決

::: info どのファイルが、変換後のどれになるのか
`.sspj` / `.ssae` / `.ssce` / `.ssqe` それぞれの役割と変換後の対応は Player 共通なので、ポータルにまとめてあります — [アセットの変換 — プロジェクトの構成と、変換後の対応](https://cri-middleware.github.io/SpriteStudio-Docs/ja/overview/conversion/#プロジェクトの構成と変換後の対応)。

要点は 2 つです。**`.ssae` 1 本が `.ssab` 1 本**になること、そして**セルの切り出し位置は `.ssce`
から `.ssab` へ焼き込まれる**こと。後者があるため、セルを追加・移動・リサイズしたり画像サイズを変えたりしたときは、**画像だけでなく `.ssab` も配信し直して**ください。画像だけを新しくすると、古い切り出し位置のまま描画されて絵がずれます。
:::

- 生成した `.ssab` と一緒に出力されたテクスチャ画像は、アプリケーションの静的アセットとして Web サーバーから配信できる場所に配置します。
- テクスチャ画像は `.ssab` と同じ階層（ssconverter が出力する構成）から読み込まれます。画像は `.ssab` の隣、または `.ssab` が参照するサブディレクトリに配置してください。無関係な別ディレクトリを指定するオプションはありません。
- **Embedded（埋め込み）**で変換した `.ssab` は、ファイル内にテクスチャを内包するため画像ファイルの別配置は不要です。アセットが単一ファイルで完結するため管理に便利です。

### キャッシュと差し替え

`.ssab` とテクスチャは**別々の HTTP リクエスト**です。テクスチャの URL は `.ssab` の URL
ディレクトリにパック内のパスを繋いだだけで、バージョンクエリもハッシュも付きません。どちらがいつ更新されるかは、**配信側のキャッシュ設定次第**ということになります。

ここで効いてくるのが、切り出し位置が `.ssab` に焼き込まれているという性質です。アトラス配置や画像サイズを変えたときは、`.ssab` と `.png` が**同時に**新しくならなければなりません。片方だけ先に届くと、古い切り出し位置で新しい絵を描くことになり、絵がずれます。ロードもエラーも通るので、気づくのは画面を見たときです。

::: warning 片方にだけハッシュを付けない
`.png` だけをコンテンツハッシュ付きのファイル名にする、`.ssab` と `.png` で `Cache-Control` の
TTL が違う——が典型的な踏み方です。バンドラや CDN が画像だけをフィンガープリントする設定になっていないか確認してください。
:::

対処は次のいずれかです。

| やり方 | 内容 |
|---|---|
| **セットごとバージョンを切る** | `/assets/v3/<name>/` のようにフォルダ単位で URL を変えます。`.ssab` の URL が変わればテクスチャの URL も一緒に変わるため、組み合わせが崩れません |
| **同じキャッシュ方針を敷く** | `<name>/` 配下をまとめて 1 つの `Cache-Control` で配信します |
| **embedded で出力する** | テクスチャが `.ssab` に入るのでリクエストが 1 本になり、組み合わせが崩れる余地がなくなります。ただし単体で完結するアセット向けです（下記） |

::: warning embedded は差分配信には向きません
埋め込むと、**大きくてめったに変わらないアトラス**が、**小さくて頻繁に変わるキーフレーム**と同じファイルに溶接されます。アニメを 1 フレーム直しただけでもアトラスごと再ダウンロードになり、差分配信でやりたいことのちょうど逆になります。

共有も効きません。埋め込みテクスチャは意図的に共有キャッシュの外に置かれ、`SSPlayer` ごとにデコードされます（[リソースとライフサイクル](/ja/customize/resources)）。同じアトラスを使うキャラクターが 5 体いる場合、reference ならダウンロード 1 回・GPU テクスチャ 1 枚で済むところが、
embedded では 5 回・5 枚になります。

単発のバナーやアトラスを共有しない 1 体には向きますが、**アトラスを共有する複数キャラを継続的に更新する**なら reference のままセット単位でバージョンを切ってください。
:::

なお embedded が埋め込むのは**テクスチャだけ**です。Instance パーツが再生する参照先パックは
`<ベース URL>/<パック名>.ssab` として別途フェッチされるため、埋め込んでもリクエストは 1 本にはなりません。親子のパックはセットで配信してください。テクスチャの選択もパック単位ではなく**テクスチャ単位**で、埋め込みが無いものは従来どおり URL で取りに行きます——混在パックでは埋め込まれていない分にこの節の話がそのまま当てはまります。

セット単位で URL を変えるやり方は、実行時のキャッシュとも噛み合います。PixiJS の `Assets`
キャッシュも WebGL バックエンドのテクスチャキャッシュも **URL をキー**にしているため、URL が変われば古いテクスチャを掴み続けることはありません（[リソースとライフサイクル](/ja/customize/resources)）。

読み込み・再生の手順は [クイックスタート](/ja/setup/quickstart) を参照してください。
