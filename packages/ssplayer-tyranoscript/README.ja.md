[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyranoscript

**TyranoScript** のシナリオに `[ss_*]` タグを書くだけで、**SpriteStudio** のアニメを表示・再生できます。プログラミングは不要です。

> **対象読者:** TyranoScript を使うシナリオ作者。
> **ティラノビルダー**をお使いの場合は [`@spritestudio/ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/README.ja.md) を導入してください。本パッケージのランタイムを内包した上で、コンポーネントパレットからの配置と `.sspj` の自動変換に対応します。

▶️ **[オンラインデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** —
同梱の TyranoScript サンプルをブラウザで動かせます。

## クイックスタート

**シナリオを書く場合**はこのまま下へ。入れる → 変換する → 表示する、の順です。その先（全タグ、クロスフェードとトラック、シグナル、セーブ / ロード、音声）も同じ道の続きで、[TyranoScript ガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/tyrano)にあります。**プラグイン自体を変更する場合**は下の[コントリビューター向け](#コントリビューター向け--ソースからビルド)、その後 [CONTRIBUTING.md](../../CONTRIBUTING.md) へ。

TyranoScript のプロジェクトと、**SpriteStudio 7.6 以上**で作成したプロジェクトを用意してください。

1. **導入**: [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-tyranoscript&expanded=true) から `ssplayer-tyranoscript-plugin-<version>.zip` をダウンロードします。`@spritestudio/ssplayer-tyranoscript <version>` という名前の Release を開き、**Assets** にあるファイルを取ってください（*Source code* のアーカイブではありません）。解凍し、中の `ssplayer/` フォルダを名前を変えずにプロジェクトの `data/others/plugin/` へコピーします。`[plugin name="ssplayer"]` はそこを探します。
2. **変換**: ブラウザで [ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/) を開き、`.sspj` の入ったフォルダをドロップ（または **Browse...** で選択）して **⚡ Convert & Download** を押し、ダウンロードされた ZIP を `data/others/ssdata/` に展開すると、プロジェクト名のフォルダの中に `.ssab` とテクスチャが入っています。デスクトップでは [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases) で同じことができます。

   ```
   mygame/
   ├── index.html
   └── data/
       ├── scenario/
       │   ├── first.ks
       │   └── …
       └── others/
           ├── plugin/ssplayer/
           │   ├── init.ks
           │   ├── main.js
           │   ├── ssruntime_bg.wasm
           │   └── readme.txt
           └── ssdata/
               └── Ringo/       ← ZIP を展開したもの
                   ├── Ringo.ssab
                   └── Ringo.png
   ```

3. **表示**: ゲームの冒頭でプラグインを 1 回だけ読み込み、キャラを出したい場面でプレイヤーを作ります。

   ```
   ; first.ks
   [plugin name="ssplayer"]

   ; scene1.ks
   [ss_new name="chr" storage="others/ssdata/Ringo/Ringo.ssab" layer="0" x="640" y="480" loop="true"]
   [ss_play name="chr"]
   ```

   `storage` は `data/` から数えたパスです。`x` / `y` は Tyrano の左上原点のピクセルで、アニメのアンカーがその位置に来ます。`anime="…"` でアニメを名前で選べます。省略すると先頭のアニメです。

この手順と並べて読める完成したシナリオが、同梱サンプルの [`first.ks`](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/examples/tyranoscript-example/data/scenario/first.ks) です。登場、`[anim]` によるフェード、複数レイヤー、セーブ / ロードをコメント付きで書いてあり、上のオンラインデモはこれを動かしています。

SpriteStudio のデータが手元に無くても始められます。[公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) が手頃です。

**次に読む:** [TyranoScript ガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/tyrano) ·
[提供タグ](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/tyrano#_4-tags) ·
[うまくいかないとき](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/tyrano#troubleshooting) ·
[制約と適用範囲](https://cri-middleware.github.io/SSPlayerForWeb/ja/limitations#tyranoscript-tyranobuilder)

---

## コントリビューター向け — ソースからビルド

*プラグインの利用者はここまで。以下はプラグインを開発する人向けです。*

本パッケージは TyranoScript 向けの薄いアダプタです。描画は
[`@spritestudio/ssplayer-webgl`](../ssplayer-webgl/README.ja.md) の `SSPlayer`
（WebGL1 必須 + WebGL2 自動昇格 / 依存ゼロ）が担います。このパッケージは **GPU 処理を持たず**、レイヤーへのキャラクター用 `<div>` の追加（描画はレイヤー共有の canvas）・座標マッピング・再生制御といった
**TyranoScript 固有のグルー**に徹します。残タスクは [`ROADMAP.md`](./ROADMAP.md) にあります。

### しくみ

- **ランタイムは Tyrano 系ホストで共通**。TyranoBuilder も TyranoStudio も
  TyranoScript を内包しているので、単一の `main.js`（`master_tag` へ `[ss_*]` を自己登録する IIFE バンドル）が全てで動きます。ビルダーの**エディタ側**は別パッケージ
  [`ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/README.ja.md) です。
- ビルド成果物は 2 種類:
  - `dist/index.js`（ESM）— バンドラ／テスト用。副作用なし（`registerSSTags()` を公開します）。
  - `dist/browser/main.js`（IIFE, 自己登録, minify）— `data/others/plugin/ssplayer/main.js`
    に置く**ドロップイン**。WebGL レンダラ＋ core の JS を内包し、**WASM バイナリだけ外部**（`ssruntime_bg.wasm` を同梱し、プラグインの `init.ks` が `[ss_init wasm=...]` で指します）。

### 内部仕様（座標・ライフサイクル）

- **座標**: Tyrano の左上原点・論理ピクセル（`config.scWidth × scHeight`）を、
  `SSPlayer`（Y-down）の描画バッファ座標へマップします。HiDPI は `devicePixelRatio`
  をバッファ倍率に反映し、`maxDPR` で上限を設けます。
- **`[anim]` 用の命名**: 生成時にキャラクターの `<div>` へプレイヤー名を CSS クラスとして付与します（`$.setName`＝`addClass(name)`。TyranoScript のキャラ識別と同じ仕組み）。`ss-player`
  クラスも付くので `$(".ss-player")` で一括選択できます。絶対座標指定はレンダラ内部の
  `setTransform` を経由するため、`[anim]` とは別に `[ss_pos]` / `[ss_move]` が存在します。
- **セーブ対象**: 各プレイヤーの復元情報を `TYRANO.kag.stat.f.__ssplayers` へミラーします。ロード時はエンジンの `load-beforemaking` イベント（セーブ変数が戻り、シナリオが再開する直前＝`make.ks` と同じ隙間）でプラグインが自動的に再構築します。`[ss_restore]` は同じ処理を明示的に行うタグで、自動復元が実行中ならそれを待ち合わせて二重実行を避けます。
- **解放**: `[ss_free]` / `[ss_free_all]` が `destroy()` を呼びます。`FinalizationRegistry`
  任せにしないでください。
- **音声**: SS の `onAudio` イベントは `TyranoAudioManager` 経由で howler（`window.Howl`）へ流します。`[playse]` ではなく howler を直接使うのは、KAG タグだと `nextOrder` でシナリオが進んでしまうためです。プレイヤーの破棄はそのマネージャーの音をすべて止めるので、マネージャーはプレイヤーごとに 1 つ持ちます。`TyranoAudioManager` はプログラムから直接利用も可能です。

### 配布（GitHub Releases）

npm には**公開しません**（`private`）。TyranoScript 作者はプラグイン一式を使います:

```bash
pnpm --filter @spritestudio/ssplayer-tyranoscript run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyranoscript run pack    # dist/pack/ssplayer-tyranoscript-plugin-<ver>.zip
```

`pack` は `ssplayer/{init.ks, main.js, ssruntime_bg.wasm, readme.txt}` を zip 化します。パッケージの
**GitHub Release** に添付されるのはこのアーカイブで、利用者は `ssplayer/` を `data/others/plugin/` に展開します。配布テンプレは [`plugin/`](./plugin/README.md) にあります。

### API（ESM）

```ts
import { registerSSTags } from '@spritestudio/ssplayer-tyranoscript';

// TyranoScript ランタイム起動後に呼ぶと [ss_*] を登録する。
// 省略時はグローバル TYRANO を使用。Tyrano 不在なら false を返す no-op。
registerSSTags();
```

### 開発

```bash
pnpm --filter @spritestudio/ssplayer-tyranoscript run build   # dist/index.js + dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyranoscript run test    # vitest (モック TYRANO ハーネス, 実エンジン不要)
pnpm --filter tyranoscript-example run sync:plugin             # ビルド済みプラグイン + wasm をサンプルへコピー
```

TyranoScript 本体は同梱していません。サンプルがコミットしているのは、作成したシナリオ（`first.ks` と `make.ks`）と補助スクリプトだけです。プラグインは `sync:plugin`、`.ssab` ファイルは `deploy-examples` が配置し、TyranoScript 本体は開発時に各自で配置します（`fetch:engine` で取得できます）。サンプルを本物のエンジンでスクリプトから動かす方法は、ドキュメントサイトの[ビルドガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/development/build)にあります。

## ライセンス

BSD-3-Clause — [LICENSE.md](./LICENSE.md) を参照してください。
