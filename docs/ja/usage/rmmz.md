# RPG ツクール MZ で使う

::: warning 実験的 / アルファ版
`@spritestudio/ssplayer-rmmz` は **実験的なアルファ版**（`7.0.0-alpha.1`）です。パッケージは
**private で、npm には公開されていません**。描画は [`ssplayer-webgl`](/ja/usage/webgl) の
`SSWebGLRenderer` を土台にしています。

**リリースはまだ 1 つもありません。** 正式リリース後はプラグイン ZIP が
**GitHub Releases** で配布される予定ですが、現時点で入手する唯一の方法は
[ソースからのビルド](#ソースからビルドする)です。npm からのインストールはできません。
:::

このプラグインを使うと、**RPG ツクール MZ** のゲームで **SpriteStudio 7**（`.ssab`）の
アニメーションを再生できます。アニメーションは MZ の PixiJS v5 レンダラーへ直接描画されるため、
キャラクターやピクチャと正しい Z 順で重なります。

▶️ **[ライブデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/)** —
同梱のサンプル MZ プロジェクトをブラウザーで実行できます（最初のリリース公開後に有効化されます 🚧）。

## しくみ

アニメーションは MZ 自身の **PixiJS v5 レンダラーへ直接描画** されます（MZ の Tilemap や
同梱の Effekseer と同じ方式です）。オーバーレイ用の Canvas を重ねないため、キャラクターや
ピクチャと正しい Z 順で表示されます。

- `SSPlayer` は `PIXI.Container` を継承し、`SSPlayerRenderer`（登録済みの
  `PIXI.ObjectRenderer` `'ssplayer'`）が [`ssplayer-webgl`](/ja/usage/webgl) の
  `SSWebGLRenderer` を MZ 共有の `gl` に対して再利用します。これにより、マスク・エフェクト・
  13 種の SS 連携シェーダー・インスタンスパーツがそのまま動作します。
- **非 SIMD（スカラー）版の WASM** を同梱しているため、MZ 同梱の NW.js（WebAssembly SIMD 非対応の
  Chromium）でも起動フラグなしで動作します。初期化に失敗した場合は SS アニメーションが無効化される
  だけで、ゲーム自体は起動します。

## 1. インストール

1. `ssplayer-rpgmakermz.js` **と** `ssruntime_bg.wasm` を用意します。**まだリリースが公開されて
   いない**ため、当面は自分でビルドしてください（[ソースからビルドする](#ソースからビルドする)）。
   最初のリリース後は **GitHub Releases** からプラグイン ZIP をダウンロードできるようになります。
2. **両方**をプロジェクトの `js/plugins/` へフラットに置きます（WASM は `.js` と同じ場所に
   置く必要があります）。
3. プラグイン管理で **ssplayer-rpgmakermz** を有効化します。パラメーターはありません。WASM は
   プラグイン `.js` と同じフォルダーから自動で読み込まれます。

## 2. アニメーションの変換（.sspj → .ssab）

`.sspj` は編集用の SpriteStudio プロジェクト、`.ssab` はプラグインが実際に再生する
コンパクトなランタイムファイルです。変換方法は [アセットの準備](/ja/usage/assets) を参照して
ください。出力は `img/spritestudio/<project>/` 以下へ置き、「SS表示」のパス
`img/spritestudio/<project>/<project>.ssab` に合わせます。

## 3. プラグインコマンド

イベントの **プラグインコマンド** → `ssplayer-rpgmakermz` から実行します。SS アニメーションは
MZ の **ピクチャ** に載るため、*ピクチャの移動* / 拡大縮小 / Z 順 / セーブ・ロードがそのまま
適用されます。

以下のコマンド名は MZ エディター（日本語）に表示される名称です（括弧内は内部のコマンド ID）。

**表示 / 付与**

- **SS表示**（`showSS`）— ピクチャの作成とアニメーションの付与を一括で行います。
- **SSをピクチャに割当**（`setSSAsPicture`）— *ピクチャの表示* で既に表示済みのピクチャへ SS を
  後付けします。以降は標準の *ピクチャの移動 / 消去* で操作します。

**アニメーション制御**

- **SSアニメ切替**（`changeSSAnimation`）— **同一 `.ssab` 内**の別アニメーションへ
  再ロードなしで切り替えます。
- **SSワンショット再生**（`playSSOnce`）— 指定回数だけ再生し、**現在のループへ自動的に戻ります**
  （待機 → 表情 → 待機 など）。
- **SS連続再生**（`playSSSequence`）— カンマ区切りのリストを再生し、末尾以外は各 1 回、
  **末尾のみループ**します。
- **SS再生速度**（`setSSSpeed`）— 再生速度の倍率です（サブフレーム補間により低速でも滑らかです）。

**再生 / ライフサイクル**

- **SS再生 / SS一時停止 / SS停止 / SS削除**（`playSS` / `pauseSS` / `stopSS` / `removeSS`）と
  **SS完了待ち**（`waitForSS`）を `pictureId` で操作します。**SS完了待ち** は指定したループ回数を
  すべて再生し終えるまでイベントを止めます（有限の `loop` を指定してください。`0` は無限ループの
  別名なので、指定すると止まり続けます）。

**リップシンク（会話ポートレート・上級）**

- **SSリップシンク設定**（`setSSTalk`）— ピクチャを **話者名**（名前ボックス）に紐付け、その話者の
  メッセージ表示中は `talk`、それ以外は `idle` を再生します。
- **SSリップシンク解除**（`clearSSTalk`）— 紐付けを解除します（会話終了時に実行します）。

`animation` を空にすると先頭が自動選択され、誤った名前を指定するとコンソールに実際の名前一覧が
表示されます（MZ エディターは `.ssab` を読めないためドロップダウンを作れません）。

## 4. デプロイ時の注意 ⚠️

**「未使用ファイルを含めない」設定はアニメーションを削除します。** `img/spritestudio/` 以下の
`.ssab` やテクスチャは動的に読み込まれるため、MZ のデプロイ機能は未使用とみなして削除します。
この設定を **オフにする** か、デプロイ後に `img/spritestudio/` を出力へ **コピーして** ください
（旧 SS6Player プラグインと同じ注意点です）。

## 既知の制限

- ピクチャの **不透明度 / 色調は SS アニメーションに適用されません**（常に不透明で描画されます）。
  *移動* と *拡大縮小* は適用されます。
- 一部の画面効果は通常のピクチャと挙動が異なります（一部の PIXI フィルターは位置がずれる、
  ループ効果音は 1 回だけ再生される、など）。MZ 自身のフラッシュ / 色調オーバーレイには影響しません。

不透明度 / 色調と投影の制限は、`SSWebGLRenderer` に投影行列と alpha/tint uniform を注入する
小規模な拡張で解消できる見込みで、今後の対応予定です。

## ソースからビルドする

```sh
pnpm --filter @spritestudio/ssplayer-rmmz build      # dist/browser/ssplayer-rpgmakermz.js
pnpm --filter @spritestudio/ssplayer-rmmz pack       # dist/pack/ssplayer-rmmz-plugin-<v>.zip
```

同梱の MZ サンプルで試す場合は次のとおりです。

```sh
pnpm --filter rmmz-example run sync:plugin   # ビルド済みプラグイン + 非 SIMD wasm を js/plugins/ へコピー
pnpm deploy-examples                         # SS-SDK のテストプロジェクトを img/spritestudio/ へ変換
nw examples/rmmz-example/SampleProject       # テストプレイ（または MZ エディターで開く）
```

NW.js が無い場合は、`examples/rmmz-harness`（PixiJS v5 上の実際の `SSPlayer` /
`SSPlayerRenderer`）のブラウザーハーネスを利用できます。進捗は
[ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md) を
参照してください。
