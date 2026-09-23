# API リファレンス

すべてのエクスポートは[生成リファレンス](/api/)に一覧があります。このページはその地図です。どのクラスから始めるか、その下に何があるか、実際に触れる型はどれかをまとめています。

## 起点となるクラスは 1 つ

自分で構築するプレイヤークラスは、インストールしたレンダラーパッケージのものが**必ず 1 つだけ**です。残りはすべてそこからぶら下がります。

| 環境 | クラス | パッケージ |
|---|---|---|
| フレームワーク非依存 / ドロップイン | [`SSPlayer`](/api/@spritestudio/ssplayer-webgl/classes/SSPlayer.md) | `ssplayer-webgl` |
| HTML だけで済ませたい | `<ss-player>`（[WebGL・Web Components で使う](/ja/usage/webgl)） | `ssplayer-webgl` |
| PixiJS v8 アプリ | [`SSPlayer`](/api/@spritestudio/ssplayer-pixi/classes/SSPlayer.md) | `ssplayer-pixi` |
| レンダラーを自作する | [`DirectInternalPlayer`](/api/@spritestudio/ssplayer-core/classes/DirectInternalPlayer.md) + [`GeometryBuilder`](/api/@spritestudio/ssplayer-core/classes/GeometryBuilder.md) | `ssplayer-core` |

WASM ランタイムはモジュールレベルのシングルトンなので、どちらのプレイヤークラスもインスタンスを作る前に一度だけ初期化が必要です。

```ts
await SSSurface.initialize();  // または SSPlayer.initialize()
```

::: tip 同じシンボルが 3 回出てくる理由
各レンダラーパッケージは **`ssplayer-core` を再エクスポート**しています。そのため
`SSRuntimeManager` / `IResourceManager` / `BlendType` などは、生成リファレンスの 3 つのパッケージページすべてに現れます。実体は同じ宣言です。**インストールしたパッケージから
import** してください。コアの型を使いたいだけの理由で、レンダラーと併せて `ssplayer-core` を追加インストールする必要はありません。
:::

## 下に何があるか

スタックトレースや補完候補で見慣れないところに出たときの手がかりです。

```
SSPlayer / SSPlayer          ← 呼び出すファサード（再生・イベント・オーバーライド）
  └─ DirectInternalPlayer          ← InternalPlayerBase を継承。ロードと描画プランを保持
       └─ SSRuntimeManager         ← WASM 境界。フレームデータを zero-copy な型付き配列ビューで公開
            └─ SSRuntimeContext    ← wasm-bindgen のハンドル（生成物。直接触る必要はありません）
```

いずれも public ですが、下に降りるほど「そのときランタイムが出力しているもの」という契約に近づきます。レンダラーを書くのでなければ、ファサードに留まってください。

## 実際に触れる型

**イベント** — [イベントとユーザーデータ](/ja/customize/events)を参照。
[`SSUserDataEvent`](/api/@spritestudio/ssplayer-webgl/interfaces/SSUserDataEvent.md)、
[`SSSignalEvent`](/api/@spritestudio/ssplayer-webgl/interfaces/SSSignalEvent.md)、
[`SSAudioEvent`](/api/@spritestudio/ssplayer-webgl/interfaces/SSAudioEvent.md)、および
`onX` メソッドが返す解除ハンドル
[`Unsubscribe`](/api/@spritestudio/ssplayer-webgl/type-aliases/Unsubscribe.md)。

**パーツオーバーライド** — [パーツ制御](/ja/customize/part-overrides)を参照。
[`SSBlendOp`](/api/@spritestudio/ssplayer-core/enumerations/SSBlendOp.md)、
[`SSOverridePriority`](/api/@spritestudio/ssplayer-core/enumerations/SSOverridePriority.md)、
[`SSPartOverrideTarget`](/api/@spritestudio/ssplayer-core/interfaces/SSPartOverrideTarget.md)。

**テクスチャ差し替え** — [テクスチャ差し替え（着せ替え）](/ja/customize/texture-replacement)を参照。
`setCellmapTexture` / `getReplaceableTextureNames` は `SSPlayer` にあり、各エンジンのテクスチャオブジェクトを渡します（インポートすべき専用型はありません）。

**パーツトラッキング** — [パーツトラッキング](/ja/customize/part-following)を参照。
[`SSPartFollowOptions`](/api/@spritestudio/ssplayer-core/interfaces/SSPartFollowOptions.md)、
[`SSDecomposedTransform`](/api/@spritestudio/ssplayer-core/interfaces/SSDecomposedTransform.md)、
PixiJS ではさらに
[`SSPartAttachment`](/api/@spritestudio/ssplayer-pixi/type-aliases/SSPartAttachment.md)。

**再生系の enum。**
`setPlaybackDirection` の 2 引数が
[`WebPlaybackDirection`](/api/@spritestudio/ssplayer-core/enumerations/WebPlaybackDirection.md) と
[`WebPlaybackStyle`](/api/@spritestudio/ssplayer-core/enumerations/WebPlaybackStyle.md) です。

**構築オプション**（WebGL のみ）—
[`SSSurfaceOptions`](/api/@spritestudio/ssplayer-webgl/interfaces/SSSurfaceOptions.md)。
`backgroundColor` / `maxDPR` / `antialias` / `pauseWhenHidden` などが含まれます。[パフォーマンスチューニング](/ja/customize/performance)を参照してください。

## 自分で実装するインターフェース

拡張ポイントです。こちらがプレイヤーから**呼ばれる**側になります。

| インターフェース | 実装するのはどんなとき |
|---|---|
| [`IAudioManager`](/api/@spritestudio/ssplayer-core/interfaces/IAudioManager.md) | アニメーションのサウンドを自前のオーディオエンジンで鳴らしたいとき。`@spritestudio/ssplayer-core` に既製の `SSWebAudioManager`（`/audio` サブパス）が用意されているので、そのまま使うこともできます。 |
| [`IResourceManager`](/api/@spritestudio/ssplayer-core/interfaces/IResourceManager.md) | レンダラーを自作するとき、またはテクスチャを兄弟ファイル以外から供給したいとき。[リソースとライフサイクル](/ja/customize/resources)を参照。 |
| [`InstancePackProvider`](/api/@spritestudio/ssplayer-core/type-aliases/InstancePackProvider.md) | インスタンスパーツの参照先パックが URL で辿れないとき（インメモリのバンドル、ドラッグ＆ドロップなど）。 |

## 変換 API

`@spritestudio/ssconverter-core` はプレイヤーとは独立した別系統の API です。
[`convertProject`](/api/@spritestudio/ssconverter-core/functions/convertProject.md)、
[`locateProject`](/api/@spritestudio/ssconverter-core/functions/locateProject.md)、
[`ConvertOptions`](/api/@spritestudio/ssconverter-core/interfaces/ConvertOptions.md) を参照。使い方は[アセットの準備](/ja/usage/assets)にあります。

---

これ以外のすべては **[生成 API リファレンス](/api/)** にあります。
