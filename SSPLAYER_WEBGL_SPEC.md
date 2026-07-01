# `@spritestudio/ssplayer-webgl` 仕様書

> `ssplayer-core`（WASM ラッパ）の上に載る、**外部依存ゼロの WebGL1/2 レンダラ**。
> pixi / Tyrano などのホストに依存しない **スタンドアロン**パッケージとして先行実装する。
> 将来的な用途として **広告（プレイアブル広告 / バナー）** を想定し、
> **バンドルサイズ**と**パフォーマンス**を第一級の設計制約として扱う。
>
> Tyrano 連携（`ssplayer-tyrano`）は本パッケージの薄いアダプタとして別途実装する（[TYRANO_COLDSTART.md](./TYRANO_COLDSTART.md)）。本書は Tyrano と独立。

作成日: 2026-07-01 / 対象リポジトリ: `SSPlayerForWeb`（pnpm monorepo）

---

## 0. 目的とスコープ

- **やること**: 素の `WebGLRenderingContext`（取れれば `WebGL2RenderingContext`）で、
  `ssplayer-core` の `GeometryBuilder` 出力を canvas 1 枚に直接描く（Direct / バッチ描画）。
- **やらないこと**: DOM/シーングラフ統合、UI、音声本体（`IAudioManager` 差し込み口のみ）、ホスト固有処理。
- **ベース**: `ssplayer-core` のみに依存（`ssplayer-pixi` は流用しない）。
- **互換性**: **WebGL1 / GLSL ES 1.00 を必須ベースライン**、WebGL2 は機能検出で自動昇格。

### 想定する主な消費者

1. **プレイアブル広告 / バナー広告**（最重要の設計ドライバ）— 単一 HTML・厳しいサイズ上限・
   クロスオリジン iframe・スレッド不可・低スペック端末。
2. `ssplayer-tyrano`（Tyrano プラグイン）。
3. 素の Web ページ / 任意の WebGL アプリ。

---

## 1. 設計指針（Design Pillars）★本書の背骨

広告用途から逆算した、実装中に常に優先する原則。以降の各章はこれを具体化したもの。

1. **依存ゼロ**: ランタイム依存は `ssplayer-core` のみ。npm 依存を足さない。
2. **ツリーシェイク可能**: `package.json` に `"sideEffects": false`。
   マスク / エフェクト / メッシュ / 統合シェーダ / 音声などの**任意機能はモジュール分割**し、
   使わなければバンドルから消える構成にする（§10）。
3. **アセットをインライン可能に**: `ArrayBuffer` / `Uint8Array` / data-URI を受け付け、
   **ネットワーク取得を必須にしない**。単一 HTML のプレイアブル広告で wasm/ssab/テクスチャを
   base64 埋め込みできること（§5.2）。
4. **シングルスレッド WASM**: 広告 iframe は cross-origin isolation されず
   **`SharedArrayBuffer` / threads / atomics が使えない**。スレッド無効の wasm を前提にする（§11.4）。
5. **速い初回描画（TTFF）**: `instantiateStreaming` / 最小の初期化仕事。初回フレームまでの処理を削る（§11.2）。
6. **毎フレーム GC ゼロ**: TypedArray view 再利用、VBO プール、スクラッチ使い回し。ホットパスで確保しない（§11.3）。
7. **可視時のみ描画**: `IntersectionObserver` で画面外は停止。DPR 上限・low-power で電力節約（§11.5）。
8. **堅牢なコンテキストロスト復帰**: モバイル webview で頻発。GL リソースを再生成（§9-9）。
9. **最大リーチ**: WebGL1 で広い端末をカバー、WebGL2 で最適化（§8）。
10. **サイズ予算を計測**: JS(gz) / WASM(gz) の予算を定め、CI で追う（§11.1）。

---

## 2. リポジトリ / ビルド前提

- **モノレポ**: pnpm workspaces。全パッケージ **`tsdown`**（vite/webpack/rollup は使わない）。
- **ビルド**: `pnpm -r run build`。WASM は git 管理外 → `pnpm run build:wasm`（Win は `build:wasm:win`）。
- **TypeScript strict**、`any` 回避、既存コードスタイル準拠（`CLAUDE.md`）。
- 依存追加は `pnpm add <pkg> --filter @spritestudio/ssplayer-webgl`。

### package.json（サイズ配慮版）

```jsonc
{
  "name": "@spritestudio/ssplayer-webgl",
  "version": "1.0.0",
  "description": "Zero-dependency, ad-grade WebGL1/2 renderer for SpriteStudio-SDK player",
  "type": "module",
  "main": "index.js",
  "types": "dist/index.d.ts",
  "sideEffects": false,                       // ★ツリーシェイク前提
  "exports": {
    ".":        { "import": "./dist/index.js",      "types": "./dist/index.d.ts" },
    "./lite":   { "import": "./dist/lite.js",       "types": "./dist/lite.d.ts" }   // Normal+blend のみの最小構成（任意）
  },
  "dependencies": { "@spritestudio/ssplayer-core": "workspace:*" },
  "scripts": { "build": "tsdown", "clean": "rimraf dist", "size": "node scripts/measure-size.mjs" },
  "devDependencies": { "typescript": "^6.0.3" },
  "license": "BSD-3-Clause"
}
```

### WASM サイズ最適化は**前提条件（要 SDK 連携）**

広告のサイズ上限に効くのは主に WASM バイナリ。以下は `SpriteStudio-SDK`（submodule）側のビルド設定に依存する。
**submodule 構造は無断で変えない**（`CLAUDE.md`）ため、必要なら別途指示のうえ対応する。本書では要求として明記:

- Cargo release profile: `opt-level = "z"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = true`。
- `wasm-bindgen`（`--no-typescript` 等）→ `wasm-opt -Oz` → 必要に応じ `wasm-snip` / `twiggy` で未使用削減。
- `WebAssembly.instantiateStreaming` が効くよう配信は `Content-Type: application/wasm` + gzip/br。
- **単一スレッド**ビルド（atomics/bulk-memory のスレッド機能を要求しない）。

---

## 3. `ssplayer-core` から消費する API 契約

`@spritestudio/ssplayer-core` から re-export 済み。レンダラはこれらを読むだけで、幾何計算を再実装しない。

### 3.1 初期化・メモリ

```ts
initializeWasm(wasmUrl?: string | URL): Promise<InitOutput>   // 最初に一度
getWasmMemory(): WebAssembly.Memory
finalizationRegistry: FinalizationRegistry<{ free: () => void }>
```
- 各アクセサは `getWasmMemory().buffer` 上の **TypedArray view（ゼロコピー）** を返す。
  **WASM メモリ growth で view は無効化**される（core の `WasmViewCache` が再取得）。自前で長期保持しない。
- ハンドルは GC 時 `FinalizationRegistry` で自動 `free()`。ただし広告では明示 `destroy()` で確実に解放する。

> **広告向けの入力拡張（本パッケージ側で用意）**: `initializeWasm` は URL 前提だが、
> 単一 HTML 用に **`ArrayBuffer`/data-URI から instantiate** する薄いラッパを webgl 側に持つ（§5.2）。

### 3.2 プレイヤーファサード `DirectInternalPlayer`

```ts
class DirectInternalPlayer /* extends InternalPlayerBase */ {
  runtimeManager: SSRuntimeManager;
  geometryBuilder: GeometryBuilder;
  audioManager: IAudioManager | null;
  constructor(resourceManager?: IResourceManager);

  load(ssabUrl: string, assetBaseUrl?: string): Promise<void>;
  bindResource(buffer: Uint8Array): void;                 // ★ ArrayBuffer 直渡し経路
  loadTextures(assetBaseUrl?: string): Promise<void>;
  setAnimation(name: string, assetBaseUrl?: string): Promise<void>;

  play(startFrame?: number): void; pause(): void; resume(): void; stop(): void;
  update(deltaMs: number): void; seekTo(frame: number): void;
  get frame(): number; set frame(v: number);
  get isPlaying(): boolean; get isPausing(): boolean;
  getSpeed(): number; setSpeed(speed: number): void;
  get totalFrames(): number; get fps(): number; get loopCount(): number;
  getPartsCount(): number; getPartIndexFromName(name: string): number;
  loadInstancePacks(assetBaseUrl?: string): Promise<void>;
  getInstanceChildren(): Map<number, InstanceChildState<DirectInternalPlayer>>;
  getEffectChildren(): Map<number, EffectChildState>;
}
```
- `bindResource(Uint8Array)` があるので、**ssab を fetch せず ArrayBuffer で渡せる**（広告インライン向けに重要）。

### 3.3 `SSRuntimeManager`（幾何ソース・毎フレーム）

```ts
getWorldMatrices(): Float32Array   // 16 float/part（2D は idx 0,1,4,5,12,13）
getLocalVertices(): Float32Array   // 10 float/part（5頂点×xy）
getLocalUVs(): Float32Array        // 10 float/part（5頂点×uv, ピクセル単位）
getMeshVerticesX/Y(): Float32Array; getMeshUVs(): Float32Array;
getMeshIndices(): Int32Array; getMeshVertexOffsets(): Uint32Array; getMeshIndexOffsets(): Int32Array;
getShapeVertices(): Float32Array; getShapeVertexBoxCoords(): Float32Array; getShapeVertexCounts(): Int32Array;
getPartMaskFlags(): Uint8Array | null      // visibleInsideMask=0x01, maskWrite=0x02 …
getFrameData(frame: number): FrameData | null
setCoordinateSystem(system: WebCoordinateSystem): void      // WebGL=0(y-up) / YDown=1
static extractTexturePaths(ssab): {hash,path}[]; static extractAnimationNames(ssab): string[];
static extractSounds(ssab): SoundAsset[];
```

### 3.4 `GeometryBuilder`（頂点・インデックス生成）★描画の中核

```ts
class GeometryBuilder {
  parentMatrix: Float32Array | null;    // instance 子アニメ用アフィン [m00,m01,m10,m11,tx,ty]
  updateWorldPositions(): void;         // 毎フレーム、build 前に一度
  buildNormal(partIdx, fd, invTexW, invTexH, outPos, outUv, outCol, outCustom0): void;
  buildShape (partIdx, fd, numVerts, invTexW, invTexH, outPos, outUv, outCol, outCustom0, outIdx): void;
  buildMesh  (partIdx, fd, pCount, iCount, invTexW, invTexH, outPos, outUv, outCol, outCustom0, outIdx): void;
  buildEffectCommand(partIdx, plan, particleOffset, quadCount, outPos, outUv, outCol, outIdx,
                     vertexOffset?, indexOffset?, partAlpha?): void;
  static composeAffine(parent, child, out?): Float32Array;
}
```

**出力レイアウト（= VBO の中身）**:

| 属性 | 要素/頂点 | 内容 |
| --- | --- | --- |
| `outPos` (`aPosition`) | vec2 | ワールド座標。親行列・invTex 適用済み |
| `outUv` (`aUV`) | vec2 | **正規化済み** UV（0..1） |
| `outCol` (`aColor`) | vec4 | RGBA 0..1 |
| `outCustom0` (`aVarg`) | vec4 | **`[rate, mixF, mulF, addSubF]`**（PartsColor ブレンド制御） |

- `invTexW = 1/texW`, `invTexH = 1/texH`（texture hash からサイズを引いて渡す）。
- **Normal**: 5 頂点 `[0]=TL,[1]=TR,[2]=BL,[3]=BR,[4]=center`。**index は builder が出さない**ので
  レンダラで 12 index / 4 三角形の扇を張る:
  ```
  (0,1,4) (1,3,4) (3,2,4) (2,0,4)     // 中心頂点 4 を要にした扇
  ```
  （出典: `packages/ssplayer-pixi/src/SSPlayer.ts` `acquireMesh` の `requiredVertices=5, requiredIndices=12`）
- **Shape**: `numVerts` 頂点 + `(numVerts-2)*3` index（ファン、builder が index 記入）。
- **Mesh**: `pCount` 頂点 + `iCount` index（builder 記入）。
- **Effect**: quad 群。`quadCount*4` 頂点 / `quadCount*6` index。複数コマンドを 1 バッファに詰込可。

### 3.5 `FrameData` / `DrawBatch`（描画ループ駆動）

```ts
class FrameData {
  drawBatchesLength(): number; drawBatches(i, out?): DrawBatch | null;
  parts(i, out?): PartState | null; partsColor(i, out?): PartAttributePartColor | null;
  drawOrderArray(): Uint32Array | null;
  effectDrawCommandsLength(): number; effectDrawCommands(i, out?): EffectDrawCommand | null;
}
class DrawBatch {
  startRank(): number; count(): number;
  textureHash(): number; vertexCount(): number; indexCount(): number;
  blendType(): BlendType; kind(): DrawBatchKind; flags(): number;
}
enum DrawBatchKind { Normal=0, Shape=1, Instance=2, Effect=3, Mesh=4, Text=5, Nines=6, Mask=7 }
enum BlendType { Mix=0, Mul=1, Add=2, Sub=3, Mulalpha=4, Screen=5, Exclusion=6, Invert=7,
                 Mul2=8, Div2=9, Screen2=10, Overlay2=11 }
```

### 3.6 リソース / 音声 IF

```ts
interface IResourceManager { loadTexture(url: string, hash: number): Promise<void>;
                             getTexture(hash: number): any; destroy(): void; }
interface IAudioManager { preload(sounds: SoundAsset[]): Promise<void>; /* 任意メソッド群 */ }
interface SoundAsset { name: string; path: string; }
```
本パッケージは **`SSWebGLResourceManager implements IResourceManager`**（`Image`/`ImageBitmap`/data-URI → `WebGLTexture`）を実装。
音声は本体を持たず IF 差し込みのみ（サイズ都合で既定は音声コードを含めない）。

---

## 4. レンダリングパイプライン

1. **context 取得**:
   ```ts
   const gl = canvas.getContext('webgl2', attrs) ?? canvas.getContext('webgl', attrs);
   // attrs = { alpha:true, premultipliedAlpha:true, stencil:true, antialias, powerPreference:'low-power',
   //           preserveDrawingBuffer:false, failIfMajorPerformanceCaveat:false, desynchronized:true }
   ```
2. **プログラム作成**: PartsColor（Normal/Shape/Mesh 共通）、Effect、Mask（MaskWrite + Masked, stencil）。
   任意機能はモジュール分割し、未使用ならバンドルから除外（§10）。
3. **射影**: canvas ピクセル空間 → クリップ空間の正射影を uniform `uProjection` で渡す。SS の原点は中心。
   配置は `uTransform`（`setTransform`）で。y 向きは `setCoordinateSystem` に合わせる。
4. **毎フレーム**（擬似コード）:
   ```ts
   player.update(deltaMs);
   const gb = player.geometryBuilder;
   gb.parentMatrix = null;
   gb.updateWorldPositions();                 // ★ build 前に必須
   const fd = player.runtimeManager.getFrameData(player.frame);
   for (let i = 0; i < fd.drawBatchesLength(); i++) {
     const b = fd.drawBatches(i)!;
     const tex = resourceManager.getTexture(b.textureHash());
     // b.kind() に応じて gb.buildNormal/buildShape/buildMesh/buildEffectCommand で VBO 更新
     setBlendState(b.blendType());            // §7
     gl.drawElements(gl.TRIANGLES, indexCount, indexType, 0);
   }
   ```
5. **ドローコール最小化**: `DrawBatch` は既にテクスチャ+ブレンドでまとまっている。
   さらに **1 フレーム分の頂点を共有バッファへ詰め、アップロード回数を減らす**（§11.3）。

---

## 5. 公開 API 設計（広告フレンドリ）

```ts
// packages/ssplayer-webgl/src/index.ts
export * from '@spritestudio/ssplayer-core';   // side-effect-free。未使用は tree-shake
export { SSCanvasPlayer, type SSCanvasPlayerOptions } from './SSCanvasPlayer.js';
export { SSWebGLRenderer } from './SSWebGLRenderer.js';
export { SSWebGLResourceManager } from './SSWebGLResourceManager.js';
```

### 5.1 `SSCanvasPlayer`

```ts
class SSCanvasPlayer {
  // 初期化: URL でも ArrayBuffer/data-URI でも可（広告インライン対応, §5.2）
  static initialize(wasm: string | URL | ArrayBuffer | Uint8Array): Promise<void>;

  constructor(target: HTMLCanvasElement | WebGLRenderingContext | WebGL2RenderingContext,
              options?: SSCanvasPlayerOptions);
  internalPlayer: DirectInternalPlayer;

  // ロード: URL でも生バッファでも可
  loadBuffer(ssab: ArrayBuffer | Uint8Array,
             textures: Map<number, TexImageSource | ArrayBuffer | string>): Promise<void>;
  load(ssabUrl: string, assetBaseUrl?: string): Promise<void>;     // URL 経路（Tyrano/一般 Web 用）
  setAnimation(name: string): Promise<void>;

  play(startFrame?: number): void; pause(): void; resume(): void; stop(): void;
  get frame(): number; set frame(v: number);
  get isPlaying(): boolean; set speedScale(v: number);

  // 描画駆動: 内蔵 RAF or 手動（ホストが持つループから駆動）
  startTicker(): void; stopTicker(): void;
  update(deltaMs: number): void; draw(): void;

  // 配置・表示
  setTransform(t: { x?: number; y?: number; scaleX?: number; scaleY?: number;
                    rotation?: number; anchorX?: number; anchorY?: number }): void;
  resize(cssW: number, cssH: number, dpr?: number): void;   // dpr は上限クランプ（§11.5）

  // イベント（立ち上がりエッジ, unsubscribe を返す）
  onUserData(cb): () => void; onSignal(cb): () => void; onAudio(cb): () => void;
  onAnimationEnd(cb): () => void; onAnimationLoop(cb): () => void;

  set audioManager(v: IAudioManager | null);
  destroy(): void;   // GL リソース + WASM ハンドルを即時解放
}

interface SSCanvasPlayerOptions {
  premultipliedAlpha?: boolean;   // 既定 true（§7,§8）
  stencil?: boolean;              // マスク用。既定 true（使わないなら false でわずかに軽い）
  antialias?: boolean;            // 既定 false（広告は速度優先）
  maxDPR?: number;                // 既定 2。高 DPI 端末の実解像度上限
  powerPreference?: 'low-power' | 'high-performance' | 'default';   // 既定 'low-power'
  pauseWhenHidden?: boolean;      // 既定 true（IntersectionObserver, §11.5）
  autoStart?: boolean;            // 既定 false。true なら load 後に startTicker
}
```

### 5.2 インライン資産経路（プレイアブル広告）

単一 HTML にすべて埋め込むケースを一級で支える:

```ts
await SSCanvasPlayer.initialize(wasmArrayBuffer);        // <script>で base64→ArrayBuffer 展開したもの
const p = new SSCanvasPlayer(canvas, { autoStart: true });
await p.loadBuffer(ssabArrayBuffer, new Map([
  [0x1234abcd, imageBitmapOrDataUri],                    // texture hash → 画像
]));
await p.setAnimation('idle');
p.play();
```

- 内部では `DirectInternalPlayer.bindResource(Uint8Array)` を使い **ssab を fetch しない**。
- テクスチャは `SSWebGLResourceManager` が `TexImageSource`/data-URI/`ArrayBuffer(→Blob→ImageBitmap)` を受ける。
- `initialize` に `ArrayBuffer` を渡した場合は `WebAssembly.instantiate`、URL 文字列なら `instantiateStreaming`。

---

## 6. シェーダ移植（WGSL・GLSL3 → GLSL ES 1.00）

**移植元（source of truth）**:
`packages/ssplayer-pixi/src/` の `PartsColorShader.ts`（GLSL3/WGSL 両版）, `EffectShader.ts`,
`MaskWriteShader.ts`, `MaskedPartsColorShader.ts`, `SSShaderLib.ts`（`ss-*` 統合シェーダ 13 種）。

**機械的変換ルール**:

| GLSL ES 3.00 (pixi) | GLSL ES 1.00 (webgl1) |
| --- | --- |
| `in`（vertex 入力） | `attribute` |
| `in`/`out`（varying） | `varying` |
| `out vec4 finalColor;` + 代入 | 宣言不要・`gl_FragColor =` |
| `texture(t,uv)` | `texture2D(t,uv)` |
| （精度省略可） | fragment 先頭に `precision mediump float;`（highp は要検出, §8） |
| `mat3 * vec3` | そのまま可 |

**PartsColor を GLSL ES 1.00 に移植した完成形**（`aVarg=[rate,mixF,mulF,addSubF]`）:

```glsl
// vertex
attribute vec2 aPosition; attribute vec2 aUV; attribute vec4 aColor; attribute vec4 aVarg;
uniform mat3 uProjection; uniform mat3 uTransform;
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
uniform vec4 uColor;   // (tint.rgb*alpha, alpha)。親チェーンの階層アルファを自前で渡す
void main() {
  vec4 texColor = texture2D(uTexture, vUV);
  if (texColor.a == 0.0) { gl_FragColor = vec4(0.0); return; }
  float rate = vVarg.x, isMix = vVarg.y, isMul = vVarg.z, isAddSub = vVarg.w;
  vec3 straightTexRGB = texColor.rgb / max(texColor.a, 0.0001);      // 逆プリマルチ
  vec3 mixColor    = mix(straightTexRGB, vColor.rgb, rate);
  vec3 mulColor    = straightTexRGB * mix(vec3(1.0), vColor.rgb, rate);
  vec3 addSubColor = straightTexRGB + (vColor.rgb * rate * sign(isAddSub));
  vec3 outRgb = mixColor * isMix + mulColor * isMul + addSubColor * abs(isAddSub);
  float outA = texColor.a * vColor.a;                                // §1-4: a=p.a*partcolor.a
  gl_FragColor = vec4(outRgb * outA, outA) * uColor;                 // 再プリマルチ後、階層を畳む
}
```
> `uColor` は pixi では Pixi が自動供給していた分。webgl では **親チェーンの階層アルファを自前 uniform で渡す**。
> `stateAlpha` の二重適用に注意（`GeometryBuilder` 10_parts_color §1-3「再乗算しない」を厳守）。

---

## 7. ブレンドモード → GL 状態マップ

SS は全ブレンドを**固定機能 GPU ブレンド**で実現する（出典: `packages/ssplayer-pixi/src/SSBlendModes.ts`、
Unity `SS6PlayerForUnity` `FunctionMaterialSetUpAnimation` 準拠）。シェーダ出力は**プリマルチ済み**。
`blendFuncSeparate(srcRGB, dstRGB, srcA, dstA)`（alpha は全モード `srcA=ONE, dstA=ONE_MINUS_SRC_ALPHA`）:

| BlendType | srcRGB, dstRGB | Equation |
| --- | --- | --- |
| Mix(0) 通常 | `ONE, ONE_MINUS_SRC_ALPHA` | ADD |
| Add(2) | `ONE, ONE` | ADD |
| Mul(1) | `DST_COLOR, ONE_MINUS_SRC_ALPHA` | ADD |
| Sub(3) | `ONE, ONE` | **REVERSE_SUBTRACT** |
| Screen(5) | `ONE_MINUS_DST_COLOR, ONE` | ADD |
| Invert(7) | `ONE_MINUS_DST_COLOR, ZERO` | ADD（SSBlendModes 実測値） |
| Exclusion(6) | `ONE_MINUS_DST_COLOR, ONE_MINUS_SRC_COLOR` | ADD（SSBlendModes 実測値） |
| Mulalpha(4)/Mul2/Div2/Screen2/Overlay2 | 要確認 | SS6PlayerForUnity を出典に検証 |

- **Sub のみ** `blendEquationSeparate(FUNC_REVERSE_SUBTRACT, FUNC_ADD)`。他は `FUNC_ADD`。
- ブレンド状態変更はドローコール間の**状態切替コスト**になるので、`DrawBatch` 順が既にブレンドで
  まとまっている前提を崩さない（無駄な `blendFunc` 呼び出しを冗長化しない）。

---

## 8. WebGL1 制約チートシート（★必ず遵守）＋ WebGL2 昇格

1. **GLSL ES 1.00**: `attribute`/`varying`/`gl_FragColor`/`texture2D`。fragment は `precision` 必須。
   ループは**定数上限**のみ。
2. **index 型**: 既定 `UNSIGNED_SHORT`（`Uint16Array`, 頂点上限 65535/描画）。
   `OES_element_index_uint` があれば `Uint32Array`。`GeometryBuilder` は両対応 → 拡張無しでは Uint16、
   大バッチは分割。
3. **NPOT テクスチャ**: `wrap=CLAMP_TO_EDGE` 必須、mipmap 不可、min filter は `LINEAR`/`NEAREST`。既定でこれ。
4. **VAO**: WebGL1 標準に無い → `OES_vertex_array_object` か毎描画で attrib ポインタ再設定。WebGL2 は標準 VAO。
5. **stencil マスク**: `DrawBatchKind.Mask`/`getPartMaskFlags` を stencil で。context 取得時 `{ stencil:true }`。
6. **プリマルチアルファ**: シェーダは「サンプル値プリマルチ済み」前提 → テクスチャは
   `UNPACK_PREMULTIPLY_ALPHA_WEBGL=true` でアップロード、ブレンドも §7 のプリマルチ前提で揃える。
7. **MRT なし**（単一カラーターゲットで足りる）。
8. **highp 非保証**（モバイル）: `getShaderPrecisionFormat` で fragment highp を検出、不可なら mediump。
9. **コンテキストロスト**: `webglcontextlost`/`webglcontextrestored` を購読し GL リソース再生成。
10. **WebGL2 自動昇格**: `webgl2` が取れたら **標準 VAO / uint32 index（拡張不要）/ 完全 NPOT** を使用。
    **シェーダは GLSL ES 1.00 のまま**（`#version 300 es` 化は不要）。index 型と VAO の有無だけ分岐 = 最小コスト。

---

## 9. パフォーマンス設計の詳細

- **毎フレーム GC ゼロ**: WASM view を保持し直すのは core 側。webgl 側は VBO/スクラッチ/mesh 相当を
  **プール再利用**し、`new` を出さない（pixi の `meshPool`/`activeMeshes` と同型）。
- **アップロード集約**: 各 `DrawBatch` を個別 `bufferSubData` で上げるより、1 フレーム分の頂点を
  **共有 dynamic バッファに詰めて少回数でアップロード**。`gl.bufferData(size, DYNAMIC_DRAW)` で確保 →
  `bufferSubData` 更新。バッファ orphaning でパイプラインストール回避。
- **属性配置**: 既定は属性別バッファ（`GeometryBuilder` が別配列に書くため素直）。
  bind コストが問題ならインターリーブ（pos2+uv2+col4+varg4 = 12float/頂点）を検討。WebGL2 は VAO で bind 削減。
- **ドローコール**: `DrawBatch` の粒度を尊重し、状態が同じ連続バッチはまとめる余地を探る。
- **可視制御**: `IntersectionObserver` で画面外は RAF を止める（CPU/電力・広告ビューアビリティ両得）。
- **DPR 上限**: `min(devicePixelRatio, maxDPR)` で実解像度を抑える（既定 2）。低スペック端末で効く。
- **コンテキストロスト復帰**: プログラム/テクスチャ/バッファを再生成できるよう、生成情報を保持しておく。

---

## 10. 機能モジュール分割（ツリーシェイク）

サイズ最小化のため、**任意機能は独立モジュール**にし、`index.ts` から使う時だけ引き込む。
`"sideEffects": false` と副作用の無いモジュール設計が前提。

| モジュール | 内容 | プレイアブル最小構成での要否 |
| --- | --- | --- |
| PartsColorProgram | Normal/Shape/Mesh 共通描画 | **必須** |
| BlendState | §7 のブレンド | **必須** |
| Shape/Mesh build 経路 | Shape/Mesh パーツ | アニメが使う時のみ |
| MaskProgram (stencil) | マスク | マスクを使う時のみ |
| EffectProgram | パーティクル | エフェクトを使う時のみ |
| SSShaderLib (`ss-*` 13種) | 統合シェーダ | 使う時のみ |
| audio adapter | `IAudioManager` 実装例 | 音を使う時のみ（既定含めない） |

- `./lite` エクスポート（任意）: Normal + blend のみの最小レンダラ。多くのプレイアブル広告はこれで足りる。

---

## 11. サイズ / パフォーマンス予算と計測

### 11.1 サイズ予算（gzip 後・目安。CI で追跡）

| 対象 | 目標(gz) | 備考 |
| --- | --- | --- |
| ssplayer-webgl 自体（GL コード） | **< 15 KB** | core を除いた本体 |
| + ssplayer-core（wasm glue + FlatBuffers ランタイム） | 追加分を計測 | 未使用の introspection は tree-shake |
| WASM バイナリ | **< 300 KB を目標**（できれば更に小さく） | §2 の Rust/wasm-opt 前提。SDK 依存 |
| プレイアブル広告 単一 HTML 合計 | 主要 NW の上限内（例: **5 MB**） | wasm + ssab + テクスチャ込み。テクスチャ圧縮が支配的 |

> 参考: Google/AdMob・Meta・Unity Ads/ironSource/AppLovin のプレイアブルは概ね **5 MB**（zip・単一 HTML）。
> IAB/MRAID のディスプレイはさらに小さい。**テクスチャの総量が最大の変数** — 解像度/枚数/圧縮を詰める。

### 11.2 起動（TTFF）

- `initializeWasm` は URL なら `instantiateStreaming`、バッファなら `instantiate`。
- 初回フレームまでの処理を最小化（テクスチャは必要分から、シェーダは使う分だけコンパイル）。
- `autoStart` で load 完了→即描画。

### 11.4 実行環境の制約（広告 iframe）

- **cross-origin isolation 不可** → `SharedArrayBuffer`/threads/atomics 不可 → **単一スレッド wasm 必須**。
- **CSP**: WebAssembly コンパイルに `script-src 'wasm-unsafe-eval'` が要る場合がある。`eval`/`new Function` を使わない。
- **autoplay/gesture**: 音は user gesture 後に `AudioContext.resume()`。音は既定でコードに含めない（差し込み式）。
- **MRAID**: `viewableChange` 連動で描画開始/停止（`pauseWhenHidden` と整合）。

### 11.5 電力・可視

- `IntersectionObserver` で画面外停止、`document.visibilitychange` で停止、`powerPreference:'low-power'`、DPR 上限。

---

## 12. ファイル構成（目安）

```
packages/ssplayer-webgl/
  package.json  tsdown.config.ts  README.md  scripts/measure-size.mjs
  src/
    index.ts                    // core re-export + 公開クラス（full）
    lite.ts                     // Normal+blend のみの最小エントリ（任意）
    SSCanvasPlayer.ts           // ファサード（RAF/手動駆動, 可視制御, DPR, ArrayBuffer 経路）
    SSWebGLRenderer.ts          // context/プログラム/VBO プール/描画ループ/コンテキストロスト
    SSWebGLResourceManager.ts   // TexImageSource/data-URI/ArrayBuffer → WebGLTexture, hash キャッシュ
    programs/
      PartsColorProgram.ts      // §6 の GLSL ES 1.00 版
      EffectProgram.ts
      MaskProgram.ts            // MaskWrite + Masked（stencil）
    gl/
      GLProgram.ts  GLBuffer.ts  BlendState.ts  capabilities.ts   // webgl1/2 機能検出
```

---

## 13. 実装フェーズ

- [ ] **P0 scaffold**: パッケージ作成（package.json/`sideEffects:false`/tsdown/index.ts で core re-export）。
      `pnpm i` → 必要なら `pnpm run build:wasm` → `pnpm -r run build` が通る。size 計測スクリプト雛形。
- [ ] **P1 静止 1 枚**: WebGL1 context + PartsColor（**Normal のみ**, 12-index 扇）で単純アニメ 1 フレーム描画。
      `examples/pixi-example`/SS エディタと目視突き合わせ（§14）。
- [ ] **P2 再生 + Shape/Mesh + ブレンド全種**（§7）。共有バッファへのアップロード集約（§9）。
- [ ] **P3 マスク(stencil) + エフェクト**。
- [ ] **P4 WebGL2 昇格**（VAO / uint32 index / NPOT）。
- [ ] **P5 広告最適化**: ArrayBuffer/data-URI 経路（§5.2）、`./lite`、可視制御・DPR・コンテキストロスト、
      サイズ予算計測を CI 化（§11）。
- [ ] **P6 examples**: `examples/webgl-example`（Vite）と **単一 HTML プレイアブル最小サンプル**。

---

## 14. 検証

- **見た目の正解合わせ**: `examples/pixi-example` と **SpriteStudio エディタ**を目視で突き合わせ。
  spec より**エディタ一致**を優先。webgl 版と pixi 版で同一アニメを並べて差分確認が最速。
  **パッケージ再ビルド後は dev server を再起動**（examples はビルド済みを参照）。
- **サイズ**: `scripts/measure-size.mjs` で JS(gz)/WASM(gz) を出力、予算表（§11.1）と比較。
- **パフォーマンス**: 低スペックモバイル/webview で 60fps 維持・メモリ・TTFF を計測。DevTools の
  Performance と、`EXT_disjoint_timer_query`（あれば）で GPU 時間も。

---

## 15. スコープ外 / 既知の制約

- **Text(5) / Nines(9-slice)(6)**: Rust(WASM) 側対応前提で未実装（メモリ: pixi-feature-gap-backlog）。
- **label-seek / texture-swap / part override**: `ROADMAP.md` / SDK API 待ち。
- **アニメブレンド/クロスフェード**: WASM に C-API はあるが JS 未配線（メモリ: animation-blending-deferred）。
- **イベント抽出/ディスパッチ**はレンダラ層で実装（メモリ: events-handled-in-pixi-not-core）。
- **音声本体**は含めない（`IAudioManager` 差し込みのみ。サイズ都合）。
- Tyrano 連携は `ssplayer-tyrano` に分離（[TYRANO_COLDSTART.md](./TYRANO_COLDSTART.md)）。

---

## 16. 参照ファイル（source of truth）

| 目的 | パス |
| --- | --- |
| 全体アーキ図（Mermaid） | `README.md` |
| ロードマップ | `ROADMAP.md` |
| core 公開 API | `packages/ssplayer-core/src/index.ts` |
| ランタイム状態・幾何アクセサ | `packages/ssplayer-core/src/SSRuntimeManager.ts` |
| プレイヤーファサード | `packages/ssplayer-core/src/DirectInternalPlayer.ts`, `InternalPlayerBase.ts` |
| **頂点/インデックス生成（描画の中核）** | `packages/ssplayer-core/src/GeometryBuilder.ts` |
| リソース/音声 IF | `packages/ssplayer-core/src/IResourceManager.ts`, `IAudioManager.ts` |
| **描画ループ実装の手本（Normal 扇, プール, マスク前処理）** | `packages/ssplayer-pixi/src/SSPlayer.ts` |
| **PartsColor シェーダ（移植元）** | `packages/ssplayer-pixi/src/PartsColorShader.ts` |
| エフェクト/マスクシェーダ | `packages/ssplayer-pixi/src/EffectShader.ts`, `MaskWriteShader.ts`, `MaskedPartsColorShader.ts` |
| SS 統合シェーダ 13 種 | `packages/ssplayer-pixi/src/SSShaderLib.ts` |
| **ブレンド GL factor（Invert/Exclusion 実測値）** | `packages/ssplayer-pixi/src/SSBlendModes.ts` |
| リソースマネージャの手本 | `packages/ssplayer-pixi/src/PixiResourceManager.ts` |
| WASM ビルド | `scripts/build-wasm.js`（+ `SpriteStudio-SDK` submodule の Cargo profile） |
