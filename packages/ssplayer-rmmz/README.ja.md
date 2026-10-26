[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-rmmz

**SpriteStudio**（`.ssab`）アニメーションを **RPG ツクール MZ** で再生するプラグインです。キャラやピクチャと正しい前後関係（Zオーダー）で表示されます。

> **対象読者:** RPG ツクール MZ でゲームを作る人。プラグインコマンドで SpriteStudio アニメを追加します（コード不要）。
> **ステータス:** beta。

▶️ **[オンラインデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/)** —
同梱のサンプル MZ プロジェクトをブラウザで動かせます。

## クイックスタート

**ゲームを作る場合**はこのまま下へ。入れる → 変換する → 表示する、の順で、コードは書きません。その先（トラック、パーツ上書き、デプロイ、音声）も同じ道の続きで、[RPG ツクール MZ ガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/rmmz)にあります。
**プラグイン自体を変更する場合**は下の[コントリビューター向け](#コントリビューター向け--ソースからビルド)、その後 [CONTRIBUTING.md](../../CONTRIBUTING.md) へ。

RPG ツクール MZ と、**SpriteStudio 7.6 以上**で作成したプロジェクトを用意してください。

1. **導入**: [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-rmmz&expanded=true) から `ssplayer-rmmz-plugin-<version>.zip` をダウンロードします。`@spritestudio/ssplayer-rmmz <version>` という名前の Release を開き、**Assets** にあるファイルを取ってください（*Source code* のアーカイブではありません）。中の 3 ファイル（`ssplayer-rpgmakermz.js`・`ssruntime_bg.wasm`・`ssconverter_bg.wasm`）をゲームの `js/plugins/` にフラットに展開し、**ツール → プラグイン管理**で **ssplayer-rpgmakermz** を ON にします。
2. **変換**: ゲームの直下に `SpriteStudio_Source/` フォルダを作り、SpriteStudio のプロジェクトを `.sspj` だけでなくフォルダごとコピーして、テストプレイを開始します。タイトルが出る前にプロジェクトが `spritestudio/<プロジェクト名>/` へ変換されます。`.ssab` はアニメーションファイル（`.ssae`）1 つにつき 1 つです。

   ```
   MyGame/
   ├── js/plugins/
   │   ├── ssplayer-rpgmakermz.js
   │   ├── ssruntime_bg.wasm
   │   └── ssconverter_bg.wasm   ← テストプレイで変換する
   ├── SpriteStudio_Source/
   │   └── Ringo/             ← プロジェクトのフォルダをそのまま
   │       ├── Ringo.sspj
   │       ├── Ringo.png
   │       └── …
   └── spritestudio/          ← テストプレイが書き出す
       └── Ringo/
           ├── Ringo.ssab
           └── Ringo.png
   ```

3. **表示**: イベントに **プラグインコマンド** → `ssplayer-rpgmakermz` → **SS表示** を追加し、**SSABファイル** に `spritestudio/Ringo/Ringo.ssab` を指定して、テストプレイを開始します。**アニメーション名** を空にすると先頭のアニメーションを再生します。名前を間違えると、コンソール（F8）に実際の名前の一覧が出ます。

SpriteStudio で保存したら、テストプレイ中に **F5** を押すと変更が変換されます。デプロイの前に [デプロイ](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/rmmz#_4-deployment) を読んでください。ソースをゲームに含めないために *除外するファイル/フォルダ* へ入力するものが書いてあります。

SpriteStudio のデータが手元に無くても始められます。[公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) が手頃です。

**次に読む:** [RPG ツクール MZ ガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/rmmz) ·
[プラグインコマンド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/rmmz#_3-plugin-commands) ·
[制約と適用範囲](https://cri-middleware.github.io/SSPlayerForWeb/ja/limitations#rpg-maker-mz-beta)

---

## コントリビューター向け — ソースからビルド

*プラグインの利用者はここまで。以下はプラグインを開発する人向けです。*

### しくみ

ゲームを作る人から見える部分はガイドの [しくみ](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/rmmz#how-it-works) にあります。内部は次のとおりです。

- **Layer 3（レンダラ）**：`SSPlayer` は `PIXI.Container`、`SSPlayerRenderer` は登録済みの
  `PIXI.ObjectRenderer`（`'ssplayer'`）で、[`@spritestudio/ssplayer-webgl`](../ssplayer-webgl)
  の `SSWebGLRenderer` を MZ の共有 `gl` 上で駆動します。生 GL 描画の前後は、MZ の Effekseer スプライトと同一の WebGL ステート退避／復元で挟んでいます。独自のタイマーは持たず、再生はピクチャのスプライトの `update()` からだけ進みます。
- **Layer 4（プラグイン）**：ドロップイン型の IIFE です。`Scene_Boot.isReady` で WASM の初期化を待ちます。WASM は非 SIMD（スカラー）版で、MZ 同梱の NW.js が WebAssembly SIMD 非対応の Chromium だからです。Game_Picture ↔ Sprite_Picture ブリッジでアニメをピクチャにアタッチします（MZ の移動・拡大が適用され、セーブ／ロードで状態が復元されます）。テクスチャは `ImageManager`、音声は
  `AudioManager` に委譲します。

**既知の制限（技術的な内訳）。** 平易な要約はガイドの [既知の制限](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/rmmz#known-limitations) を参照してください。内部的には次のとおりです。

- 不透明度・移動・拡大は SS の描画に反映されます（`SSPlayerRenderer` が Pixi の `worldAlpha` をワールド色調として `SSWebGLRenderer` へ渡す）。ピクチャの**色調**は MZ がピクチャのスプライトに掛ける `ColorFilter` なので、次の制限に当たります。
- アニメを載せたスプライトに **PIXI フィルタが掛かる**と、位置がずれることがあります。フィルタはスプライトの範囲の大きさのテクスチャへ描き、投影は**フルスクリーン固定**だからです。MZ の画面のフラッシュ・フェード・色調は画面全体に掛かるフィルタなので、影響ありません。
- **ステンシルマスク**には MZ canvas のステンシルバッファが必要です（既定で有効です）。

このフィルタの下でも位置を保つことは、今後の対応予定です（[ROADMAP.md](./ROADMAP.md) を参照）。

### ビルドして試す

```sh
pnpm --filter @spritestudio/ssplayer-rmmz build      # dist/browser/ssplayer-rpgmakermz.js
pnpm --filter @spritestudio/ssplayer-rmmz run pack   # dist/pack/ssplayer-rmmz-plugin-<v>.zip
```

同梱の MZ サンプルで動かすには、次のようにします。

```sh
pnpm --filter rmmz-example run sync:plugin   # ビルド済みプラグイン + 非SIMD wasm を js/plugins/ へ
pnpm deploy-examples                         # SS-SDK テストプロジェクトを spritestudio/ へ変換
nw examples/rmmz-example/SampleProject test  # テストプレイ（または MZ エディタで開く）
```

テストプレイになるのは `test` を付けたときです。MZ は最初の引数からそれを読み、付けずに起動するとデプロイ後のゲームと同じ扱いになります。`sync:plugin` はビルド済みプラグインを同期します（`tyranoscript-example` と同じ方式です）。
`deploy-examples` はテストアセットの変換・配布を一手に担う単一の入口です。NW.js がなければ、
`examples/rmmz-harness` のブラウザハーネス（実 `SSPlayer` / `SSPlayerRenderer` を PixiJS v5 上で駆動します）を使ってください。

サンプルでテストプレイでの変換を試すには、`packages/ssconverter-core/wasm/ssconverter_bg.wasm` を `SampleProject/js/plugins/` にコピーし、SpriteStudio のプロジェクトを `SampleProject/SpriteStudio_Source/` に置きます。どちらも git の管理対象外です。サンプルは Web デモとしても公開され、そこでは変換が動かないため、`sync:plugin` はコンバータをコピーしません。変換を担うのは [`ssconverter-importer`](../ssconverter-importer) で、TyranoBuilder がプロジェクトを開いたときに走らせるものと同じインポーターです。

自分のゲーム向けにプラグインをビルドする方法と、エディタを使わずに本物の MZ で確かめる方法はドキュメントサイトの[ビルドガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/development/build)に、この作りになっている理由は[プレイヤーの構成](https://cri-middleware.github.io/SSPlayerForWeb/ja/development/architecture)にあります。

## ライセンス

BSD-3-Clause — [LICENSE.md](./LICENSE.md) を参照してください。
