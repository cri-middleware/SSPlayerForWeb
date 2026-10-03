# tyranoscript-example — ssplayer-tyranoscript 手書きシナリオ最小確認

`@spritestudio/ssplayer-tyranoscript` の `[ss_*]` カスタムタグを、実際の **TyranoScript**
プロジェクト上で表示・再生する最小サンプルです。

> **TyranoScript 本体はこのリポジトリに含まれません。**
> ライセンス上、本体の再配布は控えています（フリー・商用可のエンジンですが、プラグインとして自作物を配る方針）。本体は**開発時に各自で配置**します。このサンプルがコミットしているのは *authored* な部分だけです:
> `data/scenario/first.ks` / `data/others/plugin/ssplayer/init.ks` /
> `data/others/ssdata/*.ssab`。

## このサンプルに含まれるもの

```
examples/tyranoscript-example/
  data/
    scenario/first.ks                     # [plugin]/[ss_new]/[ss_play] を使うシナリオ
    others/
      plugin/ssplayer/init.ks             # [loadjs] でプラグイン main.js を読む
      plugin/ssplayer/main.js             # ← 生成物 (sync:plugin, .gitignore)
      plugin/ssplayer/ssruntime_bg.wasm   # ← 生成物 (sync:plugin, .gitignore)
      ssdata/Ringo_embedded.ssab          # 埋め込み ssab (テクスチャ同梱＝パス解決不要)
      ssdata/Basic_embedded.ssab
  scripts/sync-plugin.mjs                 # ビルド成果物を plugin/ へコピー
  scripts/serve.mjs                       # 依存ゼロの静的サーバ (wasm MIME 対応)
```

## セットアップと実行

### 1. TyranoScript 本体を取得する（dev-time、1 回だけ）

公式リポジトリ [ShikemokuMK/tyranoscript](https://github.com/ShikemokuMK/tyranoscript)
（**ブラウザ対応版**）を自動取得します。取得先の ref は `TYRANO_VERSION.txt`
（既定 `master`、タグ例 `v514` も可）。なお上流はタグ運用を停止しており、最新タグ `v514` は master より大幅に古いため、既定の `master` を推奨します。

```bash
pnpm --filter tyranoscript-example run fetch:engine
# 任意: ref 指定 →  pnpm --filter tyranoscript-example run fetch:engine v514
```

これで `index.html` / `tyrano/` / `data/system/` を配置し（すべて .gitignore 済み）、
`Config.tjs` に **`configSave = webstorage`** と一意の **`projectID`** を自動設定します（下記トラブルシュート参照）。本サンプルの `data/scenario/first.ks` ・
`others/plugin/ssplayer` ・ `others/ssdata` は保持されます。

> **なぜ手動コピーでなく取得か**: TyranoScript の**デスクトップ（nw.js）書き出し**は
> `configSave = file`（`require('fs')` 依存）で動くため、**ブラウザで開くと起動時にクラッシュ**します（`init_game` が `_system_config_bgm_volume` を null から読む）。公式リポジトリはブラウザ版で、本スクリプトが `webstorage` を強制するので確実です。

> 必要ツール: `curl` と `tar`（macOS/Linux・Windows 10+ に同梱）。手動配置したい場合は上記 3 つを `examples/tyranoscript-example/` 直下に置き、Config.tjs に
> `configSave = webstorage;` と一意の `projectID` を設定してください。

配置後のイメージ（`index.html` / `tyrano/` / `data/system/` は .gitignore 済み）:

```
examples/tyranoscript-example/
  index.html        ← fetch:engine が取得（コミットしない）
  tyrano/           ← 本体エンジン（コミットしない）
  TYRANO_VERSION.txt        ← 取得 ref のピン（コミット）
  data/
    system/ …       ← 取得＋自動パッチ（コミットしない）
    scenario/first.ks, make.ks  ← 本サンプル
    others/plugin/ssplayer/…    ← init.ks は本サンプル / main.js・wasm は生成物
    others/ssdata/Ringo/…       ← 生成アセット（deploy-examples、コミットしない）
```

> 画面解像度は TyranoScript 既定の **1280×720** を想定しています（`first.ks` の `x=640 y=480` はこの論理座標）。`data/system/Config.tjs` の
> `scWidth` / `scHeight` を変えた場合は座標も合わせてください。

### 2. プラグインと SS アセットを用意する

```bash
# 1) パッケージをビルド（dist/browser/main.js を生成）
pnpm --filter @spritestudio/ssplayer-tyranoscript run build

# 2) 生成物（main.js + wasm）を data/others/plugin/ssplayer/ へ同期
#    ★ パッケージを編集したら毎回これを回すのが基本ループ
pnpm --filter tyranoscript-example run sync:plugin

# 3) SS アセット（reference Ringo.ssab + Ringo.png）を data/others/ssdata/Ringo/ へ
#    ※ リポジトリ直下の deploy-examples が SS-SDK/tests を変換し、各 example へ配布する
#      （tyrano の ssdata へのコピーも含む。アセット配布は deploy-examples に一本化）
pnpm deploy-examples
```

### 3. 起動して確認する

```bash
pnpm --filter tyranoscript-example run dev
# → http://localhost:5847/ を開く（他 tyrano プロジェクトと origin を分離するため独自ポート）
```

`[ss_new]` で Ringo アニメがレイヤー 0 に表示され、ループ再生されれば成功です。**見た目の正解合わせ**は SpriteStudio エディタ／`examples/webgl-example` と並べて突き合わせてください（webgl 版と同一レンダラなので一致するはず）。

## 開発イテレーション（まとめ）

```
packages/ssplayer-tyranoscript/src/* を編集
  → pnpm --filter @spritestudio/ssplayer-tyranoscript run build
  → pnpm --filter tyranoscript-example run sync:plugin
  → dev サーバをリロード（サーバ再起動は不要。ブラウザ強制リロードでキャッシュ回避）
```

ロジックの速い内側ループは、実エンジン不要の vitest モックで回せます:

```bash
pnpm --filter @spritestudio/ssplayer-tyranoscript run test
```

## トラブルシューティング

### 起動時 `Cannot read properties of null (reading '_system_config_bgm_volume')`

TyranoScript 本体の `init_game` が、localStorage の `<projectID>_sf`（システム変数）を
`JSON.parse` した結果が `null`（文字列 `"null"` が保存されている）だと落ちます。
`projectID` を **未指定のままにすると既定値 `tyranoproject` に集約**され、同一ドメイン（`localhost`）上の別の TyranoScript プロジェクトと localStorage が衝突してこのゴミが混入します。

**対策**（このサンプルは実施済み・二重に隔離）:

1. **独自ポート `5847` で配信**（`serve.mjs`）。localStorage / Service Worker は
   **origin（scheme+host+port）単位**なので、共通ポート（3000/8000）上の別 tyrano
   プロジェクトの残骸から完全に隔離される。
2. `data/system/Config.tjs` に**一意の `projectID`** を設定（`ssplayer_tyrano_example`）。

```tjs
projectID = ssplayer_tyrano_example;
```

> それでも直らない場合（過去に同一 origin で起動して localStorage が汚れている等）は、**シークレット/プライベートウィンドウで開く**のが確実（localStorage・SW・キャッシュ・拡張が全てクリーン）。または DevTools ▸ Application ▸ **Clear site data** → リロード。
>
> なお `polyfills.js` / `vendor-3rdparty.js` の `Failed to fetch` は**ブラウザ拡張**が出しているもので本サンプルとは無関係（シークレットウィンドウでは消えます）。
>
> `Config.tjs` はエンジン付属＝git 管理外。本体を各自配置したら**必ず一意の
> `projectID` を設定**してください。

## 使用しているタグ

| タグ | 役割 |
| --- | --- |
| `[plugin name="ssplayer"]` | プラグイン読み込み + ランタイム起動（シナリオに書くのはこの 1 行だけ） |
| `[ss_init audio= sounddir= soundext= sevolume=]` | 音声設定（ランタイムは `[plugin]` が起動済み） |
| `[ss_new name= storage= layer= page= x= y= scale= loop= anime=]` | プレイヤー生成 → ssab ロード → レイヤーへ要素（`<div>`）追加 → 再生 |
| `[ss_play name= anime= loop= start=]` | 再生 / アニメ切替 |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` `name=` | 個別の停止 / 一時停止 / 再開 |
| `[ss_stop_audio name=]` | そのプレイヤーが鳴らした音をすぐ止める |
| `[ss_wait name=]` | アニメ終了（ループ時は1周）まで待つ |
| `[ss_pos name= x= y= scale=]` / `[ss_move name= x= y= scale= time=]` | 内部 transform で瞬間/補間移動（アンカー基準・絶対） |
| `[ss_free name=]` / `[ss_free_all]` | 解放（`destroy()` + 要素除去） |
| `[ss_pause_all]` / `[ss_resume_all]` | 全体一時停止 / 再開（メニュー等） |
| `[ss_restore]` | セーブから再構築（**通常は不要** — ロード時に自動復元されます） |

### セーブ / ロード復元

`[ss_new]` 等は各プレイヤーの復元情報を `stat.f.__ssplayers`（セーブ対象）へ随時ミラーします。ロード時はエンジンの `load-beforemaking` イベント（セーブ変数が戻り、シナリオが再開する直前＝TyranoScript が **`data/scenario/make.ks`** を call するのと同じ隙間）でプラグインが自動的に再構築します。**`make.ks` への記述は不要**です。

動作確認: 起動 → Ringo 表示中にメニューからセーブ → タイトルへ戻る → ロード。
Ringo が復元されれば成功です（frame ではなくアニメ先頭から再生を復元）。

> ⚠️ **表示テキスト内に `[ss_xxx]` のような角括弧のタグ記法を書かないこと**。
> TyranoScript はテキスト内の `[...]` もタグとして実行してしまいます（`ss_play` のように角括弧なしで書く）。

### 移動・エフェクトは標準タグで

キャラクターの要素（`<div>`）にはプレイヤー名が CSS クラスとして付くので、**フェードや単純移動は
TyranoScript 標準の `[anim]` / `[kanim]` がそのまま使えます**（本サンプルは
`[anim ... opacity=]` でフェードを実演）。**アンカー基準・絶対座標**の移動/スケールは内部 `setTransform` を叩く **`[ss_pos]`（瞬間）/ `[ss_move]`（補間）**を使います（本サンプルで実演）。詳細はパッケージ README を参照。

### 音声

SS の音声イベントは TyranoScript 同梱の howler で再生されます。音声ファイルは
`data/sound/` に置き、SS のサウンド名 → `data/sound/<name>.ogg` に解決されます（`[ss_init sounddir= soundext= sevolume=]` で調整、`audio="false"` で無効化）。本サンプルの Ringo には音声が無いため鳴りません。

ティラノビルダー `.tbp` には [ssplayer-tyranobuilder](../../packages/ssplayer-tyranobuilder/README.ja.md) で対応しています。
