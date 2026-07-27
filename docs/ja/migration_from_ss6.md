# SS6Player for Web からのマイグレーション

[← ドキュメント目次へ戻る](/ja/)

旧プレイヤー **[SS6Player for Web](https://github.com/SpriteStudio/SS6PlayerForWeb)**（`ss6player-pixi`）から本プレイヤー（`@spritestudio/ssplayer-pixi`）へ移行する場合の要点をまとめます。タイムライン評価が **JavaScript から Rust/WebAssembly コア**に置き換わり、アセットパイプラインと API も一新されています。単純な差し替えではなく、**アセットの再変換とスクリプトの書き換え**が必要です。

なお **PixiJS は双方とも v8 系**なので、Pixi 本体まわりの描画コードやシーングラフの扱いは大きく変わりません。

## 1. アセットフォーマットとパイプラインの変更

- **SS6Player**: `.sspj` を FlatBuffers 形式の **`.ssfb`** に変換し、テクスチャ（PNG 等）と併せて読み込んでいました。
- **本バージョン**: 最適化されたバイナリ形式 **`.ssab`** を利用します。`.ssfb` は使えないため、**`.sspj` から `.ssab` へ変換し直してください**。
  - 変換手順は [アセットの準備（.sspj → .ssab）](/ja/usage/assets) を参照してください。
  - テクスチャを埋め込んだ単一ファイルにする `--embedded` モードも利用できます。

## 2. クラス構成と初期化の変更

- **SS6Player**: アセットコンテナ **`SS6Project`**（`.ssfb`＋テクスチャをロード）と、表示オブジェクト **`SS6Player`**（`Container` 継承）の 2 クラス構成でした。`new SS6Player(project, animePackName, animeName)` のように **アニメパック名＋アニメ名**で生成していました。
- **本バージョン**: **`SSPlayer` 1 クラス**（`Container` 継承）に集約されています。**引数なしで生成**し、`load()` で `.ssab` を読み込み、`setAnimation()` で**アニメ名を直接指定**します。アニメパック名の指定は不要です（インスタンスパートの解決は内部で自動）。
  - WASM ランタイムの初期化のため、**アプリ起動時に一度だけ `await SSPlayer.initialize()`** が必要です。

```ts
import { SSPlayer } from '@spritestudio/ssplayer-pixi';

// SS6Player:
//   const project = new SS6Project('character.ssfb', () => {
//     const player = new SS6Player(project, 'character', 'walk');
//     app.stage.addChild(player);
//     player.Play();
//   });

// 本バージョン:
await SSPlayer.initialize();            // 起動時に一度だけ
const player = new SSPlayer();          // 引数なし
await player.load('character.ssab');    // .ssab を読み込み
await player.setAnimation('walk', -1);  // アニメ名を直接指定（-1 = 無限ループ）
app.stage.addChild(player);
player.play();
```

> テクスチャの共有について: 旧 `SS6Project` が担っていた「1 アセットを複数プレイヤーで共有」は、本バージョンでは **ResourceManager と PixiJS の `Assets` グローバルキャッシュ**が代替します。同一 URL のテクスチャは自動的に一度だけロードされ共有されます。

## 3. 再生制御 API の変更

メソッド名が **PascalCase から camelCase** へ、`SetAnimationSpeed` などの一部は **プロパティ（getter/setter）** へ変更されました。

| SS6Player | 本バージョン | 備考 |
|---|---|---|
| `Setup(pack, anime)` / コンストラクタ引数 | `setAnimation(name, loop?)` | パック名不要。アニメ名のみ |
| `Play(frameNo?)` | `play(startFrame = -1)` | `-1` は現在フレームから |
| `Pause()` / `Resume()` / `Stop()` | `pause()` / `resume()` / `stop()` | |
| `SetFrame(frame)` | `frame`（get/set） | シーク。サブフレーム可 |
| `NextFrame()` / `PrevFrame()` | `frame = frame ± 1` | 専用メソッドは廃止 |
| `loop`（get/set, `-1`=無限） | `loopCount`（get/set, `-1`=無限） | `setAnimation(name, loop)` でも指定可 |
| `SetAnimationSpeed(rate)`（負値で逆再生） | `speedScale`（get/set, 負値で逆再生） | 倍率指定 |
| `SetAnimationFramerate(fps)`（非推奨） | `fps`（get/set） | 絶対 fps 指定 |
| `SetAnimationSection(s, e, loops)` | `setAnimationSection(s, e)` | ループは `loopCount` に分離 |
| （往復再生の直接指定なし） | `setPlaybackDirection(dir, style)` | Forward/Backward × Normal/PingPong |
| `SetAlpha(alpha)` | `player.alpha`（Pixi 標準） | `Container` の標準プロパティを利用 |
| `GetPartIndexFromName(name)` | `getPartIndexFromName(name)` | |
| `isPlaying` / `isPausing` | `isPlaying` / `isPausing` | 同名 |
| `frameNo` / `totalFrame` / `fps` | `frame` / `totalFrames` / `fps` | |

```ts
// SS6Player: 2倍速で逆再生、区間 10〜30 フレーム
//   player.SetAnimationSpeed(-2.0);
//   player.SetAnimationSection(10, 30, 0);

// 本バージョン:
player.speedScale = -2.0;            // 負値で逆再生
player.setAnimationSection(10, 30);  // 区間指定
player.loopCount = -1;               // ループ回数は分離
```

## 4. イベント / コールバックの変更

- **SS6Player**: `SetUserDataCalback(fn)` / `SetPlayEndCallback(fn)` のように**単一のコールバックを登録**していました（※旧 API のスペルは `Calback`）。
- **本バージョン**: `on*` メソッドで**複数のリスナーを登録**でき、戻り値の **`Unsubscribe`（`() => void`）** で解除します。イベント種別も増えています。

| SS6Player | 本バージョン | ペイロード |
|---|---|---|
| `SetUserDataCalback(fn)` | `onUserData(listener)` | `SSUserDataEvent`（int/string/rect/point + partIndex/partName） |
| `SetPlayEndCallback(fn)` | `onAnimationEnd(listener)` | なし（指定したループ回数をすべて再生し終えたときに発火。無限ループでは発火しない） |
| （なし・新規） | `onAnimationLoop(listener)` | なし（ループ境界ごと） |
| （なし・新規） | `onSignal(listener)` | `SSSignalEvent`（commandId + パラメータ） |
| （なし・新規） | `onAudio(listener)` | `SSAudioEvent`（サウンドキュー） |

```ts
// SS6Player:
//   player.SetUserDataCalback((data) => { ... });
//   player.SetPlayEndCallback((p) => { ... });

// 本バージョン: 戻り値で解除できる
const off = player.onUserData((e) => {
  if (e.partName === 'attack') { /* ... */ }
});
player.onAnimationEnd(() => { /* 終了時 */ });
// ...
off(); // 解除
```

## 5. ⚠️ 現在は制限付きの機能

以下は SS6Player にありましたが、本バージョンでは **`SpriteStudio-SDK`（Rust コア）側の API 実装待ち**のため、現時点では利用できません。進捗は [ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md) を参照してください。

| SS6Player | 状態 | 依存 |
|---|---|---|
| `SetPartVisible` / `SetPartVisibleByIndex` | **未対応（実装予定）** | Override Layer API（SDK Phase 2） |
| `SetPartCell` / `SetPartCellByIndex` | **未対応（実装予定）** | Override Layer API（SDK Phase 2） |
| `SetPartTint` / `SetPartTintByIndex` | **未対応（実装予定）** | Override Layer API（SDK Phase 2） |
| `ChangeInstanceAnime`（インスタンスの動的差し替え） | **未対応（実装予定）** | Instance Lifecycle API（SDK Phase 3） |

現時点で使えるパーツ照会 API は次の 2 つです。詳細は [パーツ制御（表示 / セル / 色）](/ja/customize/part-overrides) を参照してください。

```ts
player.getPartsCount();               // パーツ数
player.getPartIndexFromName('body');  // パーツ名 → インデックス
```

## 6. その他の仕様差分

- **エフェクトパーツ**: SS6Player は**未対応**でしたが、本バージョンは**対応済み**です（パーティクルを WASM 側で計算しインラインに描画）。
- **マスク / クリッピング**: SS6Player はメッシュ化のみで**実際のマスクは非対応**でしたが、本バージョンは**カバレッジ前処理による本格的なマスク**に対応します（`player.maskEnabled` で切り替え）。
- **サウンド**: SS6Player は**非対応**でしたが、本バージョンは Web Audio 連携（`SSWebAudioManager`）に対応し、サウンド付き `.ssab` で自動バインドされます。
- **WebGPU**: WebGL に加えて WebGPU バックエンドに対応します（全カスタムシェーダーが GLSL/WGSL 両対応）。
- **パーツへの追従**: SS6Player では各パーツが Pixi の子ノードだったため `getChildByLabel(partName)` で座標を取得できましたが、本バージョンは**バッチ描画**のためその方法は使えません。代わりに **パーツトラッキング**（`attachToPart()` で任意の表示オブジェクトをパーツに追従させる機能。座標だけ読む `getPartTransform()` もあります）を利用してください。詳しくは [パーツトラッキング（指定パーツへの追従）](/ja/customize/part-following) を参照してください。
- **対応環境**: PixiJS v8 系。詳細は [PixiJS で使う](/ja/usage/pixi) を参照してください。
