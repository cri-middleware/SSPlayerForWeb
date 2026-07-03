# ssplayer-rmmz コールドスタート仕様（RPG Maker MZ / PixiJS v5 ダイレクトドロー）

> **前提**: 本実装は RPG Maker MZ の固定環境である **PixiJS v5** 向けに最適化された SpriteStudio プレイヤーです。
> 当初想定していた SceneGraph（PIXI.Spriteツリー）方式を廃止し、**`ssplayer-pixi` を参考にした `PIXI.ObjectRenderer` ベースのダイレクトドロー方式** を採用します。
> 各機能の実装やデータの取り扱いは `ssplayer-pixi` と **ssruntime の Player 移植ドキュメント** を主たるリファレンスとします。

作成日: 2026-07-03 / 対象リポジトリ: `SSPlayerForWeb`（pnpm monorepo）

---

## 0. 位置づけと設計判断（Decisions）

```text
【Layer 1】ssruntime      (WASM / Rust コア。純粋な幾何計算とデータ構造)
      ▲ (ラップ)
【Layer 2】ssplayer-core  (DirectInternalPlayer 等。JSからWASMを扱う論理ファサード)
      ▲ (利用・描画)
【Layer 3】ssplayer-rmmz  (SSPlayer / SSPlayerRenderer。PixiJS v5 向けの描画コンテナ)
      ▲ (プラグインとして配置)
【Layer 4】RMMZ プラグイン (Sprite_SSPlayer 等。MZ のゲーム環境で動くためのラッパー)
```

| 論点 | 決定 | 理由 |
| --- | --- | --- |
| 描画方式 | **`PIXI.ObjectRenderer` によるダイレクトドロー** | SceneGraph の生成コストを無くし、WASM の出力する頂点配列を一気に描画してパフォーマンスを最大化するため。 |
| PixiJS バージョン | **`pixi.js@^5.3.12`** | RPG Maker MZ のコアバージョンに合わせるため。 |
| 参照すべき実装 | **`ssplayer-pixi`** および **Player移植ドキュメント** | 基本的な描画ループやデータの流し込み方は v8 向けの `ssplayer-pixi` が参考になる。v8 と v5 の API 差異を埋めるのが主な仕事。 |
| Zオーダー管理 | **PixiJS に委譲** | `PIXI.Container` (DisplayObject) として振る舞うため、MZ 側のキャラクターやピクチャとの前後関係は自動で解決される。 |

---

## 1. ディレクトリと依存関係

- 場所: `packages/ssplayer-rmmz/`
- パッケージ名: `@spritestudio/ssplayer-rmmz`
- 依存先:
  - `dependencies`: `@spritestudio/ssplayer-core`
  - `peerDependencies`: `pixi.js` (^5.3.12)
- ビルドシステム: モノレポ全体のルールに則り、`tsdown` (または既存の方式) を利用してビルドする。

---

## 2. コア実装のアーキテクチャ

`ssplayer-rmmz` は、主に以下の2つのクラスによって構成されます。

### 2.1 `SSPlayerRenderer` (PIXI.ObjectRenderer の拡張)
WASM から `ssplayer-core` 経由で受け取ったジオメトリデータを、PixiJS v5 の WebGL パイプライン内で描画するための専用レンダラーです。

- **役割**:
  - `PIXI.Renderer.registerPlugin('ssplayer', SSPlayerRenderer)` として Pixi に事前登録される。
  - `render(player)` メソッド内で、渡された `SSPlayer` オブジェクトから頂点配列・インデックス配列を受け取る。
  - `renderer.gl` (WebGLRenderingContext) を使い、`gl.drawElements` などを直接叩いて描画する（あるいは `PIXI.Geometry` と `PIXI.Shader` を使って Pixi のパイプライン内で描画する）。
- **実装のキモ（WebGLState の保護）**:
  - WebGL のステート（バインドされているテクスチャやバッファ）をダイレクトに変更するため、PixiJS 側が管理している状態と不整合が起きる危険があります。
  - 生の GL コマンドを叩いた後は `renderer.state.reset()` や状態の復元を行い、RMMZ 側の描画（フィルタやキャラクター表示）が崩れないようにします。

### 2.2 `SSPlayer` (PIXI.Container または PIXI.DisplayObject の拡張)
MZ 側のゲームコードから実際にインスタンス化して操作する対象コンテナです。

- **役割**:
  - アニメーションファイルのロード (`ssab`) と再生制御（Play, Pause, フレーム更新）。
  - `_render(renderer)` のオーバーライド。ここで `renderer.batch.setObjectRenderer(renderer.plugins.ssplayer);` を呼び、自身を描画プラグインに渡す。
  - 内部に `ssplayer-core` インスタンスを持ち、毎フレームの更新ごとに WASM 側にジオメトリを計算させる。

---

## 3. レンダリングパイプラインとデータ構造 (詳細仕様)

WebGL 相当の処理を PixiJS v5 のパイプライン内で自前実装するため、`ssplayer-core` からのデータ受け取りと、それを WebGL に流し込む詳細な仕様を定義します（※ `ssplayer-webgl` の SPEC に準拠）。

### 3.1 頂点データ構造 (GeometryBuilder 出力)
`GeometryBuilder` が出力する頂点レイアウトは以下の通りです。PixiJS の `PIXI.Geometry` に `addAttribute` してインターリーブバッファ (`PIXI.Buffer`) を構成します。

| 属性名 (PIXI 側) | 要素数 | 内容 |
| --- | --- | --- |
| `aVertexPosition` | vec2 | ワールド座標（親行列・invTex 適用済み） |
| `aTextureCoord` | vec2 | 正規化済み UV (0..1) |
| `aColor` | vec4 | RGBA カラー (0..1) |
| `aVarg` | vec4 | `[rate, mixF, mulF, addSubF]` (PartsColor などのブレンド制御係数) |

> **注意**: `buildNormal` (通常パーツ) は中心点を加えた **5頂点** を出力し、インデックスは自動生成されません。レンダラ側で `[0,1,4, 1,3,4, 3,2,4, 2,0,4]` (12 index) の扇形を張る必要があります。

### 3.2 描画ループとバッチ処理
MZ の描画更新 (`render`) のたびに以下のステップを実行します。

1. **ジオメトリ更新**: `geometryBuilder.updateWorldPositions()` を呼ぶ（毎フレーム build 前に必須）。
2. **フレームデータ取得**: `runtimeManager.getFrameData(frame)` を取得し、`drawBatchesLength()` の数だけループします。
3. **バッチごとの描画**:
   - `b = fd.drawBatches(i)` から情報を取得。
   - テクスチャ (`b.textureHash()`) を引き当て、`PIXI.Texture`（の `baseTexture`）を取得。
   - バッチの種別 (`b.kind()`) に応じ、`buildNormal`, `buildShape`, `buildMesh` を呼び出し、WASMメモリ（ゼロコピー）またはテンポラリの `Float32Array` に頂点を書き込む。
   - `PIXI.Geometry` のバッファを更新 (`geometry.buffers[0].update(vertices)` 等)。
   - **ブレンドモードの設定**: `b.blendType()` を `PIXI.BLEND_MODES` (Add, Multiply, Screen など) にマッピングし、Pixi の State (`renderer.state.setBlendMode`) に反映。
   - **描画発行**: `renderer.shader.bind(shader)` → `renderer.geometry.bind(geometry)` → `renderer.geometry.draw(gl.TRIANGLES, indexCount, 0)` を実行。

### 3.3 シェーダーの実装
`ssplayer-webgl` や Player 移植ドキュメントの定義に基づく PartsColor 対応シェーダーを `PIXI.Shader.from(vert, frag)` で定義します。
- PartsColor などの混色計算をフラグメントシェーダー内で `aVarg` を使って解決します。
- 出力は PixiJS (RMMZ) の期待する **Premultiplied Alpha 済み** の形式にします。

---

## 4. 実装のステップ (コールドスタート)

1. **環境構築とプロトタイピング**
   - `packages/ssplayer-rmmz/package.json` をセットアップ。
   - ダミーの `PIXI.ObjectRenderer` で赤い四角を描くモックを作り、RMMZ 上で **MZキャラクターとの Zオーダー** や **画面フラッシュ（フィルタ）の適用** が破綻しないか確認する。

2. **WASM (core) と PIXI.Geometry の結合**
   - 上記 3.2 のバッチ処理を `SSPlayerRenderer` の `render(player)` または `flush()` 内に実装する。
   - `Float32Array` のテンポラリバッファ（プール）を用意し、毎フレームの `new` アロケーションを防ぐ。

3. **シェーダーとブレンドの完全対応**
   - Normal, Shape, Mesh それぞれのインデックス生成と描画を確認。
   - `aVarg` (PartsColor) を使ったカスタムシェーダーを適用し、SpriteStudio 上の見た目と一致させる。

4. **MZ プラグインインターフェース化**
   - RMMZ プラグインから利用しやすいように `window.SpriteStudio` 等のグローバルエントリーポイントを作る。

---

## 5. 開発時の注意事項・ピットフォール

- **PixiJS v8 vs v5 の API 差異**: `ssplayer-pixi` (v8) は内部構造が異なります。ロジック（データの取得・流し込み方）は v8 寄りでも、Pixi 側への呼び出しは必ず v5 向け (`PIXI.ObjectRenderer`, `PIXI.Geometry`, `PIXI.State`) に翻訳してください。
- **WebGL State の保護**: RMMZ の描画ループ内で直接 WebGL リソースをバインドした場合、描画終了後に Pixi 側のステートと不整合が起きないよう、適切に `renderer.state.reset()` を行ってください。

---

## 6. 実装時のリファレンスマップ

`ssplayer-rmmz` の描画ロジックやシェーダーの「正解」は、先行実装されている `ssplayer-pixi` に存在します。PixiJS v5 への翻訳実装を行う際、以下のファイルを直接参照してロジックを流用してください。

| 実装対象 / 解決したい課題 | 参照すべき `ssplayer-pixi` のファイル |
| --- | --- |
| **描画ループ駆動、`DrawBatch` の処理、Normal 扇形の張り方** | `packages/ssplayer-pixi/src/SSPlayer.ts` |
| **PartsColor (混色) のシェーダー実装** | `packages/ssplayer-pixi/src/PartsColorShader.ts` |
| **エフェクト / マスク処理のシェーダー** | `packages/ssplayer-pixi/src/EffectShader.ts`, `MaskWriteShader.ts`, `MaskedPartsColorShader.ts` |
| **SS 特殊シェーダ 13 種の GLSL 仕様** | `packages/ssplayer-pixi/src/SSShaderLib.ts` |
| **ブレンドモードの PixiJS へのマッピング・設定値** | `packages/ssplayer-pixi/src/SSBlendModes.ts` |
| **リソースマネージャ (Pixi Texture の生成・キャッシュ)** | `packages/ssplayer-pixi/src/PixiResourceManager.ts` |

---

## 7. RMMZ プラグイン層 (Layer 4) の設計指針

旧 `SS6Player` プラグインが抱えていた「他プラグインとの競合」や「ゲーム本体との非連動感」を解決するため、RMMZ 側のラッパースクリプトは以下の MVC 原則と同期設計に従って実装します。

### 7.1 モデルとビューの完全分離
プラグインコマンドは `Sprite`（ビュー）を直接操作しません。`Game_Picture` や `Game_Character`（モデル）に「現在再生すべき SS アニメーションのデータ」を保存します。
これにより、セーブ＆ロード時にアニメーションの状態が自然に復元されるようになります。

### 7.2 既存スプライトへの「子要素」としてのアタッチ
既存の `Sprite_Picture.prototype.updateBitmap` を強引に上書き（モンキーパッチ）して処理を乗っ取ることはしません。
MZ の `Sprite_Base` を継承した専用のラッパークラス `Sprite_SpriteStudio` を新設します。既存の `Sprite_Picture` は、モデル側に SS データがあることを検知すると、自分自身の **子要素 (`addChild`)** としてこのラッパーをぶら下げます。
これにより、MZ 本体が行う「移動・拡大・色調変更・透明度」処理が、そのまま子要素の SS アニメーションにもシームレスに適用・継承されます。

### 7.3 RMMZ メインループとの完全同期（Ticker の排除）
旧プラグインが「独立して動いている感」を出していた最大の理由は、プレイヤーが独自に非同期のタイマー (`Ticker` や `requestAnimationFrame`) を回していたためです。
今回の `ssplayer-rmmz` は独自のタイマーを持たず、**必ず親である RMMZ スプライトの `update()` メソッドから `player.update(deltaTime)` が呼び出される設計** にします。
これにより、メニューを開いてゲームが一時停止（ポーズ）した際や、イベントでウェイトがかかった際に、SS アニメーションも MZ の時間に完全に寄り添ってピタッと止まり、独立して浮いてしまう現象を根本から解決できます。

### 7.4 リソース管理の RMMZ への委譲 (Dependency Injection)
テクスチャ画像や音声ファイルのロードを SSPlayer 側で勝手に行うと、MZ のキャッシュ機構（`ImageManager`）から外れてしまい、メモリ管理やロード待ち（暗転中の事前ロード）がうまく機能しません。
これを解決するため、`ssplayer-core` が要求する `IResourceManager`（および `IAudioManager`）インターフェースを満たす **`RMMZResourceManager`** をプラグイン側（Layer 4）で実装し、プレイヤー生成時に注入（DI）します。
- **画像のロード**: `RMMZResourceManager.loadTexture()` 内で、MZ 標準の `ImageManager.loadBitmap(folder, filename)` を呼び出します。ロード完了後にその `bitmap.baseTexture` を SSPlayer に渡すことで、MZ のメモリ管理システムと完全に統合されます。
- **音声の再生**: 同様に、オーディオ再生要求が来た場合は MZ の `AudioManager.playSe()` 等に処理を流します。

---

## 8. ビルドと成果物 (RMMZ プラグインの配布形態)

RPG Maker MZ のプラグインエコシステムに適合するため、ビルドされた成果物は ES Module ではなく、ブラウザで直接動く **IIFE 形式（即時実行関数）の 1ファイルの `.js`** である必要があります。

### 8.1 プラグイン JS のビルド
`ssplayer-rmmz` パッケージのビルド時（`tsdown` 等を使用）には、`format: 'iife'` を指定し、依存パッケージ（`ssplayer-core` 等）をすべて 1 つのファイルにバンドルします。
出力された `ssplayer-rpgmakermz.js` を MZ プロジェクトの `js/plugins/` に入れるだけで動くようにします。

### 8.2 WASM ファイルの取り扱い
`ssruntime` の WASM バイナリの配布・ロード方法については、以下の 2 つのアプローチのどちらか（または両方対応）を取ります。

- **アプローチ A (分離配布):** WASM を `ssplayer.wasm` という独立したファイルとしてプラグイン JS と一緒に同梱します。MZ のプラグイン管理画面（パラメータ）で「WASMのパス」を指定できるようにし、JS から `fetch` して初期化します。（パフォーマンスとファイルサイズに優れます）
- **アプローチ B (インライン埋め込み):** WASM を Base64 エンコードし、文字列としてプラグイン JS の中に埋め込みます。`Uint8Array` に変換して初期化することで、「`.js` ファイル 1 つ置くだけで使える」という圧倒的な導入の手軽さを提供できます。（プラグインのファイルサイズは少し大きくなります）

### 8.3 WASM の初期化と RMMZ 起動シーケンスとの同期
`ssplayer-core` を利用するためには、ゲーム開始前に一度だけ `initializeWasm()` の Promise を完了させる必要があります。
RMMZ のエコシステムにおいて非同期初期化を安全に行うには、MZ の起動プロセスである **`Scene_Boot`** をフックします。

1. プラグイン JS（IIFE）が読み込まれた直後に、WASM のフェッチと初期化処理 (`initializeWasm()`) を非同期に開始し、その `Promise` を保持しておきます。
2. **`Scene_Boot.prototype.isReady`** をフック（エイリアス）し、WASM の初期化が完了していない場合は `false` を返すように上書きします。
3. これにより、WASM のコンパイルとメモリ確保が終わるまで MZ 本体の「Now Loading」画面が維持され、タイトル画面に遷移した時点では確実に WASM が使える状態になります。（Effekseer 等の WASM プラグインも同様の仕組みで初期化待機を行います）

---

## 9. RMMZ プラグインアノテーション (メタデータ) の仕様

RPG Maker MZ のプラグインは、JS ファイルの先頭にある特殊なコメントブロック (`/*:`) を読み取って、エディタ上の設定画面（プラグイン名、説明文、パラメータ、プラグインコマンド）を構築します。
このメタデータの記述において、以下のルールを遵守してください。

### 9.1 日英両言語のサポート (`/*:` と `/*:ja`)
SpriteStudio プレイヤーは国内外のユーザーに向けたプラグインであるため、エディタ上の表示は必ず **英語と日本語の両方** に対応させます。
- `/*:` ブロック: 英語（デフォルト言語）でのプラグイン説明やコマンド定義 (`@target MZ`, `@plugindesc`, `@command`, `@arg` など)。
- `/*:ja` ブロック: 日本語環境のエディタ向けの説明や定義。

### 9.2 バンドル時のコメント消失に注意
`tsdown` (esbuild や rollup 等) で TypeScript をビルド・バンドルする際、デフォルトではコメントが削除されてしまいます。
最終成果物である `ssplayer-rpgmakermz.js` の先頭に必ずアノテーションコメントが残るよう、ビルドスクリプト側で「専用のアノテーションファイルを結合する」か、または「特定パターンのコメントを保持する」設定 (`legalComments` 相当) を行う必要があります。

---

## 10. その他の RMMZ 連携における懸念と対策 (旧プラグインからの知見)

旧 `SS6PlayerForWeb` の実装や RMMZ のエコシステムを考慮した際、特に注意・実装すべき懸念点が 3 つあります。これらも本実装で確実に対処します。

### 10.1 シーン遷移時の WASM メモリの確実な解放 (`destroy` の徹底)
RMMZ は「マップ画面 ↔ メニュー画面 ↔ バトル画面」というシーン遷移を頻繁に行い、そのたびに古い `Sprite` コンテナを使い捨てます。
`ssplayer-core` は JS のガベージコレクション (`FinalizationRegistry`) による自動解放機構を持っていますが、これに頼ると GC が走るまでの間に WASM 側のヒープメモリが枯渇する恐れがあります。
対策として、RMMZ プラグイン側 (Layer 4) の `Sprite_SpriteStudio.prototype.destroy` メソッドの内部で、必ず **Layer 3 の `SSPlayer.destroy()` を明示的に呼び出し、即座に WASM メモリを `free` させる** ように徹底します。

### 10.2 座標系とアンカーの吸収 (Transform)
SpriteStudio のアニメーションデータは独自の基準点（多くは中央原点など）を持っていますが、MZ のピクチャは「左上原点」または「中央原点」の設定を持ち、キャラクターは「足元原点」です。
Layer 3 の `SSPlayer` 自体はピュアな PixiJS コンテナとして振る舞い、内部の頂点バッファ座標系 (y-down) と MZ 側の `anchor` や `scale` を適切に掛け合わせ、**「MZ のどのスプライトにアタッチしても、ズレずに期待通りの位置に表示される」** ように座標系の変換（吸収）ロジックを設ける必要があります。

### 10.3 ユーザーデータ (シグナル) と MZ イベントシステムの連携
SpriteStudio にはアニメーションの特定フレームに仕込める「ユーザーデータ (Signal)」機能があります。
これを MZ のイベントで活用できるよう、Layer 3 の `SSPlayer.onUserData` などのコールバックを Layer 4 で受け取り、**「特定のシグナルを受け取ったら MZ の指定スイッチ (例: `$gameSwitches.setValue(X, true)`) を ON にする」** といったブリッジ機能をプラグインコマンド（またはパラメータ）として提供します。これにより、アニメーションの演出に合わせて MZ のイベントを進行させることが可能になります。
