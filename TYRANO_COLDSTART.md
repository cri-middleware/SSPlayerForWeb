# ssplayer-tyrano コールドスタート仕様（TyranoScript + ティラノビルダー）

> **前提**: レンダラは **`@spritestudio/ssplayer-webgl`（`SSCanvasPlayer`）を使う**。
> WebGL1/2・シェーダ移植・ブレンド・`ssplayer-core` API などの描画側の一切は
> **描画側は [`ssplayer-webgl`](./packages/ssplayer-webgl/README.md)（残タスクは [ROADMAP.md](./packages/ssplayer-webgl/ROADMAP.md)）が正典**。本書はそれを重複させず、
> **TyranoScript / ティラノビルダー固有のグルー層だけ**を扱う。
> まず SPEC を読み、次に本書を読めば `ssplayer-tyrano` に着手できる。

作成日: 2026-07-01 / 対象リポジトリ: `SSPlayerForWeb`（pnpm monorepo）

---

## 0. 位置づけと設計判断（Decisions）

```
ssplayer-core   (WASM wrapper, GeometryBuilder)              ← 既存
      ▲
ssplayer-webgl  (SSCanvasPlayer / WebGL1+2 / 依存ゼロ)        ← 先行実装。SPEC が正典
      ▲   canvas 1 枚を描く。RAF 内蔵 or 手動駆動。core を re-export
      │
ssplayer-tyrano ← 本書の対象（薄いアダプタ、GPU 処理は持たない）
  · [ss_*] KAG カスタムタグ / レイヤー div へ <canvas> 挿入
  · save/load 復元・pause 連動・音声
  · 配布: ①通常 TyranoScript プラグイン ②ティラノビルダー .tbp（GUI）
```

| 論点 | 決定 | 理由 |
| --- | --- | --- |
| レンダラ | **`ssplayer-webgl` の `SSCanvasPlayer` を使う** | GPU/WebGL の難所は webgl 側に隔離済み。tyrano はグルーに徹する |
| PixiJS | **使わない** | TyranoScript は Pixi を同梱しない（コアに無い）。canvas を自前で挿す |
| WebGL バージョン | webgl 側の **WebGL1 必須 + WebGL2 自動昇格**に乗る | 旧端末・モバイル webview・ビルダーのネイティブ書き出しまで広くカバー |
| **TyranoScript と ティラノビルダーの関係** | **ランタイムは同一（ビルダーは TyranoScript を同梱する GUI エディタ）** | → **単一の `main.js`（master_tag 登録）が両方で動く**。ビルダー対応は「GUI メタデータ（.tbp）を足すだけ」 |
| 配布形態 | **① 通常プラグイン（手書きシナリオ向け）② `.tbp`（ビルダーの GUI ノーコード向け）を両方出す** | ①が動けば②はその薄いラッパ。§4 |

---

## 1. `ssplayer-webgl` から使う面（consumed surface）

詳細な型は **SPEC §5.1**。tyrano アダプタが触るのは実質これだけ:

```ts
import { SSCanvasPlayer } from '@spritestudio/ssplayer-webgl';

SSCanvasPlayer.initialize(wasm)                  // = initializeWasm。URL でも ArrayBuffer でも可
new SSCanvasPlayer(canvas, options)
  .load(ssabUrl, assetBaseUrl) / .setAnimation(name)
  .play() / .pause() / .resume() / .stop()
  .startTicker() / .stopTicker()                 // 内蔵 RAF。手動なら update(dt)+draw()
  .setTransform({x,y,scaleX,scaleY,rotation,anchorX,anchorY}) / .resize(cssW,cssH,dpr)
  .onUserData/onSignal/onAudio/onAnimationEnd/onAnimationLoop(cb) => unsubscribe
  .set audioManager(v) / .destroy()
  .frame (get/set) / .isPlaying / .set speedScale(v)
```

- **wasm パス**は Tyrano の data パス基準で解決して `initialize` に渡す（`[ss_init wasm=]`, §3.2）。
- ゼロコピー view / メモリ安全 / `GeometryBuilder` の話は **すべて webgl 側で完結**。tyrano から意識するのは
  「シーン遷移で `destroy()` を明示的に呼ぶ」ことだけ（§3.4）。

---

## 2. TyranoScript の事実（Ver6 前提。ビルダーも同一ランタイム）

- **純 HTML5 / jQuery(3.6) / DOM+CSS エンジン**。描画はレイヤー `div` の重ね合わせで、**シーングラフも
  バッチレンダラも無い**。同梱物は jQuery / anime.js / **howler.js**（音声）/ Three.js ほか。
  **PixiJS はコアに無い** → canvas を自前で挿す。
- **レイヤー**: クラス名が `<番号>_<fore|back>`（例 `.0_fore`, `.1_fore`, `.1_back`）、背景は `base`。
  jQuery で `$(".1_fore")` のように取得して要素を append できる。
- **プラグイン**:
  - `data/others/plugin/<name>/` に `init.ks`（`[macro]` 定義等）と `main.js`。
  - `init.ks` は `[loadjs storage="plugin/<name>/main.js"]`（必要なら `type="module"`）→ `[return]`。
  - 読み込みは手書きシナリオなら `first.ks` の `[plugin name="<name>"]`。**ビルダーでは §4.2 の作法**が要る。
- **カスタムタグ登録（JS）** — これが `ss_*` タグの実体:
  ```js
  TYRANO.kag.ftag.master_tag["ss_new"] = {
    vital: ["name", "storage"],                    // 必須属性（無いとエラー）
    pm: { layer: "0", x: 0, y: 0, loop: "true" },  // 省略時デフォルト
    start: function (pm) {
      // ... 処理 ...
      TYRANO.kag.ftag.nextOrder();                 // ★ 必須。呼ばないとシナリオが止まる
    }
  };
  // JS から既存タグを呼ぶ: TYRANO.kag.ftag.startTag("playse", { storage: "se.ogg" });
  ```
- **グローバル状態**: `TYRANO.kag`（`tyrano / kag / config / parser / ftag / layer / menu` を内包）。
  - `TYRANO.kag.stat.f` … ゲーム変数（**セーブ対象**）／ `variable.sf` … システム変数（横断・非セーブ）／ `variable.tf` … 一時変数。
  - `TYRANO.kag.config.scWidth / scHeight` … ゲーム画面解像度（canvas サイズ算出に使用）。
- **ライセンス**: フリー・商用可。**本体の再配布は控え**、プラグインとして自作物を配る。

---

## 3. `ssplayer-tyrano` 仕様（薄いアダプタ）

### 3.1 提供する KAG カスタムタグ（案）

`main.js` 読み込み時に `TYRANO.kag.ftag.master_tag[...]` へ自己登録する。

| タグ | 役割 | 主な属性 |
| --- | --- | --- |
| `[ss_init]` | 一度だけ WASM 初期化 + アセット基底パス設定 | `wasm=`, `base=` |
| `[ss_new]` | プレイヤー生成 → ssab ロード → アニメ設定 → 対象レイヤーへ canvas 挿入 → レジストリ登録 | `name=`(必須) `storage=`(必須) `anime=` `layer=` `x=` `y=` `scale=` `loop=` |
| `[ss_play]` | 再生 / アニメ切替 | `name=` `anime=` `loop=` `start=` |
| `[ss_stop]` `[ss_pause]` `[ss_resume]` | 再生制御 | `name=` |
| `[ss_pos]` / `[ss_move]` | 配置（`setTransform`）。移動は anime.js で補間可 | `name=` `x=` `y=` `scale=` `time=` |
| `[ss_wait]` | アニメ終了までシナリオを待つ（下記 nextOrder 遅延パターン） | `name=` |
| `[ss_free]` | canvas 除去 + `SSCanvasPlayer.destroy()` + レジストリ削除 | `name=` |

- **プレイヤーレジストリ**: `name -> SSCanvasPlayer` の Map をモジュールスコープで保持（`[chara]` 管理と同じ発想）。
- **`[ss_wait]` の待ち合わせ**: `start` 内で `nextOrder()` を呼ばず、
  `player.onAnimationEnd(() => TYRANO.kag.ftag.nextOrder())` を登録して return（非同期タグの定石）。

### 3.2 レイヤーへの canvas 挿入 と 座標マッピング

- 対象レイヤー要素を jQuery で取得: `$(".<layer>_fore")`（背景なら `.base` / `back`）。
- `<canvas>` を `position:absolute; left:0; top:0;` で重ね、サイズは `config.scWidth × scHeight`
  （実解像度は `devicePixelRatio` を掛け、CSS で論理サイズ。DPR 上限は `SSCanvasPlayer.resize` に委譲）。
- **座標系**: Tyrano の配置は**左上原点ピクセル**、SS の原点は**中心**。`[ss_new x= y=]` を
  「アニメ原点をレイヤー上のどこに置くか」と解釈し `SSCanvasPlayer.setTransform`（+ `anchor`）にマップ。
  y 向きは webgl 側の `setCoordinateSystem(YDown)` に揃える（詳細は SPEC）。
- **z 順**: 同一レイヤー内の重なりは Tyrano の作法（レイヤー番号）に委ね、**canvas 1 枚 = 1 プレイヤー**を基本。
- **wasm パス**: `[ss_init wasm=...]` の値を Tyrano の data パス基準で解決して `SSCanvasPlayer.initialize` に渡す。

### 3.3 ライフサイクル連携（VN で最重要）

1. **描画ループ**: `SSCanvasPlayer` の内蔵 RAF を使う。
   - `document.visibilitychange`（非表示）や Tyrano の停止状態で `pause`。
   - **テキスト待ち（`[l]`/`[p]`）中もアニメは回し続ける**のが期待挙動（メモリ: independent-during-pause）。
     メニュー / セーブ画面 / コンフィグでは止める。
2. **セーブ / ロード**（★ SS 状態は DOM に無いので明示保存が要る）:
   - セーブ時、各プレイヤーの `{ name, storage, anime, frame, layer, transform, playing, loop }` を
     **`TYRANO.kag.stat.f` の名前空間キー**（例 `f.__ssplayers`）に書き出す。
   - ロード/復元時、そのデータから `[ss_new]` 相当を再構築し canvas を張り直して `frame` をシーク。
   - Tyrano の save/load・`[cm]`/`[clearfix]`（レイヤークリア）へのフックは要調査（§6）。
3. **解放**: シーン遷移でレイヤーがクリアされる時 `destroy()` を必ず呼ぶ（`FinalizationRegistry` 任せにしない）。

### 3.4 音声

- **`TyranoAudioManager implements IAudioManager`** を実装し `player.audioManager` に差す。SS の音声イベントを
  Tyrano の音声系（`startTag("playse", {...})`）または同梱 **howler.js** に流す。
- SS 側は `SSRuntimeManager.extractSounds()` で一覧、`onAudio` で発火が取れる（webgl 経由で再 export）。

### 3.5 作成ファイル（目安）

```
packages/ssplayer-tyrano/
  package.json  tsdown.config.ts  README.md
  src/
    index.ts                 // registerSSTags() エントリ + 型
    registerTags.ts          // master_tag への [ss_*] 登録
    PlayerRegistry.ts        // name -> SSCanvasPlayer
    LayerCanvas.ts           // レイヤー div への canvas 挿入 / サイズ / 座標
    SaveLoadBridge.ts        // stat.f への直列化・復元
    TyranoAudioManager.ts    // IAudioManager 実装
    tyranoTypes.d.ts         // TYRANO / kag / ftag などの最小型
  plugin/                    // ①通常プラグイン配布テンプレ（init.ks 等）
  builder/                   // ②ビルダー .tbp テンプレ（<name>.builder.js 等, §4.2）
examples/tyrano-example/     // 手書きシナリオの最小確認プロジェクト
```

### package.json（ssplayer-pixi 規約に合わせる）

```jsonc
{
  "name": "@spritestudio/ssplayer-tyrano",
  "version": "1.0.0",
  "description": "TyranoScript / TyranoBuilder plugin bindings for SpriteStudio-SDK player",
  "type": "module", "main": "index.js", "types": "dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "dependencies": {
    "@spritestudio/ssplayer-core": "workspace:*",
    "@spritestudio/ssplayer-webgl": "workspace:*"
  },
  "scripts": { "build": "tsdown", "clean": "rimraf dist" },
  "devDependencies": { "typescript": "^6.0.3" },
  "license": "BSD-3-Clause"
}
```

---

## 4. 配布形態 — 2 系統（手書きプラグイン と ティラノビルダー）

### 4.1 ① 通常 TyranoScript プラグイン（手書きシナリオ / コード派）

```
data/others/plugin/ssplayer/
  init.ks        // [loadjs storage="plugin/ssplayer/main.js"] → [return]
  main.js        // ← ssplayer-tyrano ビルド成果物（master_tag に [ss_*] を自己登録）
  ssruntime_bg.wasm
data/others/ssdata/<project>.ssab, textures...
```

- 手書きシナリオは `first.ks` で `[plugin name="ssplayer"]` → 各シーンで `[ss_init]`/`[ss_new]`/…。
- **配布バンドル形式の要検討**: tsdown 既定は ESM。`[loadjs ... type="module"]` で ESM も読めるが、
  確実性重視なら **ブラウザ global 自己登録バンドル（IIFE/UMD）を追加ターゲットで出し**、`main.js` に置く。
  `main.js` は読み込み時に `master_tag[...]` へ登録すること（どちらの形式でも）。

### 4.2 ② ティラノビルダー対応（`.tbp` / GUI ノーコード）★本改訂の追加検討

**核心**: ティラノビルダーのランタイムは TyranoScript そのもの。GUI はタイムライン操作を
**`[ss_new storage=... x=...]` のようなタグ文字列として `.ks` に吐くだけ**。
→ **`main.js` さえ読み込まれていれば master_tag[ss_*] が実行時に解決する**。
つまり ①のランタイム資産をそのまま使い、**GUI メタデータ（`.builder.js`）を足すのが .tbp 対応**。

#### 4.2.1 プラグインを読み込ませる導線（ビルダー固有の落とし穴）

- ビルダーは**再生ボタン押下時に `first.ks` を自動再生成**する → **`first.ks` に書くと消える**。
  `[loadjs]`（プラグイン読み込み）は **`data/scenario/system/plugin.ks`** に、**`[return]` より前**に記述する。
- プラグインによっては **`make.ks`** にも記述が要る（同じく `[return]` より前）。
- ビルダー V182 以降は **Project ▸ プラグイン管理 ▸ プラグインの追加**で `.tbp` を GUI 導入できる。

#### 4.2.2 `.tbp` の作り方（公式手順）

`.tbp` = 「①のプラグインフォルダ ＋ `<name>.builder.js`」を **zip 圧縮して拡張子を `.tbp` に変えたもの**。

```
ssplayer/                         ← このフォルダを zip → 拡張子 .tbp に変更
  init.ks                         // マクロ定義（下記の橋渡し。§4.2.4）
  ssplayer.builder.js             // ★ビルダー GUI 定義（cmp / param）
  main.js  ssruntime_bg.wasm      // ①と同じランタイム資産
```

`<name>.builder.js` は **`cmp["<タグ名>"]` 連想配列**で GUI コンポーネントを定義する（公式テンプレ
`plugin_template.builder.js` を土台に）:

```js
// ssplayer.builder.js（抜粋・設計案）
cmp["ss_new"] = {
  name: TB.$.s("SSアニメ配置"),        // タイムライン/コンポーネント一覧の表示名
  component_type: "Image",             // Image | Simple | Sound | Text | Movie
  line_preview: true,                  // タイムライン上のプレビュー可否
  param: {
    name:    { type: "Text",       vital: true },
    storage: { type: "ImageSelect", vital: true },  // ← ssab のファイル選択 UI は要調査（§4.2.5）
    anime:   { type: "Text" },
    layer:   { type: "Num", min: 0, max: 20, step: 1, def: 0 },
    x:       { type: "Num", def: 0 }, y: { type: "Num", def: 0 },
    scale:   { type: "Num", def: 1, step: 0.1 },
    loop:    { type: "Bool", def: true },
  },
};
// ss_play / ss_stop / ss_pos / ss_wait / ss_free も同様に cmp[...] を並べる
```

- `this.TB`（`builder.js` に注入されるビルダー API）でコンポーネントの見た目・挙動を制御できる。
- `param` の各型（`ImageSelect` / `Num`(spinner: min/max/step) / `Text` / `Bool` / `Select` …）と
  `vital`・デフォルトはビルダーの入力 UI に対応する。

#### 4.2.3 提案する GUI コンポーネント（cmp）一覧

§3.1 のタグにそのまま 1:1 対応させる。GUI での分かりやすさ優先で `component_type` を選ぶ。

| cmp（=タグ） | 表示名（案） | component_type | 主 param |
| --- | --- | --- | --- |
| `ss_init` | SS初期化 | Simple | wasm, base |
| `ss_new` | SSアニメ配置 | Image | name, storage(ssab), anime, layer, x, y, scale, loop |
| `ss_play` | SS再生/切替 | Simple | name, anime, loop, start |
| `ss_stop`/`ss_pause`/`ss_resume` | SS停止/一時停止/再開 | Simple | name |
| `ss_pos`/`ss_move` | SS配置/移動 | Simple | name, x, y, scale, time |
| `ss_wait` | SS終了待ち | Simple | name |
| `ss_free` | SS解放 | Simple | name |

#### 4.2.4 JS master_tag と ビルダー cmp（マクロ前提）の整合 ★要検討

ビルダーの `cmp` は本来 **`init.ks` のマクロ**（`[macro]`）を GUI 化する仕組み。一方 `ss_*` は
**JS で `master_tag` 登録した実タグ**。整合の取り方を 2 案:

- **案A（推奨・シンプル）**: `main.js` の master_tag を実体とし、`builder.js` の `cmp` は
  「GUI で属性を集めて `[ss_new ...]` を吐く」メタデータに徹する。ビルダーが cmp のタグ名に対して
  マクロ実在を要求しない前提。**この前提の成否を最初に検証**（要調査）。
- **案B（保険）**: `init.ks` に**同名の薄いマクロ**を置き、内部から JS 実装へ橋渡し
  （例: `[macro name="ss_new"] [iscript] TYRANO.kag.ftag.startTag("__ss_new_impl", mp) [endscript] [endmacro]`)。
  この場合 JS 側は `__ss_*_impl` 名で登録。ビルダーの「マクロ＝コンポーネント」規約に確実に乗る。
- 実装は**まず案A を試し、ビルダーが弾くなら案B に切替**。どちらでも `main.js` の JS 実装が唯一の実処理。

#### 4.2.5 その他の要調査（ビルダー固有）

- **ssab のファイル選択 UI**: `ImageSelect` は画像用。ssab はバイナリなので、汎用ファイル選択 param が
  あるか／無ければ **`Text` でパス手入力**にフォールバック（要調査）。テクスチャ画像はビルダーの
  素材管理に載せられる可能性あり。
- **タイムラインのプレビュー**: ビルダー内蔵エディタは独自環境で、WebGL の SS を**その場では再生できない**想定。
  `component_type: "Image"`＋代表フレームの静的サムネで見せ、**実再生はゲーム実行時**とする（要確認）。
- **書き出し（export）**: ビルダーの Web/デスクトップ（nw.js）/モバイル書き出しに wasm・ssab・テクスチャが
  同梱されパス解決されるか。WebGL は nw.js / モバイル webview でも動くが、**WebGL1 ベースライン**（webgl 側）
  がここで効く。

### 4.3 ビルダー内 `.sspj → .ssab` 変換ワークフロー（`ssconverter.wasm`）★実現性調査

**背景**: 本 monorepo には既に **`packages/ssconverter-web`**（private）があり、SpriteStudio プロジェクト
`.sspj`（+ `.ssae`/`.ssce`/画像）を、ランタイムが食う **`.ssab`** に変換する WASM を持つ。

- 実体: `wasm/ssconverter_bg.wasm`（現状 ~6.3 MB・未最適化）+ glue `ssconverter.js`。**git 管理外**、`pnpm run build:wasm` で生成。
- API: `init(url | {module_or_path: buffer})` / `convert(filesMap: Map<path,Uint8Array>, embedded, …) => { output: Map<name,Uint8Array>, assets: Map<dest,src> }` / `version()` / `ssab_schema_version()`。
- **ブラウザでも Node でも動く**（既存 UI は File System Access `showDirectoryPicker`、CLI は `fs` + `module_or_path`）。サーバ不要・純クライアント処理。

**着想**: ティラノビルダーは nw.js/Electron のデスクトップアプリ ＝ Node/Chromium が使える。よって
「**GUI で `.sspj` を取り込む → `ssconverter.wasm` で `.ssab` 化 → プロジェクトの `data/` に書き出す →
`ss_new` コンポーネントの `storage` から選ぶ**」という**作者時（author-time）ワークフロー**が理屈上は組める。
これが実現すれば「SS を書き出して D&D するだけ」でノーコード導入できる。

**実装形態の候補（推奨順）**:

| 形態 | 内容 | 実現性 / リスク |
| --- | --- | --- |
| **A. ビルダー外の変換ツール（推奨・即着手可）** | 既存 `ssconverter-web`（ブラウザ）or CLI で変換 → 出力 zip を Tyrano プロジェクトの `data/others/ssdata/` に展開 → `.tbp` の `ss_new`（§4.2）で参照 | **今日すでに動く**。ビルダー内部への組込ゼロ。手数は増えるが確実 |
| **B. ビルダー組込ワークフロー（本命の "組込"）** | `.tbp`/ビルダープラグインが、フォルダ選択 → `ssconverter.wasm` 実行 → `.ssab`+テクスチャを `data/` へ書き出し → `ss_new` の storage 候補に登録、までワンクリック | 価値大。ただし**ビルダーのプラグイン API が fs 書込 + WASM 実行 + 独自 UI アクションを許すかが要（§下記）** |
| **C. ランタイム変換（ゲーム実行時に `.sspj` を変換）** | 変換器をゲームに同梱し初回ロードで変換 | ✗ 非推奨。ランタイムに ~6 MB 上乗せ、作者時にやれば無駄。end-game が生 `.sspj` を食う要件がある時のみ |

**形態 B の成否を分ける未知数（要検証）**:

1. **builder.js / `.tbp` プラグインの実行権限**: `this.TB` ベースの GUI プラグイン層から
   `require('fs')`（プロジェクトフォルダ書込）と **WASM instantiate** ができるか。`.tbp` の公式 API は
   本来「コンポーネント/param 宣言」向けで、任意の取り込みパイプラインを走らせるホストではない可能性が高い。**ここが山**。
2. **`.sspj` は単一ファイルでなくフォルダ**（sspj+ssae+ssce+画像）。ビルダーの素材取り込み UI はファイル単位。
   ディレクトリ選択（Chromium の File System Access）or D&D フォルダで多ファイルを渡す導線が要る。
3. **WASM サイズ/最適化**: 未最適化 6.3 MB。作者時ツールとはいえ、`wasm-opt -Oz`（SPEC の SDK 側要件と同じ）で削るべき。
4. **CSP/サンドボックス**: WASM コンパイルに `wasm-unsafe-eval` 相当が要る場面（デスクトップは概ね寛容）。

**デリスク手順（B を狙うなら）**:
- ① 公式 builder.js API と既存 `.tbp`（素材インポータ系）を調べ、fs + カスタム UI アクション + WASM の可否を確定。
- ② 最小 `.tbp` で「ボタン → `fs` + `ssconverter.wasm` で固定 `.sspj` を変換 → `data/` へ書出し」を PoC。
- ③ ダメなら**形態 A（外部ツール）を正式手順**として README 化し、B は将来課題に降格。

> **結論（現時点）**: 変換器側は Node/ブラウザ両対応の綺麗な `Map→Map` API で**部品としては完全に流用可能**。
> ネックは変換ロジックではなく **ティラノビルダーのプラグイン API がファイル書込/WASM 実行を許すか**の一点。
> まず**形態 A で確実に回るワークフローを用意**し、並行して形態 B の PoC（上記①②）で組込可否を判定するのが最短。

---

## 5. 実装フェーズ（コールドスタート手順）

> **描画（webgl）側のフェーズは [ssplayer-webgl の ROADMAP.md](./packages/ssplayer-webgl/ROADMAP.md) に委譲**。以下は tyrano 固有。
> webgl の P1（静止 1 枚）が出た時点で PT0 に着手できる。

- [ ] **PT0 scaffold**: `packages/ssplayer-tyrano` 作成（package.json / tsdown / `index.ts`）。
      `ssplayer-webgl` を依存に。`pnpm -r run build` が通ること。
- [ ] **PT1 最小表示（①通常プラグイン）**: `[ss_init]`/`[ss_new]`/`[ss_play]`、`LayerCanvas` で canvas 挿入、
      `examples/tyrano-example`（手書き）で 1 体表示・再生。座標マッピング検証（§3.2）。
- [ ] **PT2 ライフサイクル**: pause 連動（visibility / メニュー）、`SaveLoadBridge` でセーブ/ロード復元、
      `[ss_free]`・レイヤークリア時の `destroy()`（§3.3）。
- [ ] **PT3 仕上げ（①）**: 音声（`TyranoAudioManager`）、`[ss_wait]`/`[ss_pos]`/`[ss_move]`、
      通常プラグイン配布テンプレ（`plugin/`）、IIFE/ESM 配布形式の確定（§4.1）。
- [ ] **PT4 ティラノビルダー対応（②）**: `ssplayer.builder.js`（`cmp`/`param`）作成、`plugin.ks` 導線（§4.2.1）、
      §4.2.4 の案A/案B 検証、`.tbp` パッケージング、**ビルダー実プロジェクトで GUI から配置・再生**を確認。
      あわせて **§4.3 形態 A**（外部変換ツール → `data/others/ssdata/` へ）を README 化し、確実な変換手順を用意。
- [ ] **PT4.5 変換組込 PoC（②の発展・任意）**: §4.3 形態 B — `builder.js` から `fs` + `ssconverter.wasm` を
      走らせ、`.sspj` 取り込み → `.ssab` 書き出し → `ss_new` storage 候補登録 までを PoC（要調査 10-12 の判定）。
- [ ] **PT5 examples/ドキュメント**: `examples/tyrano-example`（手書き）＋ ビルダー用サンプルプロジェクト、
      README / ROADMAP 追記。

---

## 6. 検証

- **見た目の正解合わせ**: `examples/pixi-example` と **SpriteStudio エディタ**を目視で突き合わせ、
  spec より**エディタ一致**を優先（メモリ: verify-rendering-against-ss-editor）。webgl 版・pixi 版・tyrano 版を
  並べて差分を見るのが最速。**パッケージ再ビルド後は dev server を再起動**（examples はビルド済みを参照）。
- **①通常プラグイン**: `tyrano-example` で `[ss_*]` の表示・再生・セーブ/ロード復元・解放を確認。
- **②ビルダー**: 実際のティラノビルダーに `.tbp` を導入し、GUI からコンポーネントを配置 → 再生 →
  書き出し（Web/デスクトップ）まで通す。§4.2.1 の `plugin.ks` 作法と §4.2.4 の橋渡しが要検証点。

---

## 7. 既知の制約 / 未対応 と 要調査

### スコープ外・将来（webgl と共通。詳細は SPEC §15）

- **Text(5) / Nines(9-slice)(6)**: Rust(WASM) 側対応前提で未実装（メモリ: pixi-feature-gap-backlog）。
- **label-seek / texture-swap / part override**: `ROADMAP.md` / SDK API 待ち。
- **アニメブレンド/クロスフェード**: WASM に C-API はあるが JS 未配線（メモリ: animation-blending-deferred）。
- **イベント抽出/ディスパッチ**はレンダラ層で実装（メモリ: events-handled-in-pixi-not-core）。
  → tyrano でも `onUserData`/`onSignal`/`onAudio` は webgl 層のものを使う。

### Tyrano / ビルダー固有の要調査

1. `[loadjs]` を **module / global どちらで配布**するか（§4.1）。
2. SS アセット（ssab/テクスチャ/wasm）の**配置場所とパス解決**（手書き ／ ビルダー書き出しの双方）。
3. セーブ/ロードの**フック点**（Tyrano の save/load・`[cm]`/`[clearfix]` をどうラップするか, §3.3）。
4. Tyrano 製 CSS トランジション（フェード等）と canvas の重なり挙動。
5. `devicePixelRatio` / Retina のスケーリング（`SSCanvasPlayer.resize` の dpr 上限と整合）。
6. **【ビルダー】** `cmp` のタグ名に**マクロ実在が必須か**（§4.2.4 案A の成否）。
7. **【ビルダー】** ssab 用の**ファイル選択 param** の有無（§4.2.5）。
8. **【ビルダー】** タイムラインの**プレビュー表現**と実再生タイミング（§4.2.5）。
9. **【ビルダー】** 同梱 TyranoScript の**バージョン**（`.tbp` / builder.js の API 仕様が依存。要確認）。
10. **【ビルダー / 変換】** `builder.js` プラグイン層から **`fs` 書込 + `ssconverter.wasm` instantiate** が可能か
    （§4.3 形態 B の山。まず PoC で判定）。
11. **【変換】** `.sspj`（フォルダ）をビルダー UI に渡す導線（ディレクトリ選択 / D&D フォルダ）と、
    変換出力 `.ssab`+テクスチャの `data/others/ssdata/` への書き出し先・命名（§4.3）。
12. **【変換】** `ssconverter.wasm` の**サイズ最適化**（未最適化 6.3 MB → `wasm-opt -Oz`）と `ssab_schema_version` の
    ランタイム（webgl/core が読む ssab）との整合。

---

## 8. 参照（source of truth）

| 目的 | パス / URL |
| --- | --- |
| **描画側の一切（正典）** | [`packages/ssplayer-webgl/`](./packages/ssplayer-webgl/README.md)（残タスク: [ROADMAP.md](./packages/ssplayer-webgl/ROADMAP.md)） |
| 全体アーキ図 / ロードマップ | `README.md` / `ROADMAP.md` |
| 使う面（SSCanvasPlayer） | `packages/ssplayer-webgl/src/SSCanvasPlayer.ts` |
| リソース/音声 IF | `packages/ssplayer-core/src/IResourceManager.ts`, `IAudioManager.ts` |
| 音声マネージャの手本 | `packages/ssplayer-pixi/src/SSWebAudioManager.ts` |
| **`.sspj → .ssab` 変換器（§4.3）** | `packages/ssconverter-web/`（`src/main.ts` ブラウザ / `scripts/cli.js` Node / `wasm/ssconverter.js`） |

### TyranoScript / ティラノビルダー 外部リファレンス

- TyranoScript 本体: <https://github.com/ShikemokuMK/tyranoscript>（Ver6, フリー・商用可）
- プラグイン自作（スクリプト）: <https://tyrano.jp/usage/advance/plugin>
- カスタムタグの作り方: <https://kido0617.github.io/tyrano/2018-08-02-make-plugin/>
- プラグイン開発の実践知見（VOICEVOX）: <https://blog.ouvill.net/blog/2024-08-19-create_tyranoscript_plugin/>
- レイヤー解説 / タグリファレンス V6: <https://tyrano.jp/usage/tech/layer> / <https://tyrano.jp/tag/>
- **【ビルダー】ビルダー用プラグイン作成（.tbp / builder.js / cmp / param）**: <https://tyrano.jp/usage/advance/tbp>
- **【ビルダー】公式 テクニック（プラグイン）**: <https://b.tyrano.jp/tech/page/plugin> / チュートリアル: <https://b.tyrano.jp/tutorial/>
- **【ビルダー】ビルダーで TyranoScript プラグインを使う（plugin.ks 作法）**: <https://note.com/skt_order/n/n0af8dc13bc2a>
- **【ビルダー】公式 英語プラグインチュートリアル**: <https://tyranobuilder.com/tutorials/more/create-your-own-plugins>
- ティラノプラグインライブラリ: <https://plugin.tyrano.jp/>
</content>
