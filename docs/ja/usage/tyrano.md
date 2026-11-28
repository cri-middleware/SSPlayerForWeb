---
description: TyranoScript 向けの ssplayer-tyranoscript プラグイン。インストール、変換、最初のシーン、移動とエフェクト、セーブ / ロード、音声。
---

# TyranoScript で使う

**TyranoScript** のシナリオに `[ss_*]` タグを書くだけで、**SpriteStudio**（`.ssab`）のアニメを表示・再生できます。プログラミングは不要です。アニメはキャラクター・背景・メッセージと同じ Tyrano のレイヤーに並び、Tyrano 標準の `[anim]` / `[kanim]` でも動かせます。ティラノスタジオで作ったプロジェクトでも同じように使えます。

▶️ **[ライブデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** —
`[ss_*]` タグだけで組んだヴィジュアルノベルのシーンです。

::: tip ティラノビルダーで制作する場合
[ティラノビルダーで使う](./tyranobuilder.md) を参照してください。ランタイムは同じで、タグを書く代わりにコンポーネントパレットから配置でき、`.sspj` の変換も自動で行われます。このページのタグ一覧はそのまま有効です（各コンポーネントが書き出すのがこれらのタグです）。
:::

## 動作環境

| | |
| --- | --- |
| TyranoScript | **V6** の **Ver603b**（サンプルが取得する `master` と同じ版）と **Ver602c**（TyranoStudio 6.03 が新規プロジェクトに使う版）で動作確認。自動セーブ復元のみ **V515 以降**が必要 |
| 描画 | **WebGL1** 必須（WebGL2 があれば自動で昇格） |
| SpriteStudio | **SpriteStudio 7.6 以上**で作成したプロジェクト |

セーブデータからの復元は TyranoScript の `load-beforemaking` / `snapsave-start` イベントを使っており、これらは **V515 で追加された**ものです。**V514 以前**ではイベント機構が無いため自動復元が働かず、`data/scenario/make.ks` に `[ss_restore]` を書く必要があります（「6. セーブ /
ロードとライフサイクル」参照）。それ以外のタグは影響を受けません。

## 1. インストール

1. [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-tyranoscript&expanded=true) から `ssplayer-tyranoscript-plugin-<version>.zip` をダウンロードします。`@spritestudio/ssplayer-tyranoscript <version>` という名前の Release を開き、**Assets** にあるファイルを取ってください（*Source code* のアーカイブではありません）。解凍すると `ssplayer/` フォルダが入っています（`init.ks`＝ローダ、`main.js`＝プラグイン本体、
   `ssruntime_bg.wasm`＝ランタイム、`readme.txt`＝バージョンと簡単な使い方）。
2. その `ssplayer/` フォルダを Tyrano プロジェクトの `data/others/plugin/` にコピーします。
3. シナリオから `[plugin name="ssplayer"]` で読み込みます。

```
data/others/plugin/ssplayer/
├── init.ks
├── main.js
├── ssruntime_bg.wasm
└── readme.txt
```

**置き場所とフォルダ名は固定です。** `[plugin name="x"]` は TyranoScript で `[call storage="../others/plugin/x/init.ks"]` の省略形なので、プラグインはちょうど `data/others/plugin/ssplayer/` に置く必要があります。名前を変えたり別の場所へ移したりすると、`[plugin name="ssplayer"]` は何も見つけられません。`init.ks` の中のパスも、この場所を前提に書かれています。

## 2. アニメーションの変換（.sspj → .ssab）

`.sspj` は編集用の SpriteStudio プロジェクト、`.ssab` はプラグインが実際に再生するコンパクトなランタイムファイルです。[アセットの準備](./assets.md) のツールで変換し（[ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/) ならブラウザーだけで済み、何もインストールしません）、できたものをプロジェクトごとのフォルダのまま `data/others/ssdata/` に置きます。ssconverter-web の ZIP はプロジェクト名のフォルダを含んでいるので、`data/others/ssdata/` に展開するだけです。

```
data/others/ssdata/
└── Ringo/
    ├── Ringo.ssab
    └── Ringo.png
```

`.ssab` の名前は、アニメーションファイル（`.ssae`）の名前です。`[ss_new]` の `storage=` は `data/` からのパスで、この例なら `storage="others/ssdata/Ringo/Ringo.ssab"` です。

::: tip 手元に `.sspj` がまだ無いときは
[SpriteStudio 公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)、エフェクトを含むものなら [パーティクル](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) が手頃です。ダウンロードしたプロジェクトも、上と同じ手順で変換できます。
:::

## 3. クイックスタート

ループするキャラを 1 体表示する最小のシナリオです。プラグインの読み込みは、ゲーム冒頭で 1 回だけです:

```
; first.ks
[plugin name="ssplayer"]
```

キャラの表示は、出したい場面で行います:

```
; scene1.ks
[ss_new name="chr" storage="others/ssdata/Ringo/Ringo.ssab" layer="0" x="640" y="480" loop="true"]
[ss_play name="chr"]
```

- `[plugin]` はプラグインの読み込みとランタイムの起動をまとめて行います。`first.ks` に書くのはこの 1 行だけで、準備はこれで終わりです（`[ss_init]` も `make.ks` への追記も不要です）。
- `[ss_new]` は名前付きプレイヤーを生成し、`.ssab` をロードしてレイヤーに置き、再生します。
- `[ss_play]` は既存プレイヤーで再生／アニメ切替を行います。

1 つの `.ssab` には複数のアニメ（待機・笑顔・ジャンプ …）を入れられます。`anime=` で名前を指定して選び、空にすると先頭のアニメになります:

```
[ss_play name="chr" anime="smile"]                ; アニメ切替（同じ .ssab、再ロードなし）
[ss_play name="chr" anime="jump" loop="false"]    ; 1 回再生して…
[ss_wait name="chr"]                              ; …終わるまでシナリオを止め…
[ss_play name="chr" anime="wait" loop="true"]     ; …待機ループへ戻す
```

シナリオを止めずに同じことをするには `next=` を使います（[アニメの連鎖](./tyrano-tags.md#chaining-animations) を参照）。動く最小プロジェクトは `examples/tyranoscript-example` にあります。コメント付きの [`first.ks`](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/examples/tyranoscript-example/data/scenario/first.ks) で、登場、`[anim]` によるフェード、複数レイヤー、セーブ / ロードを順に試せます。

## 4. 提供タグ {#_4-tags}

各 `[ss_*]` タグの属性と動作は [TyranoScript のタグ](./tyrano-tags.md) にあります（先読み、連鎖、クロスフェードとトラック、速度と区間、シグナル、トークアニメ、パーツ上書き）。

## 5. 移動・エフェクトは `[anim]` / `[kanim]` で

各 SS プレイヤーはレイヤー内の実要素で、プレイヤー名が識別子として付与されています。そのため他のキャラと同じように、Tyrano 標準の `[anim]` / `[kanim]` でそのまま動かせます。要素は**位置を決める箱**で、描画自体はレイヤー共有の canvas が受け持ち、毎フレーム要素に追従します（[リソースとライフサイクル](../customize/resources.md) 参照）:

```
[ss_new name="ringo" storage="others/ssdata/Ringo/Ringo.ssab" layer="0" x="640" y="480"]
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

拡縮には **`[ss_pos]`**（瞬間）または **`[ss_move]`**（補間）を使ってください。こちらはアニメ自体を、そのアンカーを軸に拡縮します。
:::

**使い分け:**

- **フェード（opacity）／スライド・シェイク／キーフレーム**は `[anim]` / `[kanim]`。
- **正確な位置やスケール**が要るときは `[ss_pos]`（瞬間）/ `[ss_move]`（補間）。
  `[anim]` の `left`/`top` は初期位置からの**相対**移動である点にも注意してください。

## 6. セーブ / ロードとライフサイクル

- **通常のテキスト待ち（`[l]` / `[p]`）中も再生は継続します** — これが期待挙動です。メニューやセーブ画面で止めたい場合は `[ss_pause_all]` / `[ss_resume_all]` を使います。画面外・タブ非表示では自動的に一時停止します。
- **セーブ / ロード**: プレイヤーはロード時に自動で復元されます（`make.ks` への追記は不要です）。セーブした時点のフレームから、表示状態・重なり順・予約済みの `next=`・`[ss_chara]` の紐づけ・速度・方向・区間・トラックもそのままで再開します。
- **シーン切替**: レイヤーをクリアまたは置き換えると（`[freeimage]`、`[trans layer=]` など、原因を問わず）そのレイヤー上のプレイヤーは自動的に解放されます。`[ss_free]` / `[ss_free_all]` は、レイヤーに触れずに個別に解放したい場合に使います。
- **スキップ**: `data/system/Config.tjs` の `skipEffectIgnore = true`（既定）のままスキップしている間は、`[chara_show]` と同じく SS の演出も短縮されます。`[ss_show]` / `[ss_hide]` / `[ss_fadein]` / `[ss_fadeout]` / `[ss_move]` / `[ss_track_fade]` の `time=` と、`[ss_play]` / `[ss_show]` / `[ss_track]` / `[ss_chara]` の `transition=` はエンジンのスキップ時の長さになり、`[ss_wait]` は待ちません。アニメ自体は再生を続けます。`[ss_wait_signal]` は、続く処理がシグナルで分岐しうるため、スキップ中も待ちます。

## 7. 音声

SpriteStudio のサウンドイベントは TyranoScript 同梱の音声（howler）で、ゲームの SE 音量で再生されます。コンフィグ画面のスライダー（`[seopt]`）は、再生中の音にも反映されます。音声ファイルは `data/sound/` 前提で、SS のサウンド名はほかのファイル指定と同じ方法で `data/<dir>/<name>.<ext>` に解決されます（`[ss_init sounddir= soundext= sevolume=]` で調整、`audio="false"` で無効化）。

音はキーに指定された回数だけ鳴って止まります。SpriteStudio の音声に無限ループはありません。アニメの停止・一時停止・切り替えでは、鳴っている音は止めません。プレイヤーが鳴らした音は `[ss_stop_audio]` ですぐ止まり、`[ss_free]` でもプレイヤーの解放と一緒に止まります。どちらもほかの音には触れません。`[stopse]` はこれらの音には効きません。

## うまくいかないとき {#troubleshooting}

- **何も表示されない / エラーが出る**: `[plugin name="ssplayer"]` が `[ss_new]` より前に実行されているか確認してください。ランタイムを起動するのはこの行です（`call [ss_init] before creating players` のようなメッセージは、まだ起動していないことを示します）。
- **`.ssab` が読み込めない**: `storage=` は `data/` からの相対パスです（例: `others/ssdata/Ringo/Ringo.ssab`）。テクスチャの PNG は `.ssab` と同じフォルダに置いてください。
- **WASM が初期化されない**: `ssruntime_bg.wasm` が `data/others/plugin/ssplayer/` の `main.js` の隣にあるか確認してください。`init.ks` はそこから読み込みます。
- **`[anim]` でほとんど見えなくなる**: `opacity` は **0〜255** で、0〜1 ではありません。
- **アニメ名が通らない**: 名前は大文字と小文字を区別します。SpriteStudio のアニメ一覧と照らし合わせてください。`anime=` を空にすると先頭のアニメになります。
- **セーブをロードするとキャラが消える**: TyranoScript V514 以前には自動復元に使うイベント機構がありません。`make.ks` に `[ss_restore]` を書いてください。

## 既知の制限

未対応の範囲は [制約と適用範囲](../limitations.md#tyranoscript-tyranobuilder) を参照してください。

