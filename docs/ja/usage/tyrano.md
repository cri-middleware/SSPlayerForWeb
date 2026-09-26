# TyranoScript で使う

::: warning ベータ版
`@spritestudio/ssplayer-tyranoscript` は **ベータ版**（`7.0.0-beta.1`）です。シナリオ作成用のタグは揃っていますが、`7.0.0` までに名前や挙動が変わる可能性はあります。描画は
[`ssplayer-webgl`](/ja/usage/webgl) の `SSPlayer` を土台にしています。

**リリースはまだ 1 つもありません。** 正式リリース後はプラグイン ZIP が **GitHub Releases** で配布される予定ですが、現時点で入手する唯一の方法は [ソースからのビルド](#building-from-source)です。
:::

**TyranoScript** のシナリオに `[ss_*]` タグを書くだけで、**SpriteStudio**
（`.ssab`）のアニメを表示・再生できます。プログラミングは不要です。各アニメはレイヤーに載る実際の `<canvas>` なので、キャラクター・背景・メッセージと同じレイヤースタックに並びます。

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../../examples/tyranoscript/" target="_blank" rel="noreferrer">ライブデモ</a>** —
`[ss_*]` タグだけで組んだヴィジュアルノベルのシーンです（最初のリリース公開後に有効化されます 🚧）。

::: tip ティラノビルダーで制作する場合
[ティラノビルダーで使う](/ja/usage/tyranobuilder) を参照してください。ランタイムは同じで、タグを書く代わりにコンポーネントパレットから配置でき、`.sspj` の変換も自動で行われます。このページのタグ一覧はそのまま有効です（各コンポーネントが書き出すのがこれらのタグです）。
:::

## しくみ

プラグインは `[ss_*]` の KAG カスタムタグ群を Tyrano の `master_tag` に登録します。自己登録する単一の `main.js`（IIFE バンドル）が、TyranoScript / TyranoBuilder / TyranoStudio のいずれでも動作します。

- `[ss_new]` ごとに名前付きプレイヤーを生成し、`.ssab` をロードして対象レイヤーへ `<canvas>` をマウントし、[`ssplayer-webgl`](/ja/usage/webgl) の `SSPlayer`（WebGL1 必須 + WebGL2 自動昇格 / 依存ゼロ）で駆動します。
- canvas には **プレイヤー名**が識別子として付与されるため、他のキャラと同じように Tyrano 標準の
  `[anim]` / `[kanim]` でそのまま動かせます。
- 外部に残るのは **WASM バイナリ**（`ssruntime_bg.wasm`）だけで、レンダラと core の JS は `main.js`
  に内包されています。

## 動作環境

| | |
| --- | --- |
| TyranoScript | **V520** で動作確認（サンプルが取得する `master` の版）。自動セーブ復元のみ **V515 以降**が必要 |
| 描画 | **WebGL1** 必須（WebGL2 があれば自動で昇格） |

セーブデータからの復元は TyranoScript の `load-beforemaking` / `snapsave-start` イベントを使っており、これらは **V515 で追加された**ものです。**V514 以前**ではイベント機構が無いため自動復元が働かず、`data/scenario/make.ks` に `[ss_restore]` を書く必要があります（「6. セーブ /
ロードとライフサイクル」参照）。それ以外のタグは影響を受けません。

## 1. インストール

::: tip どちらをダウンロードすればよい？
ここで説明するプラグイン ZIP は **TyranoScript 用**です。**ティラノビルダー**で制作する場合は代わりに `ssplayer.tbp` を入れてください。`.tbp` はこの ZIP の 3 ファイルをそのまま内包した上で、エディタ側（コンポーネントと自動変換）を追加したものなので、ダウンロードはそれ 1 つで足ります。**どちらか一方だけを入れてください。** 展開先はどちらも同じ `data/others/plugin/ssplayer/` で、重ねて入れるとエディタ側とランタイム側でバージョンがずれます。
:::

**まだリリースが公開されていない**ため、当面は [ソースからビルド](#building-from-source)してください。最初のリリース以降は、**GitHub Releases** からプラグイン ZIP をダウンロードして次のように導入します。

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

`.sspj` は編集用の SpriteStudio プロジェクト、`.ssab` はプラグインが実際に再生するコンパクトなランタイムファイルです。変換方法は [アセットの準備](/ja/usage/assets) を参照してください。出力は `data/others/ssdata/` 以下に置き、`[ss_new storage=...]` から指します。

## 3. クイックスタート

ループするキャラを 1 体表示する最小シナリオ:

プラグインの読み込みは、ゲーム冒頭で 1 回だけです:

```
; first.ks
[plugin name="ssplayer"]
```

キャラの表示は、出したい場面で行います:

```
; scene1.ks
[ss_new name="chr" storage="others/ssdata/Chara.ssab" layer="0" x="640" y="480" loop="true"]
[ss_play name="chr"]
```

- `[plugin]` はプラグインの読み込みとランタイムの起動をまとめて行います。`first.ks` に書くのはこの 1 行だけで、準備はこれで終わりです（`[ss_init]` も `make.ks` への追記も不要です）。
- `[ss_new]` は名前付きプレイヤーを生成し、`.ssab` をロードしてレイヤーに置き、再生します。
- `[ss_play]` は既存プレイヤーで再生／アニメ切替を行います。

動く最小プロジェクトは `examples/tyranoscript-example` にあります。

## 4. 提供タグ {#_4-tags}

| タグ | 役割 | 主な属性 |
| --- | --- | --- |
| `[ss_init]` | **音声設定**。ランタイムは `[plugin name="ssplayer"]` が起動済みなので、このタグは音声設定を変える用途だけです | `audio=`, `sounddir=`, `soundext=`, `sevolume=`（`wasm=` はプラグインが指定） |
| `[ss_new]` | プレイヤー生成 → ssab ロード → レイヤーへ挿入 → 再生 | `name=`(必須) `storage=`(必須) `anime=` `layer=` `page=` `x=` `y=` `scale=` `loop=` `visible=` `zindex=` |
| `[ss_play]` | 再生 / アニメ切替（続けて再生するアニメも指定可） | `name=`(必須) `anime=` `loop=` `start=` `next=` `nextloop=` `atframe=` |
| `[ss_show]` | プレイヤーを表示（位置指定・登場アニメ・フェード） | `name=`(必須) `x=` `y=` `scale=` `zindex=` `anime=` `loop=` `next=` `time=` `wait=` |
| `[ss_hide]` | 破棄せずに非表示にする（ロード状態は維持） | `name=`(必須) `time=` `wait=` |
| `[ss_fadein]` / `[ss_fadeout]` | 全プレイヤーを一括フェード（シーン切替向け） | `time=` `wait=` |
| `[ss_chara]` | 話者と連動し、発話中はトークアニメを再生 | `name=`(必須) `jname=` `talk=` `idle=` |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` | 個別プレイヤーの停止 / 一時停止 / 再開 | `name=`(必須) |
| `[ss_wait]` | アニメ終了（ループ時は 1 周）までシナリオを待つ | `name=`(必須) |
| `[ss_wait_signal]` | アニメがシグナル（`command=` 指定時はそのコマンド）を出すまでシナリオを待つ | `name=`(必須) `command=` `var=` |
| `[ss_pos]` | 瞬間移動 / スケール / 重なり順（アンカー基準・絶対） | `name=`(必須) `x=` `y=` `scale=` `zindex=` |
| `[ss_move]` | 補間移動 / スケール（easeOut・既定は非ブロッキング） | `name=`(必須) `x=` `y=` `scale=` `time=` `wait=` |
| `[ss_part_color]` | パーツの色をアニメより優先して上書き（通常パーツのみ） | `name=`(必須) `part=`(必須) `color=`(必須) `blend=` `priority=` |
| `[ss_part_visible]` | パーツを強制的に非表示 / 解除 | `name=`(必須) `part=`(必須) `hide=` `cascade=` |
| `[ss_part_cell]` | パーツが描くセルを差し替え（通常 / マスクパーツのみ） | `name=`(必須) `part=`(必須) `cellmap=`(必須) `cell=`(必須) `priority=` |
| `[ss_part_clear]` | パーツ上書きを解除（`part=` 省略で全パーツ） | `name=`(必須) `part=` |
| `[ss_free]` | 1 プレイヤーを解放 | `name=`(必須) |
| `[ss_free_all]` | 全プレイヤー解放（シーン遷移 / レイヤークリア時） | — |
| `[ss_pause_all]` / `[ss_resume_all]` | 全プレイヤー一時停止 / 再開（メニュー等で使用） | — |
| `[ss_restore]` | セーブから全プレイヤーを再構築。**通常は不要**（ロード時に自動復元されます）。ロード完了まで待たせたい場合や、イベント機構の無い古いエンジンでのみ使います | — |

座標は他の画面要素と同じく、Tyrano の通常の左上原点ピクセル（`config.scWidth × scHeight`）を使います。`loop` は `true`→無限 / `false`→1 回 / 数値→回数です。

タグは失敗してもシナリオを止めません。エンジンのデバッグ設定（`data/system/Config.tjs` の `;debugMenu.visible = true`）が有効なら、原因はエンジン自身のエラーダイアログに、シナリオのファイル名と行番号付きで表示されます。たとえば `[ss_play] next="Wiat" is not in others/ssdata/Chara.ssab.` のように表示されます。リリース時はこの設定をオフにしてください。オフのときは、原因はブラウザのコンソールにだけ出力されます。

### 先読み・表示・非表示

`[ss_new visible="false"]` は**表示せずにロードだけ**行います。サイズの大きい `.ssab` を必要な場面より前に準備しておき、その瞬間に即座に出せます:

```
[ss_new name="akane" storage="others/ssdata/Akane.ssab" visible="false"]
[ss_show name="akane" x="640" y="480" time="800"]   ; ロード済みなので待たされない
[ss_hide name="akane" time="500"]                   ; 画面から消す（ロードは維持）
```

`[ss_hide]` はアニメをロードしたまま（＝ `[ss_show]` が即時）画面外にし、GPU 消費も止めます。実際に解放するのは `[ss_free]` です。`[ss_fadeout]` / `[ss_fadein]` はシーン切替向けに全プレイヤーを一括でフェードし、フェードイン時には**元々表示されていたものだけ**が戻ります。

### アニメの連鎖

`next=` は連鎖をプレイヤー側に予約するので、「登場 → 待機ループ」に `[ss_wait]` は不要で、シナリオも止まりません:

```
[ss_play name="akane" anime="appear" next="wait"]                ; 1回再生 → 待機ループ
[ss_play name="akane" anime="attack" next="wait" atframe="20"]   ; 20フレーム目で切替
```

`next=` を指定して `loop=` を省略すると 1 回再生になります（無限ループには終わりが来ないため）。
`nextloop=` は連鎖先のループ回数です。予約された連鎖は次の `[ss_play]` で取り消されます。

### シグナルを待つ

シグナルは、アニメーターが SpriteStudio 上でフレームに置く目印で、コマンド ID と任意のパラメータを持ちます。`[ss_wait_signal]` はアニメがシグナルを出すまでシナリオを止めるので、「攻撃が当たった瞬間」をシナリオに書けます:

```
[ss_play name="akane" anime="attack" loop="false"]
[ss_wait_signal name="akane" command="hit"]   ; 攻撃が当たるまで待つ
[quake count="3" time="300" hmax="20"]
```

`command=` は SpriteStudio で設定したコマンド ID です。省略するとどのシグナルでも進みます。`var="f.sig"` を指定すると待ちを終えたシグナルのコマンド ID が入るので、`[if]` でどれだったかを分岐できます。`next=` で予約した続きのアニメも待つ対象に含まれます。シグナルが出ないままアニメが終わるか 1 周ループした場合は待ちを終え、ほかのタグの失敗と同じように原因を表示します。多くはコマンド ID の書き間違いです。シグナルのパラメータは受け渡しません。

### 話者と連動したトークアニメ

`[ss_chara]` は紐づけたキャラの台詞が表示されている間だけトークアニメを再生し、終わると待機へ戻します。Live2D プラグインの `jname` と同じ発想を、口のパラメータではなく
SpriteStudio のアニメ単位で行うものです:

```
[ss_chara name="akane_ss" jname="あかね" talk="talk" idle="wait"]

#あかね
はじめまして。[p]
```

`jname=` はシナリオの `#名前` でも Tyrano のキャラ ID でも一致します。`idle=` を空にすると
`[ss_play]` で最後に指定したアニメへ戻ります。トーク／待機の切替はセーブに含まれないため、台詞の途中でセーブしても通常のアニメで復元されます。`talk=""` で解除できます。

### パーツ上書きについて

`[ss_part_*]` はアニメのキーフレームより **優先** して、特定パーツの見た目を差し替えます（SS6 の PartsColorChange / CellChangeParts / HideSet に相当）。

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
- **アニメを切り替えると `permanent` 以外の上書きは解除されます。** セーブ内容も同時に整理されるため、ロード時に復活することはありません。表示（`[ss_part_visible]`）に優先度はなく、アニメ切替で必ず解除されます

## 5. 移動・エフェクトは `[anim]` / `[kanim]` で

各 SS プレイヤーはレイヤー内の実要素で、プレイヤー名が識別子として付与されています。そのため他のキャラと同じように、Tyrano 標準の `[anim]` / `[kanim]` でそのまま動かせます。要素は**位置を決める箱**で、描画自体はレイヤー共有の canvas が受け持ち、毎フレーム要素に追従します（[リソースとライフサイクル](/ja/customize/resources) 参照）:

```
[ss_new name="ringo" storage="others/ssdata/ringo.ssab" layer="0" x="640" y="480"]
[anim name="ringo" time="800" opacity="0"]        ; フェードアウト（消える）
[anim name="ringo" time="800" opacity="255"]      ; フェードイン（現れる）
[anim name="ringo" time="600" left="120" top="0"] ; スライド
[kanim name="ringo" time="500" ...]               ; キーフレームも可
```

::: warning `[anim]` の opacity は 0〜255
TyranoScript の `[anim]` の **`opacity` は 0〜255**（0〜1 ではない）です。`opacity="1"` はほぼ透明（約 0.4%）になります。**完全表示は `255`** です。
:::

::: warning `scale` / `rotate` はアニメに効きません
`[anim]` / `[kanim]` の `scale` / `rotate` はキャラの**要素**に CSS 変形を掛けます。一方、レイヤー上の SS キャラはそれぞれの要素の中ではなく、**レイヤー共有の canvas 1 枚**に描かれます。そのため CSS 変形は「キャラが座る位置と大きさ」を動かすだけで、描かれている絵は拡縮も回転もしません。

拡縮には **`[ss_pos]`**（瞬間）または **`[ss_move]`**（補間）を使ってください。こちらはアニメ自体を、そのアンカーを軸に拡縮します。`[anim]` の `scale`/`rotate` は元々アンカーではなく画面中心が軸だったため、この用途には正確ではありませんでした。
:::

**使い分け:**

- **フェード（opacity）／スライド・シェイク／キーフレーム**は `[anim]` / `[kanim]`。
- **正確な位置やスケール**が要るときは `[ss_pos]`（瞬間）/ `[ss_move]`（補間）。
  `[anim]` の `left`/`top` は初期位置からの**相対**移動である点にも注意してください。

## 6. セーブ / ロードとライフサイクル

- **通常のテキスト待ち（`[l]` / `[p]`）中も再生は継続します** — これが期待挙動です。メニューやセーブ画面で止めたい場合は `[ss_pause_all]` / `[ss_resume_all]` を使います。画面外・タブ非表示では自動的に一時停止します。
- **セーブ / ロード**: プレイヤーはロード時に自動で復元されます（`make.ks` への追記は不要です）。セーブした時点のフレームから再開します。
- **シーン切替**: レイヤーをクリアすると（`[freeimage]` など、原因を問わず）そのレイヤー上のプレイヤーは自動的に解放されます。`[ss_free]` / `[ss_free_all]` は、レイヤーに触れずに個別に解放したい場合に使います。
- **スキップ**: `data/system/Config.tjs` の `skipEffectIgnore = true`（既定）のままスキップしている間は、`[chara_show]` と同じく SS の演出も短縮されます。`[ss_show]` / `[ss_hide]` / `[ss_fadein]` / `[ss_fadeout]` / `[ss_move]` の `time=` はエンジンのスキップ時の長さになり、`[ss_wait]` は待ちません。アニメ自体は再生を続けます。`[ss_wait_signal]` は、続く処理がシグナルで分岐しうるため、スキップ中も待ちます。

## 7. 音声

SpriteStudio のサウンドイベントは TyranoScript 同梱の音声（howler）で再生されます。音声ファイルは
`data/sound/` 前提で、SS のサウンド名は `data/<dir>/<name>.<ext>` に解決されます（`[ss_init sounddir= soundext= sevolume=]` で調整、`audio="false"` で無効化）。

## 既知の制限

`[cm]` / `[clearfix]` 自動フック・frame 精密復元・Tyrano 音量スライダー連動は今後の対応予定です。進捗は [ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md) を参照してください。

ティラノビルダーについては専用プラグイン `@spritestudio/ssplayer-tyranobuilder` があり、`.tbp` として配布され、コンポーネントパレットへの追加に加えて `.sspj` の変換もエディタ内で行います（[ティラノビルダーで使う](/ja/usage/tyranobuilder) を参照）。どちらの統合でも未対応の範囲は
[制約と適用範囲](/ja/limitations#tyranoscript-tyranobuilder) を参照してください。

## ソースからビルドする {#building-from-source}

```sh
pnpm --filter @spritestudio/ssplayer-tyranoscript run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyranoscript run pack    # dist/pack/ssplayer-tyranoscript-plugin-<v>.zip
```

`pack` は `ssplayer/{init.ks, main.js, ssruntime_bg.wasm}` を zip 化します。これを GitHub Release のアセットに添付し、利用者は `ssplayer/` を `data/others/plugin/` に展開します。

同梱のサンプルで試す場合は次のとおりです。

```sh
pnpm --filter tyranoscript-example run sync:plugin   # ビルド済みプラグイン + wasm をサンプルへコピー
```

::: tip TyranoScript 本体は同梱していません
サンプルがコミットしているのは *authored* なシナリオ・プラグインローダ・`.ssab` ファイルだけです。
TyranoScript 本体は開発時に各自で配置してください。
:::
