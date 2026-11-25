---
description: 従来の SS6Player for Web（ss6player-pixi）から ssplayer-pixi への移行。アセット、クラス構成、再生制御 API、イベント、パーツ単位の制御。
---

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
player.setAnimation('walk');            // アニメ名を直接指定
player.loopCount = -1;                  // -1 = 無限ループ
app.stage.addChild(player);
player.play();
```

> テクスチャの共有について: 旧 `SS6Project` が担っていた「1 アセットを複数プレイヤーで共有」は、本バージョンでは **ResourceManager と PixiJS の `Assets` グローバルキャッシュ**が代替します。同一 URL のテクスチャは自動的に一度だけロードされ共有されます。

## 3. 再生制御 API の変更

メソッド名が **PascalCase から camelCase** へ、`SetAnimationSpeed` などの一部は **プロパティ（getter/setter）** へ変更されました。

| SS6Player | 本バージョン | 備考 |
|---|---|---|
| `Setup(pack, anime)` / コンストラクタ引数 | `setAnimation(name)` | パック名不要。アニメ名のみ |
| `Play(frameNo?)` | `play(startFrame = -1)` | `-1` はセクションの先頭から。今の位置から続けるなら `play(player.frameNo)` |
| `Pause()` / `Resume()` / `Stop()` | `pause()` / `resume()` / `stop()` | |
| `SetFrame(frame)` | `frameNo`（get/set） | シーク。サブフレーム可 |
| `NextFrame()` / `PrevFrame()` | `frameNo = frameNo ± 1` | 専用メソッドは廃止 |
| `loop`（get/set, `-1`=無限） | `loopCount`（get/set, `-1`=無限） | `setAnimation` の後に設定 |
| `SetAnimationSpeed(rate)`（負値で逆再生） | `speedScale`（get/set） | 倍率指定。**負値では逆再生しなくなりました** —— 下記参照 |
| `SetAnimationFramerate(fps)`（非推奨） | `frameRate`（get/set） | 絶対 fps 指定 |
| `SetAnimationSection(s, e, loops)` | `setAnimationSection(s, e)` | ループは `loopCount` に分離 |
| （往復再生の直接指定なし） | `setPlaybackDirection(dir, style)` | Forward/Backward × Normal/PingPong |
| `SetAlpha(alpha)` | `player.alpha`（Pixi 標準） | `Container` の標準プロパティを利用 |
| `GetPartIndexFromName(name)` | `findPartIndex(name)` | 不明なパーツは `-1` |
| `isPlaying` / `isPausing` | `isPlaying` / `isPausing` | 同名 |
| `frameNo` / `totalFrame` / `fps` | `frameNo` / `totalFrames` / `frameRate` | 再生ヘッドは同名 |

### `speedScale` に負値を渡しても逆再生しません

表の中で唯一、黙って挙動が変わる項目なので明記します。SS6Player は
`SetAnimationSpeed(-2.0)` で逆再生しました。本バージョンではランタイムが `0` 以下のレートを**停止**にクランプします。再生ヘッドはその場で止まり、`speedScale` は実際になった値である `0` を返し、意図と違うことを示すものは何も出ません。向きを変えるのは
`setPlaybackDirection` の役目です。別の操作に分かれているおかげで両者を組み合わせられるので、逆再生しながら速度を落とす／上げることもできます。

```ts
import { WebPlaybackDirection, WebPlaybackStyle } from '@spritestudio/ssplayer-pixi';

// SS6Player: 2倍速で逆再生、区間 10〜30 フレーム
//   player.SetAnimationSpeed(-2.0);
//   player.SetAnimationSection(10, 30, 0);

// 本バージョン:
player.setPlaybackDirection(WebPlaybackDirection.Backward, WebPlaybackStyle.Normal);
player.speedScale = 2.0;             // 大きさだけ。負値にすると停止してしまう
player.setAnimationSection(10, 30);  // 区間指定
player.loopCount = -1;               // ループ回数は分離
```

## 4. イベント / コールバックの変更

- **SS6Player**: `SetUserDataCalback(fn)` / `SetPlayEndCallback(fn)` のように**単一のコールバックを登録**していました（※旧 API のスペルは `Calback`）。
- **本バージョン**: `on*` メソッドで**複数のリスナーを登録**でき、戻り値の **`Unsubscribe`（`() => void`）** で解除します。イベント種別も増えています。

| SS6Player | 本バージョン | ペイロード |
|---|---|---|
| `SetUserDataCalback(fn)` | `onUserData(listener)` | `SSUserDataEvent`（int/string/rect/point + partIndex/partName） |
| `SetPlayEndCallback(fn)` | `onAnimationFinished(listener)` | なし（指定したループ回数をすべて再生し終えたときに発火。無限ループでは発火しない） |
| （なし・新規） | `onAnimationLooped(listener)` | なし（ループ境界ごと） |
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
player.onAnimationFinished(() => { /* 終了時 */ });
// ...
off(); // 解除
```

## 5. パーツ単位の制御（表示 / セル / 色）

SS6Player のパーツ単位のセッターは、Override Layer API として**利用できます**。形は 2 点異なります。

- **`…ByIndex` 版はありません。** `part` 引数はすべて**パーツ名またはインデックス**（`number | string`）を受け取るため、1 つのメソッドで SS6Player の両形式をカバーします。
- **上書きには寿命があります。** 色とセルの上書きは `priority` を取り、どこまで維持するかを指定します（そのアトリビュートが次のキーフレームで更新されるまで / 次のアニメーションまで＝既定 / 恒久）。寿命はランタイムが管理するため、SS6Player と違ってアニメーション切り替え後に再適用する必要はありません。

| SS6Player | 本バージョン | 備考 |
|---|---|---|
| `SetPartVisible` / `SetPartVisibleByIndex` | `setPartVisibilityOverride(part, hide, cascade?)` | `hide = false` でアニメーション側に戻ります。`cascade` で子孫も非表示 |
| `SetPartCell` / `SetPartCellByIndex` | `setPartCellOverride(part, cellmapName, cellName, priority?)` | 設定時に解決するため、存在しないセルマップ名 / セル名はその場で失敗します |
| `SetPartTint` / `SetPartTintByIndex` | `setPartColorOverride(part, rgba, blendOp?, priority?)` | 色は `0xRRGGBBAA` にパックした数値。グラデーションは `setPartColorOverrideCorners()` |
| （新規） | `clearPartColorOverride` / `clearPartCellOverride` / `clearPartVisibilityOverride` / `clearAllPartOverrides` | 個別、またはそのプレイヤーの全上書きを解除 |
| （新規） | `getCellmapNames()` / `getCellNames(cellmapName)` | セル上書きで指定できる名前の一覧 |

```ts
import { SSBlendOp } from '@spritestudio/ssplayer-pixi';

// SS6Player:
//   player.SetPartTintByIndex(index, ...);
//   player.SetPartVisible('body', false);

// 本バージョン: 名前でもインデックスでも指定でき、拒否された場合は false が返ります
player.setPartColorOverride('body', 0xff0000ff, SSBlendOp.Mul);
player.setPartVisibilityOverride('body', true);
```

パーツ照会 API は従来どおりです。

```ts
player.getPartNames();               // パーツ名の一覧（パーツ index 順。length が個数）
player.findPartIndex('body');  // パーツ名 → インデックス（不明なら -1）
```

`findPartIndex('body')` はランタイム側で同じ解決を行うもので、`part` 引数の内部処理でも使われます。上書きを頻繁に行う場合は、これでインデックスを取得して使い回してください。

同じメソッドは `SSPlayer`（PixiJS・WebGL の両バックエンド）の両方にあります。ブレンド方法・
priority・色のパック方法・注意点は [パーツ制御（表示 / セル / 色）](/ja/customize/part-overrides) を参照してください。コードを書かずに扱えるオーサリング手段は[RPG ツクール MZ で使う](/ja/usage/rmmz)・[TyranoScript で使う](/ja/usage/tyrano)・[ティラノビルダーで使う](/ja/usage/tyranobuilder) にあります。

## 6. ⚠️ 現在は制限付きの機能

以下は SS6Player にありましたが、本バージョンでは利用できません。**`SpriteStudio-SDK`（Rust コア）側**の API に依存します。[ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md) を参照してください。

| SS6Player | 状態 | 依存 |
|---|---|---|
| `ChangeInstanceAnime`（インスタンスの動的差し替え） | **未対応** | SDK の Instance Lifecycle API |

## 7. その他の仕様差分

- **エフェクトパーツ**: SS6Player は**未対応**でしたが、本バージョンは**対応済み**です（パーティクルを WASM 側で計算しインラインに描画）。
- **マスク / クリッピング**: SS6Player はメッシュ化のみで**実際のマスクは非対応**でしたが、本バージョンは**カバレッジ前処理による本格的なマスク**に対応します（`player.maskEnabled` で切り替え）。
- **サウンド**: SS6Player は**非対応**でしたが、本バージョンは Web Audio 連携（`SSWebAudioManager`）に対応し、サウンド付き `.ssab` で自動バインドされます。
- **WebGPU**: WebGL に加えて WebGPU バックエンドに対応します（全カスタムシェーダーが GLSL/WGSL 両対応）。
- **パーツへの追従**: SS6Player では各パーツが Pixi の子ノードだったため `getChildByLabel(partName)` で座標を取得できましたが、本バージョンは**バッチ描画**のためその方法は使えません。代わりに **パーツトラッキング**（`attachToPart()` で任意の表示オブジェクトをパーツに追従させる機能。座標だけ読む `getPartTransform()` もあります）を利用してください。詳しくは [パーツトラッキング（指定パーツへの追従）](/ja/customize/part-following) を参照してください。
- **対応環境**: PixiJS v8 系。詳細は [PixiJS で使う](/ja/usage/pixi) を参照してください。
