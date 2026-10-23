# ssplayer プラグイン配布テンプレート

手書きシナリオ（TyranoScript）向けプラグインの配布テンプレートです。

## 構成（配布 zip 展開後）

```
data/others/plugin/ssplayer/
  init.ks              # [loadjs] で main.js を読む（本ファイル群に同梱）
  main.js              # ← ビルド成果物（自己登録 IIFE）
  ssruntime_bg.wasm    # ← WASM ランタイム
  readme.txt           # 利用者向け readme（本ファイル群に同梱、pack 時に版を埋める）
```

`readme.txt` は利用者の手元に残る唯一の説明書で、TyranoScript のプラグイン作法と
[ティラノプラグインライブラリ](https://plugin.tyrano.jp/) の掲載を想定した項目立て（タイトル / 作成時バージョン / 概略 / 使い方 / 作成者）にしてあります。`{{VERSION}}`
は `pack` が package.json の版に置換するので、テンプレート側に版を直書きしないでください。

`main.js` / `ssruntime_bg.wasm` はビルド生成物なのでこのフォルダにはコミットされていません。配布用 zip は次で生成します（`dist/pack/ssplayer-tyranoscript-plugin-<ver>.zip`）:

```bash
pnpm --filter @spritestudio/ssplayer-tyranoscript run build   # main.js を生成
pnpm --filter @spritestudio/ssplayer-tyranoscript run pack    # 配布 zip を組み立て
```

## 導入（手書きシナリオ）

1. 配布 zip を展開し、`ssplayer/` を `data/others/plugin/` に置く。
2. 変換したアニメーションを、プロジェクトごとのフォルダのまま `data/others/ssdata/` に置く（`data/others/ssdata/Ringo/Ringo.ssab` + テクスチャ）。
3. `first.ks` で 1 回読み込む → 各シーンで `[ss_new]`/`[ss_play]`/… を使う:

```
; first.ks
[plugin name="ssplayer"]

; scene1.ks
[ss_new name="chr" storage="others/ssdata/Ringo/Ringo.ssab" layer="0" x="640" y="480"]
```

`[plugin]` が展開する `init.ks` が `[ss_init wasm=...]` まで済ませるので、シナリオ側で
`[ss_init]` を書く必要はありません（音声設定を変えたいときだけ明示的に呼びます）。ロード時の復元も `load-beforemaking` イベントで自動的に行うため、`make.ks` への
`[ss_restore]` の追記も不要です。イベント機構の無い TyranoScript V514 以前でのみ、
`data/scenario/make.ks` に `[ss_restore]` を書いてください（詳細はパッケージ README / `examples/tyranoscript-example` を参照）。

## ティラノビルダー（TyranoBuilder）を使う場合

この zip は **TyranoScript 用**です。ティラノビルダーには別配布の `.tbp`
（[`@spritestudio/ssplayer-tyranobuilder`](../../ssplayer-tyranobuilder/README.ja.md)）があり、そちらは init.ks / main.js / ssruntime_bg.wasm — つまりこの zip の中身をそのまま — 内包した上でエディタ側（コンポーネントと自動変換）を追加したものです。

**どちらか一方だけを入れてください。** 展開先はどちらも `data/others/plugin/ssplayer/` で、重ねて入れるとエディタ側とランタイム側でバージョンがずれます。
