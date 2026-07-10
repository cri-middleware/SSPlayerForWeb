# @spritestudio/ssplayer-tyrano

**TyranoScript / TyranoBuilder** 向けの薄いアダプタ。SpriteStudio 7 のアニメを
`[ss_*]` KAG カスタムタグで VN シナリオに表示・再生します。

描画は [`@spritestudio/ssplayer-webgl`](../ssplayer-webgl/README.md) の
`SSCanvasPlayer`（WebGL1 必須 + WebGL2 自動昇格 / 依存ゼロ）を使います。この
パッケージは **GPU 処理を持たず**、レイヤー `div` への `<canvas>` 挿入・座標
マッピング・再生制御といった **TyranoScript 固有のグルー**に徹します。

> 設計の全体像・残タスクは [`TYRANO_COLDSTART.md`](../../TYRANO_COLDSTART.md) を参照。
> 現状の実装範囲は **PT1（最小表示: `[ss_init]` / `[ss_new]` / `[ss_play]`）**。

## しくみ

- **ランタイムは TyranoScript／ビルダー／スタジオで共通**。単一の `main.js`
  （`master_tag` へ `[ss_*]` を自己登録する IIFE バンドル）が全てで動きます。
- ビルド成果物は 2 種類:
  - `dist/index.js`（ESM）— バンドラ／テスト用。副作用なし（`registerSSTags()` を公開）。
  - `dist/browser/main.js`（IIFE, 自己登録, minify）— TyranoScript プロジェクトの
    `data/others/plugin/ssplayer/main.js` に置く**ドロップイン**。WebGL レンダラ＋
    core の JS を内包し、**WASM バイナリだけ外部**（`ssruntime_bg.wasm` を同梱し
    `[ss_init wasm=...]` で指す）。

## 提供タグ（PT1 + PT2 + PT3）

| タグ | 役割 | 主な属性 |
| --- | --- | --- |
| `[ss_init]` | WASM 初期化 + 音声設定 | `wasm=`（必須相当）, `base=`, `audio=`, `sounddir=`, `soundext=`, `sevolume=` |
| `[ss_new]` | プレイヤー生成 → ssab ロード → レイヤーへ canvas 挿入 → 再生 | `name=`(必須) `storage=`(必須) `anime=` `layer=` `page=` `x=` `y=` `scale=` `loop=` |
| `[ss_play]` | 再生 / アニメ切替 | `name=`(必須) `anime=` `loop=` `start=` |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` | 個別プレイヤーの停止 / 一時停止 / 再開 | `name=`(必須) |
| `[ss_wait]` | アニメ終了（ループ時は1周）までシナリオを待つ | `name=`(必須) |
| `[ss_pos]` | 瞬間移動/スケール（内部 transform・アンカー基準・絶対） | `name=`(必須) `x=` `y=` `scale=` |
| `[ss_move]` | 補間移動/スケール（内部 transform, easeOut, 非ブロッキング） | `name=`(必須) `x=` `y=` `scale=` `time=` |
| `[ss_free]` | 解放（canvas 除去 + `destroy()` + レジストリ削除） | `name=`(必須) |
| `[ss_free_all]` | 全プレイヤー解放（シーン遷移 / レイヤークリア時） | — |
| `[ss_pause_all]` / `[ss_resume_all]` | 全プレイヤー一時停止 / 再開（メニュー等で使用） | — |
| `[ss_restore]` | セーブから全プレイヤーを再構築（**`make.ks` に記述**） | — |

座標は Tyrano の**左上原点・論理ピクセル**（`config.scWidth × scHeight`）を、
`SSCanvasPlayer`（Y-down）の描画バッファ座標へマップします（HiDPI は
`devicePixelRatio` をバッファ倍率に反映、`maxDPR` で上限）。`loop` は
`true`→無限 / `false`→1 回 / 数値→回数。

### ライフサイクル（PT2 / §3.3）

- **描画ループ**: `SSCanvasPlayer` 内蔵 RAF。`pauseWhenHidden`（既定 ON）でタブ非表示／
  画面外は自動 pause。**テキスト待ち（`[l]`/`[p]`）中はページが可視なので再生継続**
  （期待挙動）。メニュー／セーブ画面で止めたい場合は `[ss_pause_all]`／`[ss_resume_all]`。
- **セーブ / ロード**: 各プレイヤーの復元情報を `TYRANO.kag.stat.f.__ssplayers`
  （セーブ対象）へ随時ミラー。ロード時は TyranoScript が `make.ks` を call するので、
  そこに `[ss_init]` → `[ss_restore]` を置くと再構築される（frame ではなくアニメ先頭から）。
- **解放**: シーン遷移・レイヤークリアで `[ss_free]`／`[ss_free_all]` を呼び `destroy()`
  （`FinalizationRegistry` 任せにしない）。

### 移動・エフェクトは TyranoScript 標準タグで（`[anim]` / `[kanim]`）

SS プレイヤーの canvas は**レイヤー内の実 DOM 要素**で、生成時に**プレイヤー名を
CSS クラスとして付与**します（TyranoScript のキャラ識別は `$.setName`＝
`addClass(name)` と同じ仕組み）。そのため **`[anim]` / `[kanim]` でそのまま動かせます**:

```
[ss_new name="ringo" storage="others/ssdata/ringo.ssab" layer="0" x="640" y="480"]
[anim name="ringo" time="800" opacity="0"]        ; フェードアウト（消える）
[anim name="ringo" time="800" opacity="255"]      ; フェードイン（現れる）
[anim name="ringo" time="600" left="120" top="0"] ; スライド（CSS 平行移動）
[kanim name="ringo" time="500" ...]               ; キーフレームも可
```

> ⚠️ TyranoScript の `[anim]` の **`opacity` は 0〜255**（0〜1 ではない）。`$.convertOpacity`
> が `val/255` で変換するため、`opacity="1"` は約 0.4%（ほぼ透明）になります。**完全表示は
> `255`**。

canvas には `ss-player` クラスも付くので、`$(".ss-player")` で一括選択も可能です。

**使い分け**（正典 Spine プラグインが独自 `[spine_mod]` を持つ理由と同じ）:

- **フェード（opacity）／単純なスライド・シェイク**は `[anim]`/`[kanim]` が最適。
  canvas を CSS で動かすだけなので追加コード不要。
- ただし canvas は**画面サイズ全体**で、位置は**レンダラ内部の `setTransform`**（`[ss_new
  x/y]`）で決まるため、`[anim left/top]` は初期位置からの**相対オフセット**になり、
  `scale`/`rotate` は**画面中心ピボット**（SS アンカー基準ではない）。**絶対座標・
  アンカー基準の位置/スケール**が要る場合は、内部 `setTransform` を叩く **`[ss_pos]`（瞬間）
  / `[ss_move]`（補間）**（Spine の `[spine_mod]` 相当）を使う。

### 音声（PT3 / §3.4）

SS の音声イベント（`onAudio`）を **TyranoScript 同梱の howler（`window.Howl`）**へ流します
（`TyranoAudioManager`）。`[playse]` ではなく howler を直接使うのは、KAG タグだと
`nextOrder` でシナリオが進んでしまうためです。音声ファイルは `data/sound/` 前提で、SS の
サウンド名 → `data/<dir>/<name>.<ext>` に解決（`[ss_init sounddir= soundext= sevolume=]`
で調整、`audio="false"` で無効化）。プログラムからは `TyranoAudioManager` を直接利用も可。

ティラノビルダー `.tbp` 対応は PT4（§5）。`[cm]`/`[clearfix]` 自動フック・frame 精密復元・
Tyrano 音量スライダー連動は §7 の残課題。

## 配布（GitHub Releases）

npm には**公開しません**（`private`）。TyranoScript 作者はプラグイン一式を使います:

```bash
pnpm --filter @spritestudio/ssplayer-tyrano run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyrano run pack    # dist/pack/ssplayer-tyrano-plugin-<ver>.zip
```

`pack` は `ssplayer/{init.ks, main.js, ssruntime_bg.wasm}` を zip 化します。これを
**GitHub Releases のアセットに添付**し、利用者は `ssplayer/` を `data/others/plugin/` に展開。
配布テンプレは [`plugin/`](./plugin/README.md)。ビルダー用 `.tbp` は PT4。

## 使い方（プラグイン配布）

```
data/others/plugin/ssplayer/
  init.ks              # [loadjs storage="plugin/ssplayer/main.js"] → [return]
  main.js              # このパッケージの dist/browser/main.js
  ssruntime_bg.wasm    # @spritestudio/ssplayer-core の runtime バイナリ
data/others/ssdata/<project>.ssab
```

```
; first.ks
[plugin name="ssplayer"]
[ss_init wasm="others/plugin/ssplayer/ssruntime_bg.wasm"]
[ss_new name="chr" storage="others/ssdata/Chara.ssab" layer="0" x="640" y="480" loop="true"]
[ss_play name="chr"]
```

動く最小プロジェクトは [`examples/tyrano-example`](../../examples/tyrano-example/README.md)
を参照（TyranoScript 本体は dev-time に各自配置）。

## API（ESM）

```ts
import { registerSSTags } from '@spritestudio/ssplayer-tyrano';

// TyranoScript ランタイム起動後に呼ぶと [ss_*] を登録する。
// 省略時はグローバル TYRANO を使用。Tyrano 不在なら false を返す no-op。
registerSSTags();
```

## 開発

```bash
pnpm --filter @spritestudio/ssplayer-tyrano run build   # dist/index.js + dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyrano run test    # vitest (モック TYRANO ハーネス, 実エンジン不要)
```

## ライセンス

BSD-3-Clause © CRI Middleware Co., Ltd.
