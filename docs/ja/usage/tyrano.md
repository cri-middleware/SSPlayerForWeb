# TyranoScript / TyranoBuilder で使う

::: warning 実験的 / アルファ版
`@spritestudio/ssplayer-tyrano` は **実験的なアルファ版**（`7.0.0-alpha.1`）です。パッケージは
**private で、npm には公開されていません**。描画は [`ssplayer-webgl`](/ja/usage/webgl) の
`SSCanvasPlayer` を土台にしており、タグ名や挙動はバージョン間で変わる可能性があります。

**リリースはまだ 1 つもありません。** 正式リリース後はプラグイン ZIP が **GitHub Releases** で
配布される予定ですが、現時点で入手する唯一の方法は [ソースからのビルド](#ソースからビルドする)です。
:::

**TyranoScript / TyranoBuilder** のシナリオに `[ss_*]` タグを書くだけで、**SpriteStudio 7**
（`.ssab`）のアニメを表示・再生できます。プログラミングは不要です。各アニメはレイヤーに載る
実際の `<canvas>` なので、キャラクター・背景・メッセージと同じレイヤースタックに並びます。

## しくみ

プラグインは `[ss_*]` の KAG カスタムタグ群を Tyrano の `master_tag` に登録します。自己登録する
単一の `main.js`（IIFE バンドル）が、TyranoScript / TyranoBuilder / TyranoStudio のいずれでも
動作します。

- `[ss_new]` ごとに名前付きプレイヤーを生成し、`.ssab` をロードして対象レイヤーへ `<canvas>` を
  マウントし、[`ssplayer-webgl`](/ja/usage/webgl) の `SSCanvasPlayer`（WebGL1 必須 + WebGL2 自動
  昇格 / 依存ゼロ）で駆動します。
- canvas には **プレイヤー名**が識別子として付与されるため、他のキャラと同じように Tyrano 標準の
  `[anim]` / `[kanim]` でそのまま動かせます。
- 外部に残るのは **WASM バイナリ**（`ssruntime_bg.wasm`）だけで、レンダラと core の JS は `main.js`
  に内包されています。

## 1. インストール

**まだリリースが公開されていない**ため、当面は [ソースからビルド](#ソースからビルドする)してください。
最初のリリース以降は、**GitHub Releases** からプラグイン ZIP をダウンロードして次のように導入します。

1. 解凍すると `ssplayer/` フォルダが入っています（`init.ks`＝ローダ、`main.js`＝プラグイン本体、
   `ssruntime_bg.wasm`＝ランタイム）。
2. その `ssplayer/` フォルダを Tyrano プロジェクトの `data/others/plugin/` にコピーします。
3. シナリオから `[plugin name="ssplayer"]` で読み込みます。

```
data/others/plugin/ssplayer/
  init.ks              # [loadjs storage="plugin/ssplayer/main.js"] → [return]
  main.js              # プラグイン本体（レンダラ + core を内包）
  ssruntime_bg.wasm    # アニメーションランタイムのバイナリ
data/others/ssdata/<project>.ssab
```

## 2. アニメーションの変換（.sspj → .ssab）

`.sspj` は編集用の SpriteStudio プロジェクト、`.ssab` はプラグインが実際に再生する
コンパクトなランタイムファイルです。変換方法は [アセットの準備](/ja/usage/assets) を参照して
ください。出力は `data/others/ssdata/` 以下に置き、`[ss_new storage=...]` から指します。

## 3. クイックスタート

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

動く最小プロジェクトは `examples/tyrano-example` にあります。

## 4. 提供タグ

| タグ | 役割 | 主な属性 |
| --- | --- | --- |
| `[ss_init]` | ランタイム初期化（一度）＋音声設定 | `wasm=`（必須相当）, `base=`, `audio=`, `sounddir=`, `soundext=`, `sevolume=` |
| `[ss_new]` | プレイヤー生成 → ssab ロード → レイヤーへ挿入 → 再生 | `name=`(必須) `storage=`(必須) `anime=` `layer=` `page=` `x=` `y=` `scale=` `loop=` |
| `[ss_play]` | 再生 / アニメ切替 | `name=`(必須) `anime=` `loop=` `start=` |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` | 個別プレイヤーの停止 / 一時停止 / 再開 | `name=`(必須) |
| `[ss_wait]` | アニメ終了（ループ時は 1 周）までシナリオを待つ | `name=`(必須) |
| `[ss_pos]` | 瞬間移動 / スケール（アンカー基準・絶対） | `name=`(必須) `x=` `y=` `scale=` |
| `[ss_move]` | 補間移動 / スケール（easeOut・非ブロッキング） | `name=`(必須) `x=` `y=` `scale=` `time=` |
| `[ss_part_color]` | パーツの色をアニメより優先して上書き（通常パーツのみ） | `name=`(必須) `part=`(必須) `color=`(必須) `blend=` `priority=` |
| `[ss_part_visible]` | パーツを強制的に非表示 / 解除 | `name=`(必須) `part=`(必須) `hide=` `cascade=` |
| `[ss_part_cell]` | パーツが描くセルを差し替え（通常 / マスクパーツのみ） | `name=`(必須) `part=`(必須) `cellmap=`(必須) `cell=`(必須) `priority=` |
| `[ss_part_clear]` | パーツ上書きを解除（`part=` 省略で全パーツ） | `name=`(必須) `part=` |
| `[ss_free]` | 1 プレイヤーを解放 | `name=`(必須) |
| `[ss_free_all]` | 全プレイヤー解放（シーン遷移 / レイヤークリア時） | — |
| `[ss_pause_all]` / `[ss_resume_all]` | 全プレイヤー一時停止 / 再開（メニュー等で使用） | — |
| `[ss_restore]` | セーブから全プレイヤーを再構築（**`make.ks` に記述**） | — |

座標は他の画面要素と同じく、Tyrano の通常の左上原点ピクセル（`config.scWidth × scHeight`）を
使います。`loop` は `true`→無限 / `false`→1 回 / 数値→回数です。

### パーツ上書きについて

`[ss_part_*]` はアニメのキーフレームより **優先** して、特定パーツの見た目を差し替えます
（SS6 の PartsColorChange / CellChangeParts / HideSet に相当）。

```
[ss_part_color name="chr" part="apple" color="#0033FFBF" blend="mul"]
[ss_part_visible name="chr" part="heta" cascade="true"]
[ss_part_cell    name="chr" part="apple" cellmap="Ringo" cell="effect3"]
[ss_part_clear   name="chr"]
```

- `color=` は `#RRGGBB` / `#RRGGBBAA`（α 省略時は不透明）。`#RGB` の短縮形も使えます
- `blend=` は `mix`（既定）/ `mul` / `add` / `sub`、数値 `0`〜`3` でも指定できます
- `priority=` は `keyframe`（次のキーフレームに譲る）/ `anime`（既定・アニメが変わるまで保持）/
  `permanent`（アニメ変更をまたいで維持）、数値 `0`〜`2` でも可
- `cellmap=` に `.ssce` 拡張子は付けません
- **アニメを切り替えると `permanent` 以外の上書きは解除されます。** セーブ内容も同時に整理されるため、
  ロード時に復活することはありません。表示（`[ss_part_visible]`）に優先度はなく、アニメ切替で必ず解除されます

## 5. 移動・エフェクトは `[anim]` / `[kanim]` で

各 SS プレイヤーはレイヤー内の実要素で、プレイヤー名が識別子として付与されています。そのため
他のキャラと同じように、Tyrano 標準の `[anim]` / `[kanim]` でそのまま動かせます:

```
[ss_new name="ringo" storage="others/ssdata/ringo.ssab" layer="0" x="640" y="480"]
[anim name="ringo" time="800" opacity="0"]        ; フェードアウト（消える）
[anim name="ringo" time="800" opacity="255"]      ; フェードイン（現れる）
[anim name="ringo" time="600" left="120" top="0"] ; スライド
[kanim name="ringo" time="500" ...]               ; キーフレームも可
```

::: warning `[anim]` の opacity は 0〜255
TyranoScript の `[anim]` の **`opacity` は 0〜255**（0〜1 ではない）です。`opacity="1"` は
ほぼ透明（約 0.4%）になります。**完全表示は `255`** です。
:::

**使い分け:**

- **フェード（opacity）／単純なスライド・シェイク**は `[anim]` / `[kanim]` が最適です。
- **絶対座標・アンカー基準**の位置やスケールが要る場合は、代わりに **`[ss_pos]`**（瞬間）または
  **`[ss_move]`**（補間）を使ってください。`[anim]` では `left`/`top` は初期位置からの**相対**移動に
  なり、`scale`/`rotate` はアニメのアンカーではなく画面中心を軸に回ります。

## 6. セーブ / ロードとライフサイクル

- **通常のテキスト待ち（`[l]` / `[p]`）中も再生は継続します** — これが期待挙動です。メニューや
  セーブ画面で止めたい場合は `[ss_pause_all]` / `[ss_resume_all]` を使います。画面外・タブ非表示では
  自動的に一時停止します。
- **セーブ / ロード**: プレイヤーはロード時に復元されます。`make.ks` に `[ss_init]` → `[ss_restore]`
  を置くと、ロード後に再構築されます（正確なセーブ frame ではなくアニメ先頭から再開します）。
- **シーン切替**: シーン遷移やレイヤークリア時は `[ss_free]` / `[ss_free_all]` を呼び、不要になった
  プレイヤーを除去してください。

## 7. 音声

SpriteStudio のサウンドイベントは TyranoScript 同梱の音声（howler）で再生されます。音声ファイルは
`data/sound/` 前提で、SS のサウンド名は `data/<dir>/<name>.<ext>` に解決されます
（`[ss_init sounddir= soundext= sevolume=]` で調整、`audio="false"` で無効化）。

## 既知の制限

ティラノビルダー `.tbp` 対応・`[cm]` / `[clearfix]` 自動フック・frame 精密復元・Tyrano 音量スライダー
連動は今後の対応予定です。進捗は
[ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md) を参照してください。

## ソースからビルドする

```sh
pnpm --filter @spritestudio/ssplayer-tyrano run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyrano run pack    # dist/pack/ssplayer-tyrano-plugin-<v>.zip
```

`pack` は `ssplayer/{init.ks, main.js, ssruntime_bg.wasm}` を zip 化します。これを GitHub Release の
アセットに添付し、利用者は `ssplayer/` を `data/others/plugin/` に展開します。

同梱のサンプルで試す場合は次のとおりです。

```sh
pnpm --filter tyrano-example run sync:plugin   # ビルド済みプラグイン + wasm をサンプルへコピー
```

::: tip TyranoScript 本体は同梱していません
サンプルがコミットしているのは *authored* なシナリオ・プラグインローダ・`.ssab` ファイルだけです。
TyranoScript 本体は開発時に各自で配置してください。
:::
