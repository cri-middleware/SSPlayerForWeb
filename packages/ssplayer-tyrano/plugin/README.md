# ssplayer プラグイン配布テンプレート

手書きシナリオ（TyranoScript）向けプラグインの配布テンプレートです。

## 構成（配布 zip 展開後）

```
data/others/plugin/ssplayer/
  init.ks              # [loadjs] で main.js を読む（本ファイル群に同梱）
  main.js              # ← ビルド成果物（自己登録 IIFE）
  ssruntime_bg.wasm    # ← WASM ランタイム
```

`main.js` / `ssruntime_bg.wasm` はビルド生成物なのでこのフォルダにはコミットされて
いません。配布用 zip は次で生成します（`dist/pack/ssplayer-tyrano-plugin-<ver>.zip`）:

```bash
pnpm --filter @spritestudio/ssplayer-tyrano run build   # main.js を生成
pnpm --filter @spritestudio/ssplayer-tyrano run pack    # 配布 zip を組み立て
```

## 導入（手書きシナリオ）

1. 配布 zip を展開し、`ssplayer/` を `data/others/plugin/` に置く。
2. SS アセット（reference `.ssab` + テクスチャ）を `data/others/ssdata/` に置く。
3. `first.ks` で読み込み → 各シーンで `[ss_init]`/`[ss_new]`/… を使う:

```
[plugin name="ssplayer"]
[ss_init wasm="others/plugin/ssplayer/ssruntime_bg.wasm"]
[ss_new name="chr" storage="others/ssdata/Chara.ssab" layer="0" x="640" y="480"]
```

ロード時の復元には `data/scenario/make.ks` に `[ss_init]`→`[ss_restore]` を記述します
（詳細はパッケージ README / `examples/tyrano-example` を参照）。

ティラノビルダー向けの `.tbp` 配布は PT4 で対応予定です。
