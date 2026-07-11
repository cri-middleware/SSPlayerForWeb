[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyrano

**TyranoScript / TyranoBuilder** のシナリオに `[ss_*]` タグを書くだけで、
**SpriteStudio 7** のアニメを表示・再生できます。プログラミングは不要です。

> **対象読者:** TyranoScript / TyranoBuilder を使う VN シナリオ作者 — SpriteStudio アニメ用の `[ss_*]` シナリオタグを追加するドロップイン・プラグインです。
> **ステータス:** 実験的 / alpha・private（npm 未公開）。
> **目的が違う場合:** → [ssplayer-webgl](../ssplayer-webgl/README.ja.md) — このプラグインの土台になっている単体レンダラです。

> ⚠️ **alpha / 実験的 / private。** 本プラグインは初期段階で npm には公開していません。
> タグ名や挙動はバージョン間で変わる可能性があります。設計ロードマップはリポジトリの
> [`ROADMAP.md`](./ROADMAP.md) にあります。

## インストール

**まだリリース版はありません。** 現状で入手する唯一の方法はソースからのビルドです
（[コントリビューター向け — ソースからビルド](#コントリビューター向け--ソースからビルド) を参照）。

最初のリリース以降は、プロジェクトの GitHub Releases に ZIP が添付されます。導入手順は
次の通りです:

1. リリースをダウンロードして解凍すると、`ssplayer/` フォルダが入っています。
2. その `ssplayer/` フォルダを Tyrano プロジェクトの `data/others/plugin/` にコピーします。
3. シナリオから `[plugin name="ssplayer"]` で読み込みます（下記の例を参照）。

フォルダには 3 ファイルが入ります: `init.ks`（ローダ）、`main.js`（プラグイン本体）、
`ssruntime_bg.wasm`（アニメーションランタイム）。`.ssab` アニメファイルは
`data/others/ssdata/` に置きます。

## クイックスタート

ループするキャラを 1 体表示する最小シナリオ:

```
; first.ks
[plugin name="ssplayer"]
[ss_init wasm="others/plugin/ssplayer/ssruntime_bg.wasm"]
[ss_new name="chr" storage="others/ssdata/Chara.ssab" layer="0" x="640" y="480" loop="true"]
[ss_play name="chr"]
```

- `[ss_init]` はランタイムを一度だけ読み込みます — ゲーム冒頭付近に置いてください。
- `[ss_new]` は名前付きプレイヤーを生成し、`.ssab` をロードしてレイヤーに置き、再生します。
- `[ss_play]` は既存プレイヤーで再生／アニメ切替を行います。

動く最小プロジェクトは [`examples/tyrano-example`](../../examples/tyrano-example/README.md) を参照してください。

## 提供タグ

| タグ | 役割 | 主な属性 |
| --- | --- | --- |
| `[ss_init]` | ランタイム初期化（一度）＋音声設定 | `wasm=`（必須相当）, `base=`, `audio=`, `sounddir=`, `soundext=`, `sevolume=` |
| `[ss_new]` | プレイヤー生成 → ssab ロード → レイヤーへ挿入 → 再生 | `name=`(必須) `storage=`(必須) `anime=` `layer=` `page=` `x=` `y=` `scale=` `loop=` |
| `[ss_play]` | 再生 / アニメ切替 | `name=`(必須) `anime=` `loop=` `start=` |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` | 個別プレイヤーの停止 / 一時停止 / 再開 | `name=`(必須) |
| `[ss_wait]` | アニメ終了（ループ時は1周）までシナリオを待つ | `name=`(必須) |
| `[ss_pos]` | 瞬間移動/スケール（アンカー基準・絶対） | `name=`(必須) `x=` `y=` `scale=` |
| `[ss_move]` | 補間移動/スケール（easeOut, 非ブロッキング） | `name=`(必須) `x=` `y=` `scale=` `time=` |
| `[ss_free]` | 1 プレイヤーを解放 | `name=`(必須) |
| `[ss_free_all]` | 全プレイヤー解放（シーン遷移 / レイヤークリア時） | — |
| `[ss_pause_all]` / `[ss_resume_all]` | 全プレイヤー一時停止 / 再開（メニュー等で使用） | — |
| `[ss_restore]` | セーブから全プレイヤーを再構築（**`make.ks` に記述**） | — |

座標は他の画面要素と同じく、Tyrano の通常の左上原点ピクセル（`config.scWidth × scHeight`）
を使います。[^coords] `loop` は `true`→無限 / `false`→1 回 / 数値→回数。

[^coords]: 内部的には canvas は HiDPI 対応です。ピクセル倍率の詳細はコントリビューター
向けセクションを参照してください。

## 移動・エフェクトは `[anim]` / `[kanim]` で

各 SS プレイヤーはレイヤー内の実要素で、生成時に**プレイヤー名を識別子として付与**します。
そのため他のキャラと同じように、Tyrano 標準の `[anim]` / `[kanim]` でそのまま動かせます:

```
[ss_new name="ringo" storage="others/ssdata/ringo.ssab" layer="0" x="640" y="480"]
[anim name="ringo" time="800" opacity="0"]        ; フェードアウト（消える）
[anim name="ringo" time="800" opacity="255"]      ; フェードイン（現れる）
[anim name="ringo" time="600" left="120" top="0"] ; スライド
[kanim name="ringo" time="500" ...]               ; キーフレームも可
```

> ⚠️ TyranoScript の `[anim]` の **`opacity` は 0〜255**（0〜1 ではない）。`opacity="1"`
> はほぼ透明（約 0.4%）になります。**完全表示は `255`**。

**使い分け:**

- **フェード（opacity）／単純なスライド・シェイク**は `[anim]` / `[kanim]` が最適です。
- **絶対座標・アンカー基準**の位置やスケールが要る場合は、代わりに **`[ss_pos]`**（瞬間）
  または **`[ss_move]`**（補間）を使ってください。`[anim]` では `left`/`top` は初期位置からの
  **相対**移動になり、`scale`/`rotate` はアニメのアンカーではなく画面中心を軸に回ります。

## セーブ / ロードとライフサイクル

- **通常のテキスト待ち（`[l]` / `[p]`）中も再生は継続します** — これが期待挙動です。
  メニューやセーブ画面で止めたい場合は `[ss_pause_all]` / `[ss_resume_all]` を使います。
  画面外・タブ非表示では自動的に一時停止します。
- **セーブ / ロード**: プレイヤーはロード時に復元されます。`make.ks` に `[ss_init]` →
  `[ss_restore]` を置くと、ロード後に再構築されます（正確なセーブ frame ではなくアニメ
  先頭から再開します）。
- **シーン切替**: シーン遷移やレイヤークリア時は `[ss_free]` / `[ss_free_all]` を呼び、
  不要になったプレイヤーを除去してください。

## 音声

SpriteStudio のサウンドイベントは TyranoScript 同梱の音声（howler）で再生されます。音声
ファイルは `data/sound/` 前提で、SS のサウンド名 → `data/<dir>/<name>.<ext>` に解決します
（`[ss_init sounddir= soundext= sevolume=]` で調整、`audio="false"` で無効化）。

ティラノビルダー `.tbp` 対応・`[cm]` / `[clearfix]` 自動フック・frame 精密復元・Tyrano 音量
スライダー連動は [`ROADMAP.md`](./ROADMAP.md) の残課題です。

---

## コントリビューター向け — ソースからビルド

*利用者はここまで。以下はこのパッケージを開発する人向けです。*

本パッケージは TyranoScript / TyranoBuilder 向けの薄いアダプタです。描画は
[`@spritestudio/ssplayer-webgl`](../ssplayer-webgl/README.ja.md) の `SSCanvasPlayer`
（WebGL1 必須 + WebGL2 自動昇格 / 依存ゼロ）が担います。このパッケージは **GPU 処理を
持たず**、レイヤー `div` への `<canvas>` 挿入・座標マッピング・再生制御といった
**TyranoScript 固有のグルー**に徹します。実装済み範囲は実 TyranoScript で確認済みで、
残タスク（ビルダー対応、変換取り込み等）は [`ROADMAP.md`](./ROADMAP.md) にあります。

### しくみ

- **ランタイムは TyranoScript／ビルダー／スタジオで共通**。単一の `main.js`
  （`master_tag` へ `[ss_*]` を自己登録する IIFE バンドル）が全てで動きます。
- ビルド成果物は 2 種類:
  - `dist/index.js`（ESM）— バンドラ／テスト用。副作用なし（`registerSSTags()` を公開します）。
  - `dist/browser/main.js`（IIFE, 自己登録, minify）— `data/others/plugin/ssplayer/main.js`
    に置く**ドロップイン**。WebGL レンダラ＋ core の JS を内包し、**WASM バイナリだけ外部**
    （`ssruntime_bg.wasm` を同梱し `[ss_init wasm=...]` で指す）。

### 内部仕様（座標・ライフサイクル）

- **座標**: Tyrano の左上原点・論理ピクセル（`config.scWidth × scHeight`）を、
  `SSCanvasPlayer`（Y-down）の描画バッファ座標へマップします。HiDPI は `devicePixelRatio`
  をバッファ倍率に反映し、`maxDPR` で上限を設けます。
- **`[anim]` 用の命名**: 生成時に canvas へプレイヤー名を CSS クラスとして付与します
  （`$.setName`＝`addClass(name)`。TyranoScript のキャラ識別と同じ仕組み）。`ss-player`
  クラスも付くので `$(".ss-player")` で一括選択できます。絶対座標指定はレンダラ内部の
  `setTransform`（Spine の `[spine_mod]` 相当）を経由するため、`[anim]` とは別に
  `[ss_pos]` / `[ss_move]` が存在します。
- **セーブ対象**: 各プレイヤーの復元情報を `TYRANO.kag.stat.f.__ssplayers` へミラーします。
  ロード時は TyranoScript が `make.ks` を call するので、そこに `[ss_init]` → `[ss_restore]`
  を置くと再構築されます。
- **解放**: `[ss_free]` / `[ss_free_all]` が `destroy()` を呼びます。`FinalizationRegistry`
  任せにしないでください。
- **音声**: SS の `onAudio` イベントは `TyranoAudioManager` 経由で howler（`window.Howl`）
  へ流します。`[playse]` ではなく howler を直接使うのは、KAG タグだと `nextOrder` で
  シナリオが進んでしまうためです。`TyranoAudioManager` はプログラムから直接利用も可能です。

### 配布（GitHub Releases）

npm には**公開しません**（`private`）。TyranoScript 作者はプラグイン一式を使います:

```bash
pnpm --filter @spritestudio/ssplayer-tyrano run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyrano run pack    # dist/pack/ssplayer-tyrano-plugin-<ver>.zip
```

`pack` は `ssplayer/{init.ks, main.js, ssruntime_bg.wasm}` を zip 化します。これを
**GitHub Releases のアセットに添付**し、利用者は `ssplayer/` を `data/others/plugin/` に展開します。
配布テンプレは [`plugin/`](./plugin/README.md) にあります。

ディスク上のプラグイン配置:

```
data/others/plugin/ssplayer/
  init.ks              # [loadjs storage="plugin/ssplayer/main.js"] → [return]
  main.js              # このパッケージの dist/browser/main.js
  ssruntime_bg.wasm    # @spritestudio/ssplayer-core の runtime バイナリ
data/others/ssdata/<project>.ssab
```

### API（ESM）

```ts
import { registerSSTags } from '@spritestudio/ssplayer-tyrano';

// TyranoScript ランタイム起動後に呼ぶと [ss_*] を登録する。
// 省略時はグローバル TYRANO を使用。Tyrano 不在なら false を返す no-op。
registerSSTags();
```

### 開発

```bash
pnpm --filter @spritestudio/ssplayer-tyrano run build   # dist/index.js + dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyrano run test    # vitest (モック TYRANO ハーネス, 実エンジン不要)
```

## ライセンス

BSD-3-Clause © CRI Middleware Co., Ltd.
</content>
