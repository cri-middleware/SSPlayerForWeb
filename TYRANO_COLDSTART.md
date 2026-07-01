# ssplayer-webgl / ssplayer-tyrano コールドスタート仕様

> このドキュメント単体で、前提知識ゼロのセッション（人間 / AI エージェント）が
> **`@spritestudio/ssplayer-webgl`** と **`@spritestudio/ssplayer-tyrano`** の実装に
> 着手できることを目的とする。既存の `ssplayer-core` / `ssplayer-pixi` の調査結果を
> すべて内包しているので、まずこのファイルを読めばよい。

作成日: 2026-07-01 / 対象リポジトリ: `SSPlayerForWeb`（pnpm monorepo）

---

## 0. 確定した設計判断（Decisions）

| 論点 | 決定 | 理由 |
| --- | --- | --- |
| ベースにするもの | **`ssplayer-core` のみ**。`ssplayer-pixi` は再利用しない | TyranoScript は PixiJS を同梱しない（後述）。pixi は Pixi v8 / WebGL2・WebGPU / WGSL 前提で流用不可 |
| パッケージ分割 | **`ssplayer-webgl` を先に作る** → `ssplayer-tyrano` はその薄いアダプタ | GPU/WebGL1 の難所を 1 パッケージに隔離。`pixi ← core` と同じ構図。plain-canvas 用途でも再利用可能 |
| WebGL バージョン | **WebGL1 を必須ベースライン + WebGL2 があれば自動昇格** | TyranoScript は旧端末含む広い互換性が売り。GLSL ES 1.00 を基準に、`webgl2` が取れたら VAO / uint index を使う |
| レンダリング方式 | **Direct（バッチ描画）**。`DirectInternalPlayer` + `GeometryBuilder` を使う | canvas 1 枚に直接描く。Tyrano には流用できるシーングラフが無い（DOM のみ） |

```
ssplayer-core   (WASM wrapper, GeometryBuilder)   ← 既存
      ▲   positions / uv / color / custom0 / indices + DrawBatch メタ
      │
ssplayer-webgl  ← 新規（本ドキュメントの主対象・先行実装）
  · WebGL1 context（+WebGL2 昇格） / GLSL ES 1.00 シェーダ
  · SSShaderLib / PartsColorShader を WGSL・GLSL3 → GLSL ES 1.00 に移植
  · BlendType → gl.blendFunc(Separate) / Equation, stencil マスク
  · SSCanvasPlayer(canvas) を公開（RAF 内蔵、外部駆動も可）
      ▲
      │
ssplayer-tyrano ← 新規（薄いアダプタ）
  · [ss_new] / [ss_play] / [ss_stop] などの KAG カスタムタグ
  · layer(div) へ <canvas> 挿入
  · save/load 復元, pause 連動, RAF hook, 音声
```

---

## 1. リポジトリ / ビルドの前提

- **モノレポ**: pnpm workspaces。`packages/*`, `examples/*`, `docs` が対象（`pnpm-workspace.yaml`）。
- **ビルドツール**: 全パッケージ **`tsdown`**（webpack/vite/rollup は使わない）。各パッケージに同型の `tsdown.config.ts`:
  ```ts
  export default defineConfig({
    entry: ['src/index.ts'],
    format: 'esm',
    dts: true,
    outputOptions: { entryFileNames: '[name].js', chunkFileNames: '[name].js' },
  });
  ```
- **ルート scripts**: `pnpm run build`（`pnpm -r run build`）、`pnpm run build:wasm`（`node scripts/build-wasm.js`）。
- **WASM は git 管理外**。新規 clone / Rust 変更時は `pnpm run build:wasm`（Windows は `build:wasm:win`）が必須（`CLAUDE.md`）。
- **TypeScript strict**。`any` を避ける。既存パッケージのコードスタイルに合わせる。
- **依存追加**は monorepo 文脈で（`pnpm add <pkg> --filter @spritestudio/ssplayer-webgl` 等）。

### 新規パッケージの package.json テンプレート

`ssplayer-pixi` / `ssplayer-rmmz` の規約に合わせる。

```jsonc
// packages/ssplayer-webgl/package.json
{
  "name": "@spritestudio/ssplayer-webgl",
  "version": "1.0.0",
  "description": "Zero-dependency WebGL1/WebGL2 renderer for SpriteStudio-SDK player",
  "main": "index.js",
  "types": "dist/index.d.ts",
  "type": "module",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "dependencies": { "@spritestudio/ssplayer-core": "workspace:*" },
  "scripts": { "build": "tsdown", "clean": "rimraf dist" },
  "devDependencies": { "typescript": "^6.0.3" },
  "license": "BSD-3-Clause"
}
```

```jsonc
// packages/ssplayer-tyrano/package.json
{
  "name": "@spritestudio/ssplayer-tyrano",
  "version": "1.0.0",
  "description": "TyranoScript plugin bindings for SpriteStudio-SDK player",
  "main": "index.js",
  "types": "dist/index.d.ts",
  "type": "module",
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

> **要検討（Tyrano 配布形態）**: Tyrano プラグインは `[loadjs]` で素の JS を読み込む。tsdown の
> 既定は ESM。`[loadjs ... type="module"]` で ESM も読めるが、確実性を取るなら
> **ブラウザ global (IIFE/UMD) バンドルを別ターゲットで生成**し、プラグインの `main.js`
> としてそれを置く手もある。→ §6.5 参照。

---

## 2. `ssplayer-core` が提供する API（レンダラが消費する契約）

すべて `@spritestudio/ssplayer-core` から re-export 済み。`ssplayer-webgl` の `index.ts` でも
core を re-export し、消費側の入口を一本化する（pixi と同じ規約）。

### 2.1 初期化・メモリ

```ts
initializeWasm(wasmUrl?: string | URL): Promise<InitOutput>  // 最初に一度だけ
getWasmMemory(): WebAssembly.Memory
finalizationRegistry: FinalizationRegistry<{ free: () => void }>  // WASM free の自動化
```

- **ゼロコピー**: 各アクセサは `getWasmMemory().buffer` を参照する TypedArray view を返す。
  毎フレーム新規確保しない。**WASM メモリ growth 時に view が無効化される**点に注意
  （core 側の `WasmViewCache` が再取得する。自前で view を長期保持しない）。
- **メモリ安全**: `SSRuntimeManager` / リソースハンドルは `FinalizationRegistry` により GC 時
  自動 `free()`。ただし明示破棄したい場面（Tyrano のレイヤークリア等）では自前で解放する（§6.4）。

### 2.2 プレイヤーファサード

`InternalPlayerBase`（抽象・エンジン非依存）とその実装 `DirectInternalPlayer` を使う。

```ts
class DirectInternalPlayer extends InternalPlayerBase<DirectInternalPlayer> {
  runtimeManager: SSRuntimeManager;
  geometryBuilder: GeometryBuilder;
  audioManager: IAudioManager | null;
  constructor(resourceManager?: IResourceManager);

  // ロード
  load(ssabUrl: string, assetBaseUrl?: string): Promise<void>;
  bindResource(buffer: Uint8Array): void;
  loadTextures(assetBaseUrl?: string): Promise<void>;
  setAnimation(animationName: string, assetBaseUrl?: string): Promise<void>;

  // 再生制御
  play(startFrame?: number): void;
  pause(): void; resume(): void; stop(): void;
  update(deltaMs: number): void;     // 内部フレームを進める。描画は別途こちらで行う
  seekTo(frame: number): void;

  // 状態
  get frame(): number; set frame(v: number);
  get isPlaying(): boolean; get isPausing(): boolean;
  getSpeed(): number; setSpeed(speed: number): void;
  get totalFrames(): number; get startFrame(): number; get endFrame(): number;
  get fps(): number; get loopCount(): number;

  // パーツ / 入れ子
  getPartsCount(): number;
  getPartIndexFromName(name: string): number;
  loadInstancePacks(assetBaseUrl?: string): Promise<void>;
  getInstanceChildren(): Map<number, InstanceChildState<DirectInternalPlayer>>;
  getEffectChildren(): Map<number, EffectChildState>;
}
```

### 2.3 `SSRuntimeManager`（フレームデータと幾何ソース）

描画ループで毎フレーム呼ぶ主なアクセサ:

```ts
// 変形・頂点（ゼロコピー view）
getWorldMatrices(): Float32Array   // パーツ毎 16 float（4x4）。2D 用は idx 0,1,4,5,12,13
getLocalVertices(): Float32Array   // パーツ毎 10 float（5頂点 × x,y）
getLocalUVs(): Float32Array        // パーツ毎 10 float（5頂点 × u,v。ピクセル単位、未正規化）

// スキンメッシュ
getMeshVerticesX/Y(): Float32Array; getMeshUVs(): Float32Array;
getMeshIndices(): Int32Array; getMeshVertexOffsets(): Uint32Array; getMeshIndexOffsets(): Int32Array;

// Shape（変形四角形）
getShapeVertices(): Float32Array; getShapeVertexBoxCoords(): Float32Array; getShapeVertexCounts(): Int32Array;

// マスク
getPartMaskFlags(): Uint8Array | null   // bit: visibleInsideMask=0x01, maskWrite=0x02 …

// フレームデータ本体（FlatBuffers）
getFrameData(frame: number): FrameData | null

// 座標系
setCoordinateSystem(system: WebCoordinateSystem): void   // WebGL=0(y-up) / YDown=1

// 静的イントロスペクション（SSAB を直接パース）
static extractTexturePaths(ssab): { hash, path }[];
static extractAnimationNames(ssab): string[];
static extractSounds(ssab): SoundAsset[];
```

### 2.4 `GeometryBuilder`（頂点・インデックス生成）— **移植の中核**

「WASM が出す変形データ」から「GPU に流す頂点配列」を作る、純粋な数学ロジック。
**pixi も webgl も、この出力をそのまま GPU に渡すだけ。** これを自前で書き直さないこと。

```ts
class GeometryBuilder {
  parentMatrix: Float32Array | null;   // instance 子アニメ用の親アフィン [m00,m01,m10,m11,tx,ty]
  updateWorldPositions(): void;        // 毎フレーム、幾何構築の前に一度だけ

  buildNormal(partIdx, frameData, invTexW, invTexH,
              outPositions, outUvs, outColors, outCustom0): void;
  buildShape (partIdx, frameData, numVerts, invTexW, invTexH,
              outPositions, outUvs, outColors, outCustom0, outIndices): void;
  buildMesh  (partIdx, frameData, pCount, iCount, invTexW, invTexH,
              outPositions, outUvs, outColors, outCustom0, outIndices): void;
  buildEffectCommand(partIdx, plan, particleOffset, quadCount,
              outPositions, outUvs, outColors, outIndices,
              vertexOffset?, indexOffset?, partAlpha?): void;

  static composeAffine(parent, child, out?): Float32Array;   // 2D アフィン合成
}
```

**出力配列レイアウト（頂点属性）** — これが GPU に渡す VBO の中身:

| 属性 | 要素/頂点 | 内容 |
| --- | --- | --- |
| `outPositions` (`aPosition`) | vec2 | ワールド座標 (x, y)。`invTexW/H` と親行列は適用済み |
| `outUvs` (`aUV`) | vec2 | **正規化済み** UV（0..1、`invTexW/H` 乗算済み） |
| `outColors` (`aColor`) | vec4 | RGBA 0..1（PartsColor または白×stateAlpha） |
| `outCustom0` (`aVarg`) | vec4 | **`[rate, mixF, mulF, addSubF]`** — PartsColor ブレンド制御 |

- `invTexW = 1 / textureWidth`, `invTexH = 1 / textureHeight`（texture hash からサイズを引いて渡す）。
- **Normal パーツ**: 5 頂点 `[0]=TL, [1]=TR, [2]=BL, [3]=BR, [4]=center`。
  `buildNormal` は **インデックスを出さない** ので、レンダラ側で **12 index / 4 三角形の扇**を張る:
  ```
  (0,1,4) (1,3,4) (3,2,4) (2,0,4)   // 中心頂点 4 を扇の要にする
  ```
  （出典: `packages/ssplayer-pixi/src/SSPlayer.ts` `acquireMesh`、`requiredVertices=5, requiredIndices=12`）
- **Shape**: `numVerts` 頂点 + `(numVerts-2)*3` index（トライアングルファン、builder が index を書く）。
- **Mesh**: `pCount` 頂点 + `iCount` index（builder が index を書く）。
- **Effect**: quad 群。`quadCount*4` 頂点 / `quadCount*6` index。複数コマンドを 1 バッファに詰め込み可。

### 2.5 `FrameData` / `DrawBatch`（描画ループの駆動）

```ts
class FrameData {
  drawBatchesLength(): number; drawBatches(i, out?): DrawBatch | null;
  parts(i, out?): PartState | null;
  partsColor(i, out?): PartAttributePartColor | null;
  drawOrderArray(): Uint32Array | null;
  effectDrawCommandsLength(): number; effectDrawCommands(i, out?): EffectDrawCommand | null;
}
class DrawBatch {
  startRank(): number; count(): number;
  textureHash(): number;              // → ResourceManager.getTexture(hash)
  vertexCount(): number; indexCount(): number;
  blendType(): BlendType; kind(): DrawBatchKind; flags(): number;
}
enum DrawBatchKind { Normal=0, Shape=1, Instance=2, Effect=3, Mesh=4, Text=5, Nines=6, Mask=7 }
enum BlendType { Mix=0, Mul=1, Add=2, Sub=3, Mulalpha=4, Screen=5, Exclusion=6, Invert=7,
                 Mul2=8, Div2=9, Screen2=10, Overlay2=11 }
```

**1 フレームの描画擬似コード**:

```ts
player.update(deltaMs);
const gb = player.geometryBuilder;
gb.parentMatrix = null;          // ルートアニメは null
gb.updateWorldPositions();       // ★ 幾何構築の前に必須
const fd = player.runtimeManager.getFrameData(player.frame);
for (let i = 0; i < fd.drawBatchesLength(); i++) {
  const batch = fd.drawBatches(i)!;
  const tex = resourceManager.getTexture(batch.textureHash());
  // batch.kind() に応じて gb.buildNormal / buildShape / buildMesh / buildEffectCommand
  // → VBO 更新 → gl.blendFunc(BlendType) → gl.drawElements
}
```
（`Text=5` / `Nines=6` は現状 Rust 側未対応。§8 参照）

### 2.6 リソース / 音声インターフェース

```ts
interface IResourceManager {
  loadTexture(url: string, hash: number): Promise<void>;
  getTexture(hash: number): any;   // エンジン固有のテクスチャオブジェクト
  destroy(): void;
}
interface IAudioManager {
  preload(sounds: SoundAsset[]): Promise<void>;
  release?(names: string[]): void; releaseAll?(): void; stopAll?(): void;
  pause?(): void; resume?(): void;
  playWithOffset?(name: string, loopNum: number, partIndex: number, offsetSeconds: number): void;
}
interface SoundAsset { name: string; path: string; }
```

`ssplayer-webgl` は **`SSWebGLResourceManager implements IResourceManager`**（`Image` → `WebGLTexture`）を実装する。

---

## 3. TyranoScript の事実（Ver6 前提）

- **純 HTML5 / jQuery(3.6) / DOM+CSS エンジン**。描画はレイヤー `div` の重ね合わせで、**シーングラフも
  バッチレンダラも無い**。`tyrano/libs` の同梱物は jQuery / anime.js / **howler.js**（音声）/ **Three.js** ほか。
  **PixiJS はコアに無い**（Pixi は Live2D プラグイン内にのみ存在）。→ pixi 流用は不可、canvas を自前で挿す。
- **レイヤー**: クラス名が `<番号>_<fore|back>`（例 `.0_fore`, `.1_fore`, `.1_back`）、背景は `base`。
  jQuery で `$(".1_fore")` のように取得して要素を append できる。
- **拡張モデル（プラグイン）**:
  - `data/others/plugin/<name>/` に `init.ks` と `main.js`。
  - `init.ks` は `[loadjs storage="plugin/<name>/main.js"]`（必要なら `type="module"`）→ `[return]`。
  - シナリオ側は `first.ks` などで `[plugin name="<name>"]` で読み込む。
  - **マクロ**は `[macro name=...] ... [endmacro]`。属性は `%attr`、省略値は `|`。
- **カスタムタグ登録（JS）**:
  ```js
  TYRANO.kag.ftag.master_tag["ss_new"] = {
    vital: ["name", "storage"],          // 必須属性（無いとエラー）
    pm: { layer: "0", x: 0, y: 0, loop: "true" },  // 省略時デフォルト
    start: function (pm) {
      // ... 処理 ...
      TYRANO.kag.ftag.nextOrder();        // ★ 必須。呼ばないとシナリオが止まる
    }
  };
  // JS から既存タグを呼ぶ: TYRANO.kag.ftag.startTag("playse", { storage: "se.ogg" });
  ```
- **グローバル状態**: `TYRANO.kag`（`tyrano / kag / config / parser / ftag / layer / menu` を内包）。
  - `TYRANO.kag.stat.f` … ゲーム変数（**セーブ対象**）。
  - `TYRANO.kag.variable.sf` … システム変数（横断・非セーブ）。
  - `TYRANO.kag.variable.tf` … 一時変数（実行時のみ）。
  - `TYRANO.kag.config.scWidth / scHeight` … ゲーム画面解像度（canvas サイズ算出に使用）。
- **ライセンス**: フリー・商用可。ただし **TyranoScript 本体の再配布は控える**。プラグインとして自作物を配る形にする。
- **バージョン依存**（参考）: Live2D Cubism4 は V5+、Cubism5 は V6+。SS プラグインは V5/V6 を対象に。

---

## 4. `ssplayer-webgl` 仕様（先行実装）

> **正典は [SSPLAYER_WEBGL_SPEC.md](./SSPLAYER_WEBGL_SPEC.md)**（スタンドアロン／広告用途のサイズ・
> パフォーマンス設計を含む）。以下は Tyrano 視点の要約。実装時は SPEC 側を参照すること。

### 4.1 ゴール

- **外部依存ゼロ**（core のみ）。素の `WebGLRenderingContext`（+ 取れれば `WebGL2RenderingContext`）で
  `GeometryBuilder` 出力を描く。
- **WebGL1 / GLSL ES 1.00 が必須ベースライン**、WebGL2 は自動昇格（機能検出）。
- plain-canvas アプリからも、Tyrano アダプタからも使える公開 API。

### 4.2 公開 API（設計案）

```ts
// packages/ssplayer-webgl/src/index.ts
export * from '@spritestudio/ssplayer-core';   // core を re-export（入口一本化）
export { SSCanvasPlayer, type SSCanvasPlayerOptions } from './SSCanvasPlayer.js';
export { SSWebGLRenderer } from './SSWebGLRenderer.js';
export { SSWebGLResourceManager } from './SSWebGLResourceManager.js';
```

```ts
class SSCanvasPlayer {
  static async initialize(wasmUrl?: string | URL): Promise<void>;   // = initializeWasm

  constructor(target: HTMLCanvasElement | WebGLRenderingContext | WebGL2RenderingContext,
              options?: SSCanvasPlayerOptions);

  internalPlayer: DirectInternalPlayer;

  load(ssabUrl: string, assetBaseUrl?: string): Promise<void>;
  setAnimation(name: string, assetBaseUrl?: string): Promise<void>;

  play(startFrame?: number): void; pause(): void; resume(): void; stop(): void;
  get frame(): number; set frame(v: number);
  get isPlaying(): boolean; get isPausing(): boolean;
  set speedScale(v: number);

  // 描画駆動: 内蔵 RAF で回すか、ホスト（Tyrano）から手動駆動するか選べる
  startTicker(): void; stopTicker(): void;   // 内蔵ループ
  update(deltaMs: number): void;             // 手動: 進める
  draw(): void;                              // 手動: 現フレームを描く

  // 配置（Tyrano の [ss_new x= y= scale=] からマップ）
  setTransform(t: { x?: number; y?: number; scaleX?: number; scaleY?: number;
                    rotation?: number; anchorX?: number; anchorY?: number }): void;
  resize(width: number, height: number, dpr?: number): void;

  // イベント（立ち上がりエッジ、unsubscribe を返す。pixi の SSPlayer と同型）
  onUserData(cb): () => void; onSignal(cb): () => void; onAudio(cb): () => void;
  onAnimationEnd(cb): () => void; onAnimationLoop(cb): () => void;

  set audioManager(v: IAudioManager | null);
  destroy(): void;   // GL リソース + WASM ハンドルを解放
}

interface SSCanvasPlayerOptions {
  premultipliedAlpha?: boolean;   // 既定 true（§4.5）
  stencil?: boolean;              // マスク用。既定 true
  antialias?: boolean;
  autoResizeToCanvas?: boolean;
}
```

### 4.3 レンダリングパイプライン

1. context 取得: `canvas.getContext('webgl2') ?? canvas.getContext('webgl', { premultipliedAlpha, stencil, antialias, alpha:true })`。
2. プログラム作成: **PartsColor**（Normal/Shape/Mesh 共通）、**Effect**、**MaskWrite** / **Masked** の各シェーダ。
3. 射影行列: canvas ピクセル空間 → クリップ空間の正射影を uniform で渡す。SS の原点は中心なので
   `setCoordinateSystem` と `setTransform` を合わせて配置（Tyrano のレイヤー座標=左上原点 と整合させる、§6.3）。
4. 毎フレーム: `update → updateWorldPositions → getFrameData → drawBatches ループ`（§2.5 の擬似コード）。
   バッチ毎に `build*` で VBO を更新、`blendType` を GL 状態にマップ、`drawElements`。
5. VBO は **プール再利用**（毎フレーム確保しない）。pixi の `meshPool` / `activeMeshes` と同じ発想。

### 4.4 シェーダ移植（WGSL・GLSL3 → GLSL ES 1.00）

**移植元（source of truth）** は pixi パッケージ:
- `packages/ssplayer-pixi/src/PartsColorShader.ts`（GLSL3 版と WGSL 版の両方あり）
- `packages/ssplayer-pixi/src/EffectShader.ts`
- `packages/ssplayer-pixi/src/MaskWriteShader.ts`, `MaskedPartsColorShader.ts`
- `packages/ssplayer-pixi/src/SSShaderLib.ts`（`ss-*` 組み込みシェーダ 13 種。SS 統合シェーダ用）

**GLSL ES 3.00 → GLSL ES 1.00 の機械的変換ルール**:

| GLSL3 (pixi) | GLSL ES 1.00 (webgl1) |
| --- | --- |
| `in`（vertex 入力） | `attribute` |
| `in` / `out`（varying） | `varying` |
| `out vec4 finalColor;` + `finalColor = ...` | 宣言不要、`gl_FragColor = ...` |
| `texture(tex, uv)` | `texture2D(tex, uv)` |
| （精度指定なし可） | fragment は先頭に `precision mediump float;`（可能なら `highp`、要検出） |
| `mat3 * vec3` | そのまま可（GLSL ES 1.00 も mat3 対応） |

**PartsColorShader を GLSL ES 1.00 に移植した完成形**（`aVarg = [rate, mixF, mulF, addSubF]`）:

```glsl
// vertex
attribute vec2 aPosition;
attribute vec2 aUV;
attribute vec4 aColor;
attribute vec4 aVarg;
uniform mat3 uProjection;   // canvas → clip の正射影（自前で管理）
uniform mat3 uTransform;    // 配置（setTransform）
varying vec2 vUV; varying vec4 vColor; varying vec4 vVarg;
void main() {
  vec3 p = uProjection * uTransform * vec3(aPosition, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  vUV = aUV; vColor = aColor; vVarg = aVarg;
}
```
```glsl
// fragment
precision mediump float;
varying vec2 vUV; varying vec4 vColor; varying vec4 vVarg;
uniform sampler2D uTexture;
uniform vec4 uColor;        // (tint.rgb * alpha, alpha)。階層アルファ/tint を最後に畳む
void main() {
  vec4 texColor = texture2D(uTexture, vUV);
  if (texColor.a == 0.0) { gl_FragColor = vec4(0.0); return; }

  float rate = vVarg.x, isMix = vVarg.y, isMul = vVarg.z, isAddSub = vVarg.w;
  vec3 straightTexRGB = texColor.rgb / max(texColor.a, 0.0001);   // 逆プリマルチ

  vec3 mixColor    = mix(straightTexRGB, vColor.rgb, rate);
  vec3 mulColor    = straightTexRGB * mix(vec3(1.0), vColor.rgb, rate);
  vec3 addSubColor = straightTexRGB + (vColor.rgb * rate * sign(isAddSub));

  vec3 outRgb = mixColor * isMix + mulColor * isMul + addSubColor * abs(isAddSub);
  float outA = texColor.a * vColor.a;                 // §1-4: a = p.a * partcolor.a
  gl_FragColor = vec4(outRgb * outA, outA) * uColor;  // 再プリマルチ後、階層アルファを畳む
}
```

> **重要**: `uColor` は pixi では Pixi が自動供給していた `(tint.rgb*worldAlpha, worldAlpha)`。
> webgl では **自前で「親チェーンの階層アルファ」を uniform として渡す**。二重適用に注意
> （`GeometryBuilder` のコメント 10_parts_color §1-3「stateAlpha を再乗算しない」を厳守）。

### 4.5 ブレンドモード → GL 状態マップ

SS は **全ブレンドを固定機能 GPU ブレンド**として実現する（`packages/ssplayer-pixi/src/SSBlendModes.ts`
のコメントに Unity `SS6PlayerForUnity` 由来の記述あり）。シェーダ出力は **プリマルチ済み**なので、
それ前提の factor を使う。`blendFuncSeparate(srcRGB, dstRGB, srcA, dstA)`:

| BlendType | srcRGB, dstRGB | Equation | 備考 |
| --- | --- | --- | --- |
| Mix(0) 通常 | `ONE, ONE_MINUS_SRC_ALPHA` | ADD | プリマルチ通常合成 |
| Add(2) 加算 | `ONE, ONE` | ADD | |
| Mul(1) 乗算 | `DST_COLOR, ONE_MINUS_SRC_ALPHA` | ADD | |
| Sub(3) 減算 | `ONE, ONE` | **REVERSE_SUBTRACT** | `blendEquation(FUNC_REVERSE_SUBTRACT)` |
| Screen(5) | `ONE_MINUS_DST_COLOR, ONE` | ADD | |
| Invert(7) | `ONE_MINUS_DST_COLOR, ZERO` | ADD | **SSBlendModes.ts 実測値** |
| Exclusion(6) | `ONE_MINUS_DST_COLOR, ONE_MINUS_SRC_COLOR` | ADD | **SSBlendModes.ts 実測値** |
| Mulalpha(4) / Mul2 / Div2 / Screen2 / Overlay2 | 要確認 | | SS の特殊/v2 モード。SS6PlayerForUnity `FunctionMaterialSetUpAnimation` を出典に検証 |

- alpha チャンネルは全モード `srcA=ONE, dstA=ONE_MINUS_SRC_ALPHA`（プリマルチ被覆維持、SSBlendModes 準拠）。
- **Sub のみ** `blendEquationSeparate(FUNC_REVERSE_SUBTRACT, FUNC_ADD)` が要る（他は `FUNC_ADD`）。

### 4.6 WebGL1 の制約チートシート（★必ず遵守）

1. **GLSL ES 1.00**: `attribute`/`varying`/`gl_FragColor`/`texture2D`。`in/out`/`finalColor` は不可。
   fragment は `precision` 必須。ループは**定数上限**のみ（動的長ループ不可）。
2. **インデックス型**: 既定 `UNSIGNED_SHORT`（`Uint16Array`, 頂点上限 65535/描画）。
   `OES_element_index_uint` があれば `Uint32Array` 可。`GeometryBuilder` は `Uint16Array|Uint32Array` 両対応
   なので、**拡張が無い WebGL1 では Uint16 を渡し、大バッチは分割**する。
3. **NPOT テクスチャ**: `wrap` は `CLAMP_TO_EDGE` 必須、mipmap 不可、min filter は `LINEAR`/`NEAREST`。
   SS テクスチャは NPOT があり得るので既定でこの設定にする。
4. **VAO**: WebGL1 に標準では無い。`OES_vertex_array_object` を使うか、毎描画で attrib ポインタを張り直す。
   WebGL2 なら標準 VAO。
5. **stencil**: マスク（`DrawBatchKind.Mask` / `getPartMaskFlags`）は stencil で実装。
   context 取得時に `{ stencil: true }` を指定。
6. **プリマルチアルファ**: シェーダは「サンプル値がプリマルチ済み」を前提に逆プリマルチ→再プリマルチする。
   よって **テクスチャアップロードは `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true`**（pixi 既定と一致）。
   ブレンド factor も §4.5 のプリマルチ前提と揃える。
7. **MRT なし / 単一カラーターゲット** … SS は単一で足りるので問題なし。
8. **highp 非保証**（モバイル一部）: `getShaderPrecisionFormat` で fragment highp を検出し、
   不可なら mediump にフォールバック。
9. **コンテキストロスト**: `webglcontextlost` / `webglcontextrestored` を購読し、GL リソースを再生成
   （VN は長時間起動しうるので必須）。
10. **テクスチャユニット** … 1 サンプラ/描画で十分（`MAX_TEXTURE_IMAGE_UNITS >= 8` 保証）。

### 4.7 WebGL2 自動昇格

- `getContext('webgl2')` が取れたら: **標準 VAO**、**Uint32 index（拡張不要）**、**完全 NPOT 対応**を使う。
- シェーダは GLSL ES 1.00 のまま WebGL2 でも動く（`#version 300 es` 化は必須ではない）。
  → **単一シェーダソースを維持**し、index 型と VAO の有無だけ機能検出で分岐するのが最小コスト。

### 4.8 作成ファイル（目安）

```
packages/ssplayer-webgl/
  package.json  tsdown.config.ts  README.md
  src/
    index.ts                    // core re-export + 公開クラス
    SSCanvasPlayer.ts           // 高レベルファサード（RAF/手動駆動）
    SSWebGLRenderer.ts          // context/プログラム/VBO プール/描画ループ
    SSWebGLResourceManager.ts   // Image → WebGLTexture, hash キャッシュ
    programs/
      PartsColorProgram.ts      // PartsColorShader.ts の GLSL ES 1.00 版
      EffectProgram.ts
      MaskProgram.ts            // MaskWrite + Masked（stencil）
    gl/
      GLProgram.ts  GLBuffer.ts  BlendState.ts  capabilities.ts  // webgl1/2 機能検出
```

---

## 5. `ssplayer-tyrano` 仕様（薄いアダプタ）

### 5.1 ゴール

`ssplayer-webgl` の `SSCanvasPlayer` を、**TyranoScript のタグ / レイヤー / セーブロード / ライフサイクル**に
接続する。GPU 処理は一切持たず、グルーコードに徹する。

### 5.2 提供する KAG カスタムタグ（案）

| タグ | 役割 | 主な属性 |
| --- | --- | --- |
| `[ss_init]` | 一度だけ WASM 初期化 + アセット基底パス設定 | `wasm=`, `base=` |
| `[ss_new]` | プレイヤー生成 → ssab ロード → アニメ設定 → 対象レイヤーへ canvas 挿入 → レジストリ登録 | `name=`(必須) `storage=`(必須) `anime=` `layer=` `x=` `y=` `scale=` `loop=` |
| `[ss_play]` | 再生 / アニメ切替 | `name=` `anime=` `loop=` `start=` |
| `[ss_stop]` `[ss_pause]` `[ss_resume]` | 再生制御 | `name=` |
| `[ss_pos]` / `[ss_move]` | 配置（`setTransform`）。移動は anime.js で補間しても良い | `name=` `x=` `y=` `scale=` `time=` |
| `[ss_wait]` | アニメ終了までシナリオを待つ（下記 nextOrder 遅延パターン） | `name=` |
| `[ss_free]` | canvas 除去 + GL/WASM 解放 + レジストリ削除 | `name=` |

- **プレイヤーレジストリ**: `name -> SSCanvasPlayer` の Map をモジュールスコープで保持
  （Tyrano の `[chara]` 管理と同じ発想）。
- **`[ss_wait]` の待ち合わせ**: `start` 内で `nextOrder()` を呼ばず、`player.onAnimationEnd(() => TYRANO.kag.ftag.nextOrder())`
  を登録して return する（Tyrano の非同期タグの定石。VOICEVOX プラグイン等と同様）。

### 5.3 レイヤーへの canvas 挿入 と 座標マッピング

- 対象レイヤー要素を jQuery で取得: `$(".<layer>_fore")`（背景なら `.base` / `back`）。
- `<canvas>` を作り、`position:absolute; left:0; top:0;` で重ね、サイズは
  `TYRANO.kag.config.scWidth × scHeight`（必要なら `devicePixelRatio` を掛けて実解像度、CSS で論理サイズ）。
- **座標系**: Tyrano の画像配置は**左上原点ピクセル**（`left/top`）。SS アニメの原点は**中心**。
  `[ss_new x= y=]` は「アニメ原点をレイヤー上のどこに置くか」と解釈し、`SSCanvasPlayer.setTransform` の
  `x/y`（+ `anchor`）にマップ。`SSRuntimeManager.setCoordinateSystem(YDown)` を使って y 下向きに揃える。
- **z 順**: 同一レイヤー内の重なりは Tyrano の作法（レイヤー番号）に委ね、canvas 1 枚 = 1 プレイヤーを基本とする。

### 5.4 ライフサイクル連携（VN で最重要）

1. **描画ループ**: `SSCanvasPlayer` の内蔵 RAF を使う。ただし
   - `document.visibilitychange`（非表示）や Tyrano の停止状態で `pause`。
   - **テキスト待ち（`[l]`/`[p]`）中もアニメは回し続ける**のが期待挙動
     （メモリ: independent-during-pause）。メニュー/セーブ画面/コンフィグでは止める。
2. **セーブ / ロード**（★ SS 状態は DOM に無いので明示保存が要る）:
   - セーブ時、アクティブな各プレイヤーの `{ name, storage, anime, frame, layer, transform, playing, loop }` を
     **`TYRANO.kag.stat.f` の名前空間キー**（例 `f.__ssplayers`）に書き出す。
   - ロード/復元時、そのデータから `[ss_new]` 相当を再構築して canvas を張り直し、`frame` をシークする。
   - Tyrano のセーブ/ロードや `[cm]`/`[clearfix]`（レイヤークリア）にフックする方法を要調査
     （`TYRANO.kag.ftag.master_tag` の該当タグをラップ、または save 直前の hook を張る）。
3. **解放**: シーン遷移でレイヤーがクリアされる時、対象プレイヤーの `destroy()` を必ず呼ぶ
   （`FinalizationRegistry` 任せにせず明示解放）。

### 5.5 音声

- **`TyranoAudioManager implements IAudioManager`** を実装。SS の音声イベントを
  Tyrano の音声系（`TYRANO.kag.ftag.startTag("playse", {...})`）または同梱 **howler.js** に流す。
- SS 側は `SSRuntimeManager.extractSounds()` でアセット一覧、`onAudio` イベントで発火が取れる。

### 5.6 配布形態（Tyrano プラグイン）

- Tyrano ゲーム側の構成:
  ```
  data/others/plugin/ssplayer/
    init.ks        // [loadjs storage="plugin/ssplayer/main.js"] → [return]
    main.js        // ← ssplayer-tyrano のビルド成果物（タグを master_tag に自己登録）
    ssruntime_bg.wasm
  data/others/ssdata/<project>.ssab, textures...
  ```
- **要検討**: tsdown 既定は ESM。Tyrano の `[loadjs]` で確実に読ませるため、
  **ブラウザ global 自己登録バンドル（IIFE）を追加ターゲットで出す**か、`type="module"` を使うか決める。
  `main.js` は読み込み時に `TYRANO.kag.ftag.master_tag[...]` へタグを登録すること。
- **wasm パス**: `[ss_init wasm=...]` で `initializeWasm` に渡す URL を Tyrano の data パス基準で解決。

### 5.7 作成ファイル（目安）

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
  plugin/                    // 配布用テンプレ（init.ks 等）
examples/tyrano-example/     // 動作確認用の最小 Tyrano プロジェクト
```

---

## 6. 実装フェーズ（コールドスタート手順）

- [ ] **P0 scaffold**: `packages/ssplayer-webgl` 作成（package.json / tsdown.config / index.ts で core re-export）。`pnpm i` → `pnpm run build:wasm`（未ビルドなら）→ `pnpm -r run build` が通ること。
- [ ] **P1 静止 1 枚**: WebGL1 context + PartsColor プログラム（**Normal パーツのみ**、12-index 扇）で、単純アニメの 1 フレームを描画。`examples/pixi-example` の見え方 / SS エディタと突き合わせて検証（メモリ: verify-rendering-against-ss-editor。パッケージ再ビルド後は dev server 再起動）。
- [ ] **P2 再生 + Shape/Mesh + ブレンド**: `update`/RAF ループ、`buildShape`/`buildMesh`、§4.5 のブレンド全種。
- [ ] **P3 マスク + エフェクト**: stencil マスク（MaskWrite/Masked）、`buildEffectCommand`。
- [ ] **P4 WebGL2 昇格**: VAO / uint32 index / NPOT を機能検出で。
- [ ] **P5 tyrano scaffold**: `packages/ssplayer-tyrano` + `[ss_init]`/`[ss_new]`/`[ss_play]`、canvas 挿入、最小 Tyrano example で表示。
- [ ] **P6 ライフサイクル**: pause 連動、セーブ/ロード復元、`[ss_free]`/レイヤークリア時の解放。
- [ ] **P7 仕上げ**: 音声、`[ss_wait]`/`[ss_pos]`、プラグイン配布テンプレ、README/ROADMAP 追記。

---

## 7. 検証方法

- **見た目の正解合わせ**: ユーザは `pixi-example` と **SpriteStudio エディタ**を目視で突き合わせる。
  spec より **エディタ一致**を優先（メモリ: verify-rendering-against-ss-editor）。
  同じアニメを webgl 版と pixi 版で並べて差分を見るのが最速。
- **再ビルド後は dev server を再起動**（examples はビルド済みパッケージを参照するため）。

---

## 8. 既知の制約 / 未対応（スコープ外・将来）

- **Text(5) / Nines(9-slice)(6)**: Rust(WASM) 側の対応が前提で現状未実装（メモリ: pixi-feature-gap-backlog）。
- **label-seek / texture-swap / part override（visible/cell/tint 上書き）**: `ROADMAP.md` / SDK 側 API 待ち。
- **アニメーションブレンド/クロスフェード**: WASM に C-API はあるが JS 側は未配線（メモリ: animation-blending-deferred）。
- **イベント処理**: 抽出/ディスパッチは core ではなくレンダラ側で行う方針（メモリ: events-handled-in-pixi-not-core）。
  → webgl/tyrano でも `onUserData`/`onSignal`/`onAudio` はレンダラ層で実装。

### 未解決の要調査事項

1. Tyrano `[loadjs]` の module/global どちらで配布するか（§5.6）。
2. Tyrano プロジェクト内で SS アセット（ssab/テクスチャ/wasm）をどこに置き、どうパス解決するか。
3. セーブ/ロードのフック点（Tyrano の save/load・`[cm]`/`[clearfix]` をどうラップするか）。
4. レイヤーへの Tyrano 製 CSS トランジション（フェード等）と canvas の重なり挙動。
5. `devicePixelRatio` / Retina のスケーリング方針。

---

## 9. 参照ファイル（source of truth）

| 目的 | パス |
| --- | --- |
| 全体アーキ図（Mermaid） | `README.md` |
| ロードマップ | `ROADMAP.md` |
| core 公開 API | `packages/ssplayer-core/src/index.ts` |
| ランタイム状態・幾何アクセサ | `packages/ssplayer-core/src/SSRuntimeManager.ts` |
| プレイヤーファサード | `packages/ssplayer-core/src/DirectInternalPlayer.ts`, `InternalPlayerBase.ts` |
| **頂点/インデックス生成（移植の中核）** | `packages/ssplayer-core/src/GeometryBuilder.ts` |
| リソース/音声 IF | `packages/ssplayer-core/src/IResourceManager.ts`, `IAudioManager.ts` |
| **描画ループ実装の手本（Normal 扇, プール, マスク前処理）** | `packages/ssplayer-pixi/src/SSPlayer.ts` |
| **PartsColor シェーダ（GLSL3/WGSL 移植元）** | `packages/ssplayer-pixi/src/PartsColorShader.ts` |
| エフェクト/マスクシェーダ | `packages/ssplayer-pixi/src/EffectShader.ts`, `MaskWriteShader.ts`, `MaskedPartsColorShader.ts` |
| SS 統合シェーダ 13 種 | `packages/ssplayer-pixi/src/SSShaderLib.ts` |
| **ブレンド GL factor（Invert/Exclusion 実測値）** | `packages/ssplayer-pixi/src/SSBlendModes.ts` |
| リソースマネージャの手本 | `packages/ssplayer-pixi/src/PixiResourceManager.ts` |
| 音声マネージャの手本 | `packages/ssplayer-pixi/src/SSWebAudioManager.ts` |
| rmmz（別レンダラ規約の参考） | `packages/ssplayer-rmmz/` |

### TyranoScript 外部リファレンス

- 本体リポジトリ: <https://github.com/ShikemokuMK/tyranoscript>（Ver6, JS90% / CSS7.6%, フリー・商用可）
- プラグイン自作: <https://tyrano.jp/usage/advance/plugin>
- カスタムタグの作り方: <https://kido0617.github.io/tyrano/2018-08-02-make-plugin/>
- プラグイン開発の実践知見（VOICEVOX）: <https://blog.ouvill.net/blog/2024-08-19-create_tyranoscript_plugin/>
- レイヤー解説: <https://tyrano.jp/usage/tech/layer>
- タグリファレンス V6: <https://tyrano.jp/tag/>
