---
description: どのクラスから始めるか、その下に何があるか、実際に触れる型はどれか。生成リファレンスの見取り図。
---

# API リファレンス

すべてのエクスポートは[生成リファレンス](https://cri-middleware.github.io/SSPlayerForWeb/api/)に一覧があります。このページはその地図です。どのクラスから始めるか、その下に何があるか、実際に触れる型はどれかをまとめています。

## 起点となるクラスは 1 つ

自分で構築するプレイヤークラスは、インストールしたレンダラーパッケージのものが**必ず 1 つだけ**です。残りはすべてそこからぶら下がります。

| 環境 | クラス | パッケージ |
|---|---|---|
| フレームワーク非依存 / ドロップイン | [`SSSurface`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/classes/SSSurface)（`createPlayer()` が [`SSPlayer`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/classes/SSPlayer) を返す） | `ssplayer-webgl` |
| HTML だけで済ませたい | `<ss-player>`（[WebGL・Web Components で使う](./usage/webgl.md)） | `ssplayer-webgl` |
| PixiJS v8 アプリ | [`SSPlayer`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-pixi/classes/SSPlayer) | `ssplayer-pixi` |
| PixiJS v8 アプリのボタン（[UI ボタン](./usage/pixi-ui.md) を参照） | [`SSButton`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-pixi-ui/classes/SSButton) | `ssplayer-pixi-ui` |
| レンダラーを自作する | [`DirectInternalPlayer`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/classes/DirectInternalPlayer) + [`GeometryBuilder`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/classes/GeometryBuilder) | `ssplayer-core` |

WASM ランタイムはモジュールレベルのシングルトンなので、プレイヤーを作る前に一度だけ初期化します。

```ts
await SSSurface.initialize();  // WebGL。PixiJS は SSPlayer.initialize()
```

::: tip 同じシンボルが 4 回出てくる理由
各レンダラーパッケージは **`ssplayer-core` を再エクスポート**し、`ssplayer-pixi-ui` は `ssplayer-pixi` を再エクスポートしています。そのため
`SSRuntimeManager` / `IResourceManager` / `BlendType` などは、生成リファレンスの 4 つのパッケージページすべてに現れます。実体は同じ宣言です。**インストールしたパッケージから
import** してください。コアの型を使いたいだけの理由で、レンダラーと併せて `ssplayer-core` を追加インストールしないでください。
:::

## 下に何があるか

スタックトレースや補完候補で見慣れないところに出たときの手がかりです。

```
SSPlayer (webgl) / SSPlayer (pixi) ← 呼び出すファサード（再生・イベント・オーバーライド）
  └─ DirectInternalPlayer          ← InternalPlayerBase を継承。ロードと描画プランを保持
       └─ SSRuntimeManager         ← WASM 境界。フレームデータを zero-copy な型付き配列ビューで公開
            └─ SSRuntimeContext    ← wasm-bindgen のハンドル（生成物。直接触る必要はありません）
```

いずれも public ですが、下に降りるほど「そのときランタイムが出力しているもの」という契約に近づきます。レンダラーを書くのでなければ、ファサードに留まってください。

## 実際に触れる型

**イベント** — [イベントとユーザーデータ](./customize/events.md)を参照。
[`SSUserDataEvent`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/interfaces/SSUserDataEvent)、
[`SSSignalEvent`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/interfaces/SSSignalEvent)、
[`SSAudioEvent`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/interfaces/SSAudioEvent)、および
`onX` メソッドが返す解除ハンドル
[`Unsubscribe`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/type-aliases/Unsubscribe)。

**パーツオーバーライド** — [パーツ制御](./customize/part-overrides.md)を参照。
[`SSBlendOp`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/enumerations/SSBlendOp)、
[`SSOverridePriority`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/enumerations/SSOverridePriority)、
[`SSPartOverrideTarget`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/interfaces/SSPartOverrideTarget)。

**テクスチャ差し替え** — [テクスチャ差し替え（着せ替え）](./customize/texture-replacement.md)を参照。
`setCellmapTexture` / `getReplaceableTextureNames` は `SSPlayer` にあり、各エンジンのテクスチャオブジェクトを渡します（インポートすべき専用型はありません）。

**パーツトラッキング** — [パーツトラッキング](./customize/part-following.md)を参照。
[`SSPartFollowOptions`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/interfaces/SSPartFollowOptions)、
[`SSDecomposedTransform`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/interfaces/SSDecomposedTransform)、
PixiJS ではさらに
[`SSPartAttachment`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-pixi/type-aliases/SSPartAttachment)。

**モーションブレンド** — [モーションブレンド](./customize/motion-blending.md)を参照。`setTrackBlend` と `setTrackSync` が取る [`SSTrackBlend`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/enumerations/SSTrackBlend) と [`SSTrackSync`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/enumerations/SSTrackSync)。ソースのハンドルはただの `number` です。

**再生系の enum。**
`setPlaybackDirection` の 2 引数が
[`WebPlaybackDirection`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/enumerations/WebPlaybackDirection) と
[`WebPlaybackStyle`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/enumerations/WebPlaybackStyle) です。

**構築オプション**（WebGL のみ）—
[`SSSurfaceOptions`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/interfaces/SSSurfaceOptions)。
`backgroundColor` / `maxDPR` / `antialias` / `pauseWhenHidden` などが含まれます。[パフォーマンスチューニング](./customize/performance.md)を参照してください。

## 自分で実装するインターフェース

拡張ポイントです。こちらがプレイヤーから**呼ばれる**側になります。

| インターフェース | 実装するのはどんなとき |
|---|---|
| [`IAudioManager`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/interfaces/IAudioManager) | アニメーションのサウンドを自前のオーディオエンジンで鳴らしたいとき。`@spritestudio/ssplayer-core` に既製の `SSWebAudioManager`（`/audio` サブパス）が用意されているので、そのまま使うこともできます。 |
| [`IResourceManager`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/interfaces/IResourceManager) | レンダラーを自作するとき、またはテクスチャを兄弟ファイル以外から供給したいとき。[リソースとライフサイクル](./customize/resources.md)を参照。 |
| [`InstancePackProvider`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/type-aliases/InstancePackProvider) | インスタンスパーツの参照先パックが URL で辿れないとき（インメモリのバンドル、ドラッグ＆ドロップなど）。 |

## 変換 API

`@spritestudio/ssconverter-core` はプレイヤーとは独立した別系統の API です。
[`convertProject`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssconverter-core/functions/convertProject)、
[`locateProject`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssconverter-core/functions/locateProject)、
[`ConvertOptions`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssconverter-core/interfaces/ConvertOptions) を参照。使い方は[アセットの準備](./usage/assets.md)にあります。

---

これ以外のすべては **[生成 API リファレンス](https://cri-middleware.github.io/SSPlayerForWeb/api/)** にあります。
