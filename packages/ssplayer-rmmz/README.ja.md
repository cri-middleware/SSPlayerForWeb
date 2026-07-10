[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-rmmz

**SpriteStudio 7** アニメーションを RPG Maker MZ（PixiJS v5）で再生するプレイヤー＋プラグイン。

[SSPlayerForWeb](../../README.ja.md) モノレポの一部です。

`.ssab` アニメを **MZ 自身の PixiJS v5 レンダラへ直接描画**します（MZ の Tilemap や
同梱の Effekseer と同じ方式）。そのためキャラやピクチャと正しい前後関係（Zオーダー）
で表示され、別 canvas のオーバーレイにはなりません。

> ## 🚧 開発中（Work in progress）
>
> レンダラは動作します。SpriteStudio アニメを正しく再生することを、`examples/rmmz-harness`
> （本物の `SSPlayer` / `SSPlayerRenderer` を実 PixiJS v5 上で駆動）でモダンブラウザ上で確認済みです。
>
> **ただし RPG Maker MZ エディタの「テストプレイ」ではまだ動きません。** SpriteStudio の
> WASM ランタイムは **WebAssembly SIMD** を必要としますが、RPG Maker MZ は最新版（1.10）でも
> 同梱 NW.js が古く（0.51 / **Chromium 89**）SIMD が既定 OFF で、テストプレイは有効化用の
> `package.json` 起動フラグを無視します。そのため素の MZ ではアニメは無効化されます
> （ゲーム自体は動作し、理由はコンソールに表示されます）。
>
> **対応予定：** core WASM の**非 SIMD（スカラフォールバック）ビルド**を用意し、MZ 同梱の
> Chromium でもフラグ無しで動くようにします。それまでは Chromium 91+ のランタイム
> （NW.js の更新／差し替え、または新しい `nw` でデプロイ版を起動）で MZ 上の描画を確認できます。
>
> API・プラグインコマンド・アセット配置は変更される可能性があります。

## しくみ

- **Layer 3（レンダラ）**：`SSPlayer` は `PIXI.Container`、`SSPlayerRenderer` は
  登録済み `PIXI.ObjectRenderer`（`'ssplayer'`）で、
  [`@spritestudio/ssplayer-webgl`](../ssplayer-webgl) の `SSWebGLRenderer` を MZ の
  共有 `gl` 上で駆動します。この再利用により **マスク・エフェクト・SS特殊シェーダ13種・
  インスタンスパーツがそのまま動作**します。生 GL 描画の前後は、MZ の Effekseer
  スプライトと同一の WebGL ステート退避／復元で挟みます。
- **Layer 4（プラグイン）**：ドロップインの `.js`（IIFE）。`Scene_Boot.isReady` で
  WASM 初期化を待ち、Game_Picture ↔ Sprite_Picture ブリッジでアニメをピクチャに
  アタッチ（MZ の移動・拡大が適用され、セーブ／ロードで状態が復元）。テクスチャは
  `ImageManager`、音声は `AudioManager` に委譲します。
- **独自タイマー無し**：再生は親スプライトの `update()` からのみ進むため、メニューや
  メッセージ待ちでゲームと一緒にピタッと止まります。

## 導入（MZ プラグインとして）

1. ビルド＆パック（またはリリース zip を入手）：
   ```sh
   pnpm --filter @spritestudio/ssplayer-rmmz build
   pnpm --filter @spritestudio/ssplayer-rmmz pack   # dist/pack/ssplayer-rmmz-plugin-<v>.zip
   ```
2. 以下を `js/plugins/` にフラットに配置（WASM は `.js` と同じ場所に置く必要あり）：
   - `ssplayer-rpgmakermz.js` ＋ `ssruntime_bg.wasm`
   - *（任意・開発用）* `ssplayer-rpgmakermz-devconvert.js` ＋ `ssconverter_bg.wasm`
3. プラグイン管理で **ssplayer-rpgmakermz** を有効化。パラメータ不要（WASM はプラグイン
   `.js` と同じフォルダから自動ロード）。

## 使い方

変換済み `.ssab` を `img/spritestudio/<プロジェクト名>/` に置き、プラグインコマンド
（イベント → プラグインコマンド → `ssplayer-rpgmakermz`）で操作します：

- **SS表示** — `ピクチャ番号`、`SSABファイル`（例
  `img/spritestudio/Ringo/Ringo.ssab`）、`アニメーション名`（空欄で先頭アニメ）、
  `X`, `Y`, `拡大率`, `ループ回数`, `シグナル→スイッチ`、`完了までウェイト`。
- **SS完了待ち** — `ピクチャ番号` のアニメが終わるまでイベントを待機（非ループ向け）。
- **SS再生 / 一時停止 / 停止 / 削除** — `ピクチャ番号` で操作。

`アニメーション名` を空欄にすると先頭を自動採用。存在しない名前を指定すると
コンソールに警告と**利用可能なアニメ名一覧**を出力します（MZ エディタは `.ssab` を
読めないため、動的プルダウンは仕様上不可）。

### 完了までウェイト

MZ の「アニメーションの表示 → 完了までウェイト」に相当します。`SS表示` の
`完了までウェイト` を ON にするか、`SS完了待ち` コマンドを使うと、アニメ終了まで
イベントが待機します。`Game_Interpreter.updateWaitMode` フックで実現しており、
**有限ループ（0/1）** で使用してください（無限ループは終了しないため待機し続けます）。

## 開発用コンバータ（.sspj を置くだけ → .ssab 生成）

開発中は **ssplayer-rpgmakermz-devconvert** を有効化。**NW.js テストプレイ**時に
`<game>/ss_source/` の `.sspj` を走査し、変更があったものを（mtime キャッシュ）
[`@spritestudio/ssconverter-core`](../ssconverter-core) で `img/spritestudio/<project>/`
へ変換します。**デプロイ版では何もしません**（ファイルシステム無し）。製品版には
変換済み `.ssab` を同梱し、本プラグインは含めないでください。

## 同梱 MZ サンプルで試す

ビルド後、プラグイン＋SpriteStudio ソースプロジェクトを
`examples/rmmz-example/SampleProject/` へワンステップで配備できます：

```sh
pnpm --filter @spritestudio/ssplayer-rmmz build
pnpm --filter @spritestudio/ssplayer-rmmz deploy:example          # プラグイン + Ringo ソース
# node scripts/deploy-example.mjs Ringo Mesh   # 特定プロジェクト
# node scripts/deploy-example.mjs --all        # tests/* 全プロジェクト
# node scripts/deploy-example.mjs --no-dev     # dev コンバータを除外
```

runtime プラグイン＋WASM（と dev コンバータ）を `js/plugins/` にコピーし、
`js/plugins.js` へ登録（冪等・他プラグインは保持）、各プロジェクトのソースを
`ss_source/<name>/` にコピーします。あとは `nw examples/rmmz-example/SampleProject`
でテストプレイし、イベントに「SS表示」プラグインコマンドを追加してください。
（NW.js が無ければ `examples/rmmz-harness` のブラウザハーネスをどうぞ。）

## デプロイメント ⚠️

- **「未使用ファイルを削除」でアニメが消えます。** `img/spritestudio/` の
  `.ssab`/テクスチャは動的ロードのため、MZ のデプロイオプションが未使用と判断して
  削除します。**同オプションを OFF**にするか、デプロイ後に **`img/spritestudio/` を
  出力先へコピー**してください（旧 SS6Player と同じ制約）。
- **開発用コンバータを同梱しない。** リリース前に
  `ssplayer-rpgmakermz-devconvert.js` と `ssconverter_bg.wasm`（約1.4MB）の**両方**を
  `js/plugins/` から削除し、プラグインを無効化してください（NW.js テストプレイ専用）。

## v1 の制限

`SSWebGLRenderer` をそのまま再利用しているため：

- **ピクチャの不透明度／色調は SS アニメに未適用**（常に不透明で描画）。移動・拡大は適用。
- **投影がフルスクリーン固定**：SS スプライトに **PIXI フィルタを直接**掛けると位置が
  ズレ得ます。MZ の画面効果（フラッシュ・色調）は別オーバーレイなので影響なし。
- ループ SE（`loopNum`）は1回再生。ステンシルマスクは MZ canvas のステンシルバッファが
  必要（既定で有効）。

投影と不透明度はいずれも `SSWebGLRenderer` への小改修（投影行列＋α/tint uniform の注入）
で綺麗に解決可能です（今後の対応予定）。

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md) 参照。
