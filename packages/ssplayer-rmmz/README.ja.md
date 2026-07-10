[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-rmmz

**SpriteStudio 7**（`.ssab`）アニメーションを **RPG Maker MZ** で再生するプラグインです。
キャラやピクチャと正しい前後関係（Zオーダー）で表示されます。

[SSPlayerForWeb](../../README.ja.md) モノレポの一部です。この README は2部構成になっています。
**[プラグインの使い方](#プラグインの使い方)**（RPG Maker MZ でゲームを作る方向け）と、
**[開発・コントリビュート](#開発コントリビュート)**（プラグインや SDK に手を入れる方向け）です。

---

# プラグインの使い方

*RPG Maker MZ でゲームを作る方向けに、導入からアニメの変換、イベントコマンドでの操作までを説明します。*

## 1. 導入

1. `ssplayer-rpgmakermz.js` と `ssruntime_bg.wasm` を用意します（リリース zip を使うか、
   自分でビルドしてください → [開発・コントリビュート](#開発コントリビュート) 参照）。
2. **両方**を `js/plugins/` にフラットに配置します（WASM は `.js` と同じ場所に置いてください）。
3. プラグイン管理で **ssplayer-rpgmakermz** を有効化します。パラメータはありません（WASM は
   プラグイン `.js` と同じフォルダから自動で読み込まれます）。

## 2. アニメを変換する（.sspj → .ssab）

本プラグインは**変換済み**の `.ssab` を再生します。SpriteStudio プロジェクトを、次のいずれかで
変換してください。

- **Web（インストール不要）：** ホスト版コンバータ
  **<https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/>** を開き、`.sspj`
  プロジェクトをドロップすると `.ssab`（＋テクスチャ）をダウンロードできます。
- **デスクトップ：** [**SSConverterGUI**](https://github.com/cri-middleware/SSConverterGUI/releases) を使います。

出力を `img/spritestudio/<プロジェクト名>/` に置くと、`SS表示` のパス
`img/spritestudio/<プロジェクト名>/<プロジェクト名>.ssab` と一致します。

## 3. プラグインコマンド

イベントの「プラグインコマンド」から `ssplayer-rpgmakermz` を選んで使います。SS アニメは
MZ の**ピクチャ**に乗るので、**ピクチャの移動**・拡大・Zオーダー・セーブ/ロードがそのまま効きます。

**表示・割り当て**

- **SS表示**（`showSS`）— ピクチャを作成し、アニメを割り当てて再生開始まで一括で行います。
  引数は `ピクチャ番号`、`SSABファイル`（例 `img/spritestudio/Ringo/Ringo.ssab`）、
  `アニメーション名`（空欄で先頭）、`X`, `Y`, `拡大率`, `ループ回数`, `シグナル→スイッチ`,
  `完了までウェイト` です。
- **SSをピクチャに割当**（`setSSAsPicture`）— 標準の「ピクチャの表示」で既に出したピクチャに、
  SS を後付けします。位置や消去は標準の「ピクチャの移動/消去」で操作してください（1つの
  ピクチャ番号を、素のピクチャ表示と SS で同時に使わないでください）。

**アニメーション制御**

- **SSアニメ切替**（`changeSSAnimation`）— 同じ `.ssab` 内の別のアニメーションへ切り替えます
  （再ロードなし）。
- **SSワンショット再生**（`playSSOnce`）— アニメを再生し、終わったら**現在のループへ自動で
  戻ります**（待機 → 表情 → 待機）。`ループ回数` で再生回数を指定できます。
- **SS連続再生**（`playSSSequence`）— カンマ区切りのアニメ列を再生します。末尾以外は1回ずつ、
  末尾だけループします（例 `attack1,attack2,wait1`）。
- **SS再生速度**（`setSSSpeed`）— 再生速度の倍率を指定します。サブフレーム補間により低速でも
  滑らかに再生されます。

**再生・ライフサイクル**

- **SS再生 / 一時停止 / 停止 / 削除** と **SS完了待ち** を `ピクチャ番号` で操作します。
  「SS完了待ち」は**非ループ**アニメが終わるまでイベントを待機させます（有限ループで使って
  ください。無限ループだと待ち続けます）。

**リップシンク（喋る立ち絵・応用）**

- **SSリップシンク設定**（`setSSTalk`）— ピクチャを**話者名**（メッセージの名前欄）に紐づけます。
  その話者のメッセージ表示中は `発話` アニメを、それ以外は `待機` アニメを再生するので、
  喋っているキャラだけが口パクします。
- **SSリップシンク解除**（`clearSSTalk`）— 紐づけを解除します。会話が終わったら呼んでください。

> `アニメーション名` を空欄にすると先頭のアニメを自動で採用します。存在しない名前を指定すると、
> コンソールに警告と**利用可能なアニメ名の一覧**を表示します（MZ エディタは `.ssab` を読めない
> ため、動的なプルダウンは仕様上できません）。

## 4. デプロイメント ⚠️

**「未使用ファイルを削除」でアニメが消えます。** `img/spritestudio/` の `.ssab`/テクスチャは
動的に読み込まれるため、MZ のデプロイオプションはこれらを未使用と判断して削除してしまいます。
**同オプションを OFF にする**か、デプロイ後に **`img/spritestudio/` を出力先へコピー**して
ください（旧 SS6Player と同じ制約です）。

## 現在の制限

- **ピクチャの不透明度／色調は SS アニメに反映されません**（常に不透明で描画されます）。
  移動・拡大は反映されます。
- SS スプライトに **PIXI フィルタを直接掛ける**と位置がズレることがあります（投影がフル
  スクリーン固定のため）。MZ の画面効果（フラッシュ・色調）は別オーバーレイなので影響ありません。
- ループ SE（`loopNum`）は1回だけ再生されます。ステンシルマスクには MZ canvas のステンシル
  バッファが必要です（既定で有効です）。

---

# 開発・コントリビュート

*プラグインや SDK に手を入れる方向けに、アーキテクチャ、ソースからのビルド、同梱ハーネスを説明します。*

## しくみ

`.ssab` を **MZ 自身の PixiJS v5 レンダラへ直接描画**しています（MZ の Tilemap や同梱の
Effekseer と同じ方式です）。別 canvas のオーバーレイにならないため、キャラやピクチャと正しい
前後関係で表示されます。

- **ランタイム**：**非 SIMD（スカラー）版**の SpriteStudio WASM を同梱しているため、MZ 同梱の
  NW.js（WebAssembly SIMD 非対応の Chromium）でも起動フラグなしに動作します。初期化に失敗した
  場合は SS アニメだけが無効化され、ゲーム自体は起動します（理由はコンソールに表示されます）。
- **Layer 3（レンダラ）**：`SSPlayer` は `PIXI.Container`、`SSPlayerRenderer` は登録済みの
  `PIXI.ObjectRenderer`（`'ssplayer'`）で、[`@spritestudio/ssplayer-webgl`](../ssplayer-webgl)
  の `SSWebGLRenderer` を MZ の共有 `gl` 上で駆動します。これを再利用することで、**マスク・
  エフェクト・SS特殊シェーダ13種・インスタンスパーツがそのまま動作**します。生 GL 描画の前後は、
  MZ の Effekseer スプライトと同一の WebGL ステート退避／復元で挟んでいます。
- **Layer 4（プラグイン）**：ドロップイン型の IIFE です。`Scene_Boot.isReady` で WASM の初期化を
  待ち、Game_Picture ↔ Sprite_Picture ブリッジでアニメをピクチャにアタッチします（MZ の移動・
  拡大が適用され、セーブ／ロードで状態が復元されます）。テクスチャは `ImageManager`、音声は
  `AudioManager` に委譲します。
- **独自タイマーを持ちません**：再生は親スプライトの `update()` からのみ進むため、メニューや
  メッセージ待ちのときにゲームと一緒にピタッと止まります。

上記の不透明度／色調・投影の制限は、いずれも `SSWebGLRenderer` への小さな改修（投影行列と
α/tint uniform の注入）できれいに解決できます（今後対応予定です）。

## ビルドして試す

```sh
pnpm --filter @spritestudio/ssplayer-rmmz build      # dist/browser/ssplayer-rpgmakermz.js
pnpm --filter @spritestudio/ssplayer-rmmz pack       # dist/pack/ssplayer-rmmz-plugin-<v>.zip
```

同梱の MZ サンプルで動かすには、次のようにします。

```sh
pnpm --filter rmmz-example run sync:plugin   # ビルド済みプラグイン + 非SIMD wasm を js/plugins/ へ
pnpm deploy-examples                         # SS-SDK テストプロジェクトを img/spritestudio/ へ変換
nw examples/rmmz-example/SampleProject       # テストプレイ（または MZ エディタで開く）
```

`sync:plugin` はビルド済みプラグインを同期します（`tyrano-example` と同じ方式です）。
`deploy-examples` はテストアセットの変換・配布を一手に担う単一の入口です。NW.js がなければ、
`examples/rmmz-harness` のブラウザハーネス（実 `SSPlayer` / `SSPlayerRenderer` を PixiJS v5 上で
駆動します）を使ってください。

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md) を参照してください。
