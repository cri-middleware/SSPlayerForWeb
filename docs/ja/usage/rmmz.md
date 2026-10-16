---
description: RPG ツクール MZ 向けの ssplayer-rmmz プラグイン。インストール、変換、プラグインコマンド、デプロイ、音声、既知の制限。
---

# RPG ツクール MZ で使う

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

::: warning ベータ版
`@spritestudio/ssplayer-rmmz` は **ベータ版**です。描画は [`ssplayer-webgl`](/ja/usage/webgl) の
`SSWebGLRenderer` を土台にしています。
:::

このプラグインを使うと、**RPG ツクール MZ** のゲームで **SpriteStudio**（`.ssab`）のアニメーションを再生できます。アニメーションは MZ の PixiJS v5 レンダラーへ直接描画されるため、キャラクターやピクチャと正しい Z 順で重なります。

▶️ **<a href="../../examples/rmmz/" target="_blank" rel="noreferrer">ライブデモ</a>** —
同梱のサンプル MZ プロジェクトをブラウザーで実行できます。

## しくみ

アニメーションは MZ 自身の **PixiJS v5 レンダラーへ直接描画** されます（MZ の Tilemap や同梱の Effekseer と同じ方式です）。オーバーレイ用の Canvas を重ねないため、キャラクターやピクチャと正しい Z 順で表示されます。

- `SSPlayer` は `PIXI.Container` を継承し、`SSPlayerRenderer`（登録済みの
  `PIXI.ObjectRenderer` `'ssplayer'`）が [`ssplayer-webgl`](/ja/usage/webgl) の
  `SSWebGLRenderer` を MZ 共有の `gl` に対して再利用します。これにより、マスク・エフェクト・
  13 種の SS 連携シェーダー・インスタンスパーツは WebGL プレイヤーと同じコードで描画されます。
- **非 SIMD（スカラー）版の WASM** を同梱しているため、MZ 同梱の NW.js（WebAssembly SIMD 非対応の
  Chromium）でも起動フラグなしで動作します。初期化に失敗した場合は SS アニメーションが無効化されるだけで、ゲーム自体は起動します。

## 1. インストール

1. [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-rmmz&expanded=true) から `ssplayer-rmmz-plugin-<version>.zip` をダウンロードします。`@spritestudio/ssplayer-rmmz <version>` という名前の Release を開き、**Assets** にあるファイルを取ってください（*Source code* のアーカイブではありません）。中身は `ssplayer-rpgmakermz.js`・`ssruntime_bg.wasm`・`ssconverter_bg.wasm` の 3 つで、`ssconverter_bg.wasm` はテストプレイで `.sspj` を自動変換したい場合にだけ使います（[後述](#convert-on-test-play)）。
2. これらをプロジェクトの `js/plugins/` へフラットに展開します（WASM は `.js` と同じ場所に置く必要があります）。
3. プラグイン管理で **ssplayer-rpgmakermz** を有効化します。パラメーターはありません。WASM はプラグイン `.js` と同じフォルダーから自動で読み込まれます。

## 2. アニメーションの変換（.sspj → .ssab）

`.sspj` は編集用の SpriteStudio プロジェクト、`.ssab` はプラグインが実際に再生するコンパクトなランタイムファイルです。変換方法は [アセットの準備](/ja/usage/assets) を参照してください。

出力は **プロジェクト直下の `spritestudio/` フォルダー** へ置きます。`img/` の中ではなく、
`img/` と並ぶ位置です。デプロイ時に `img/` の中の未使用ファイルは削除されるので（[デプロイ](#_4-deployment) 参照）、そこから出しておくことが素材を守る唯一のポイントです。

```
MyGame/
├── img/                     ← 「未使用ファイルを含まない」で削除される
├── js/plugins/
│   ├── ssplayer-rpgmakermz.js
│   └── ssruntime_bg.wasm
└── spritestudio/            ← 安全
    └── Ringo/
        ├── Ringo.ssab
        └── Ringo.png        ← テクスチャは .ssab と同じ場所に置く
```

`.ssab` の名前はプロジェクト名ではなく、プロジェクト内のアニメーションファイル（`.ssae`）の名前です。コンバーターは `.ssae` 1 つにつき `.ssab` を 1 つ書き出します（`Ringo.ssae` → `Ringo.ssab`）。そのため「SS表示」のパスは `spritestudio/<project>/<アニメーションファイル名>.ssab` になります。テクスチャは `.ssab` からの相対で解決されるため、`.ssab` と同じフォルダーに置いたままにしてください。

### テストプレイで変換する {#convert-on-test-play}

`js/plugins/` に `ssconverter_bg.wasm` を置くと、テストプレイのときにプラグインが変換します。

1. SpriteStudio のプロジェクトを、プロジェクト直下の `SpriteStudio_Source/` に置きます。アニメーションは複数のファイルで構成されるので、**`.sspj` だけでなくフォルダーごと**置いてください。サブフォルダーに入れても構いません。
2. テストプレイを開始します。タイトルの前に、前回の変換から変更のあったプロジェクトがすべて `spritestudio/<project>/` へ変換されます。フォルダー名は `.sspj` の名前で、中の `.ssab` の名前は上と同じく `.ssae` の名前です。
3. SpriteStudio で保存したら、テストプレイ中に **F5** を押します。ゲームが再起動し、その途中で変更が変換されます。

```
MyGame/
├── js/plugins/
│   ├── ssplayer-rpgmakermz.js
│   ├── ssruntime_bg.wasm
│   └── ssconverter_bg.wasm     ← テストプレイで変換する
├── SpriteStudio_Source/        ← プロジェクトはここに置く
│   └── Ringo/
│       ├── Ringo.sspj
│       └── …                   （.ssae・.ssce・テクスチャ）
└── spritestudio/               ← 変換結果はここに書かれる
    └── Ringo/
        ├── Ringo.ssab
        └── Ringo.png
```

変換に失敗したプロジェクトがあると、起動が MZ のエラー画面で止まり、プロジェクト名と理由が表示されます。SpriteStudio で直して保存し、**Retry** を押してください。同じファイル名のプロジェクトが 2 つある場合も止まります（`chara/hero.sspj` と `enemy/hero.sspj` はどちらも `spritestudio/hero/` に書き出すため）。どちらかの名前を変えてください。詳しい内容はコンソール（F8）に出ます。

変換するのはテストプレイのときだけで、デプロイしたゲームでは変換しません。変換するのは変更のあったものだけです（これまでの変換の記録は `SpriteStudio_Source/.ss_import_state.json`）。変換では、前回の変換が書き出して今回は書き出さなかったファイルを消します。フォルダー内のそれ以外のファイルには触れません。音声は変換しません（[5. 音声](#_5-sound) を参照）。デプロイの前にソースを除外してください（[4. デプロイ](#_4-deployment) を参照）。

## 3. プラグインコマンド

イベントの **プラグインコマンド** → `ssplayer-rpgmakermz` から実行します。SS アニメーションは
MZ の **ピクチャ** に載るため、*ピクチャの移動* / 拡大縮小 / Z 順 / セーブ・ロードがそのまま適用されます。

以下のコマンド名は MZ エディター（日本語）に表示される名称です（括弧内は内部のコマンド ID）。

**表示 / 付与**

- **SS表示**（`showSS`）— ピクチャの作成とアニメーションの付与を一括で行います。
- **SSをピクチャに割当**（`setSSAsPicture`）— *ピクチャの表示* で既に表示済みのピクチャへ SS を後付けします。以降は標準の *ピクチャの移動 / 消去* で操作します。

**アニメーション制御**

- **SSアニメ切替**（`changeSSAnimation`）— **同一 `.ssab` 内**の別アニメーションへ再ロードなしで切り替えます。
- **SSワンショット再生**（`playSSOnce`）— 指定回数だけ再生し、**現在のループへ自動的に戻ります**（待機 → 表情 → 待機 など）。
- **SS連続再生**（`playSSSequence`）— カンマ区切りのリストを再生し、末尾以外は各 1 回、**末尾のみループ**します。
- **SS再生速度**（`setSSSpeed`）— 再生速度の倍率です（サブフレーム補間により低速でも滑らかです）。

**SSアニメ切替**・**SSワンショット再生**・**SS連続再生**・**SSリップシンク設定** は `クロスフェード時間（ミリ秒）` を取ります。0 より大きいと、表示中のアニメからその時間をかけてクロスフェードし、0（既定）ならすぐに切り替えます。

**トラック（アニメの重ね合わせ）**

ピクチャ自身のアニメ（トラック 0）の上に、1 番以上のトラックで別のアニメを重ねられます。トラックはピクチャと一緒にセーブされます。ピクチャのアニメをクロスフェード**せずに**切り替えると、プレイヤー本体と同じくトラックは空になります。クロスフェードなら残ります。

- **SSトラック設定**（`setSSTrack`）— トラックにアニメを置きます。`強さ（α）`、`合成方法`（ミックス、またはセットアップポーズからの差分を足す加算）、`ループ回数`、`クロスフェード時間` を指定できます。
- **SSトラックフェード**（`fadeSSTrack`）— トラックの強さを、指定の時間をかけて目標値まで変えます。`完了までウェイト` でフェードが終わるまでイベントを止めます。
- **SSトラック解除**（`clearSSTrack`）— トラックを空にします。徐々に消したい場合は、先に強さ 0 へフェードしてください。

**パーツ上書き（色 / セル / 表示）**

アニメのキーフレームより **優先** して、特定パーツの見た目を実行時に差し替えます。設定はピクチャに保存されるため、**セーブ / ロードをまたいでも復元されます**。

- **SSパーツ色変更**（`setSSPartColor`）— 1 パーツを着色します。色は `#RRGGBB` / `#RRGGBBAA`
  で指定します（MZ に色の引数型が無いため 16 進文字列です）。**通常パーツのみ**。
- **SSパーツ表示切替**（`setSSPartVisibility`）— 1 パーツを強制的に非表示にします。
  `子パーツにも波及` を ON にすると子孫ごと隠せます — アニメの非表示は波及しないため、部位ごと隠すにはこちらを使います。
- **SSパーツセル差替**（`setSSPartCell`）— 1 パーツが描くセルを差し替えます（装備の差し替えなど）。セルマップ名に `.ssce` は付けません。**通常パーツとマスクパーツのみ**。
- **SSパーツ上書き解除**（`clearSSPartOverrides`）— `パーツ名` を空にするとそのピクチャの全パーツが対象です。

**優先度**（色 / セルのみ）は `次のキーフレームに譲る` / `アニメが変わるまで保持`（既定）/ `恒久`
の 3 段階です。アニメを切り替えると **`恒久` 以外は解除されます**（セーブ内容も同時に整理されるため、ロード時に復活することはありません）。表示の上書きに優先度はなく、アニメ切替で必ず解除されます。ただしクロスフェード（`クロスフェード時間` が 0 より大きい切り替え）では、どの上書きも解除されません。

**パーツトラッキング（スクリプト専用）**

自前の表示オブジェクトをパーツに追従させる機能に、**プラグインコマンドはありません**。スクリプトから `SSPlayer` を取得して `attachToPart()` を呼んでください。詳しくは
[パーツトラッキング](/ja/customize/part-following) を参照してください。

**再生 / ライフサイクル**

- **SS再生 / SS一時停止 / SS停止 / SS削除**（`playSS` / `pauseSS` / `stopSS` / `removeSS`）と
  **SS完了待ち**（`waitForSS`）を `pictureId` で操作します。**SS完了待ち** は指定したループ回数をすべて再生し終えるまでイベントを止めます（有限の `loop` を指定してください。`0` は無限ループの別名なので、指定すると止まり続けます）。

**リップシンク（会話ポートレート・上級）**

- **SSリップシンク設定**（`setSSTalk`）— ピクチャを **話者名**（名前ボックス）に紐付け、その話者のメッセージ表示中は `talk`、それ以外は `idle` を再生します。
- **SSリップシンク解除**（`clearSSTalk`）— 紐付けを解除します（会話終了時に実行します）。

`animation` を空にすると先頭が自動選択され、誤った名前を指定するとコンソールに実際の名前一覧が表示されます（MZ エディターは `.ssab` を読めないためドロップダウンを作れません）。

## 4. デプロイ {#_4-deployment}

**SS 素材を `img/` の外に置けば、「未使用ファイルを含まない」は ON のままで構いません。**
公式ヘルプの通り、このオプションが削除対象にするのは次の 3 フォルダーの中だけです。

```
img/   audio/   effects/
```

`.ssab` とテクスチャは本プラグインが動的に読み込むため、ツクールからは未使用に見えます。
`img/` の中に置けば削除されますが、プロジェクト直下の `spritestudio/` はそもそも対象外です。プラグイン `.js` と `ssruntime_bg.wasm` が `js/plugins/` で無事なのと同じ理屈で、登録作業も追加設定も要りません。

例外は音声ファイルです。ツクールは効果音を `audio/se/` からしか再生しないため、このオプションの対象内に置くことになります（[5. 音声](#_5-sound) を参照）。

**ソースを除外する。** デプロイメントはプロジェクトフォルダーを丸ごと書き出すため、編集用の SpriteStudio プロジェクトが入った `SpriteStudio_Source/` もそのままゲームに含まれます。デプロイメントのオプション **［除外するファイル/フォルダ］** に `SpriteStudio_Source,ssconverter_bg.wasm` を入力してください。どちらもゲームの実行には不要です。

::: warning 既存プロジェクトからの移行
素材がまだ `img/spritestudio/` にある場合は、フォルダーごと 1 階層上の `spritestudio/` へ移動し、各「SS表示」「SSをピクチャに割当」コマンドの `SSABファイル` から先頭の `img/` を外してください。
:::

**トレードオフ — 暗号化。** MZ の *画像ファイルの暗号化* も対象は `img/` だけのため、`img/` の外に置いたテクスチャは暗号化されません。テクスチャを暗号化したい場合は、
`.ssab` とテクスチャを分けるのではなく、**`spritestudio/` フォルダーごと `img/` の下（`img/spritestudio/`）へ戻して**ください。`.ssab` は画像ではないので暗号化されませんが、同じフォルダーにあるテクスチャは暗号化され、プラグインが `ImageManager` 経由で読み込むため復号は自動です。ただしその場合は **「未使用ファイルを含まない」を OFF にする** か、デプロイ後に **`img/spritestudio/` フォルダーを出力先へコピーする** 必要があります。

なお `.ssab` やテクスチャが見つからない場合は、ピクチャの画像が見つからないときと同じく、ツクールの「Failed to load」画面にそのファイルのパスを表示してゲームが止まります。ファイルを置き直して Retry を押すと、その場から再開します。

## 5. 音声 {#_5-sound}

サウンドキーは MZ の `AudioManager` を通じて効果音として、ゲームの SE 音量で再生されます。キーのサウンド名（SpriteStudio のサウンドリストでの名前）が、ファイル `audio/se/<名前>.ogg` を指します。元のファイルは、ほかの SE と同じように Ogg Vorbis に変換して置いてください。*音声ファイルの暗号化* もほかの SE と同じく適用されます。

音はキーに指定された回数だけ続けて鳴り、止まります。SpriteStudio の音声に無限ループはありません。ピクチャを消去すると、そのピクチャが鳴らした音だけが止まります。イベントコマンド「SEの停止」は、ほかの SE と一緒にこれらの音も止めます。

**デプロイ。** ツクールは `.ssab` の中身を読めないため、「未使用ファイルを含まない」はアニメーションだけが鳴らす音声ファイルを削除します。公式プラグイン MaterialBase.js の「音声素材のリスト」に 1 つずつ登録するか、このオプションを OFF にしてデプロイしてください。MaterialBase.js は、必要な PluginCommonBase.js と一緒に MZ 本体の `dlc/BasicResources/plugins/official/` にあります。

## 既知の制限

- ピクチャの **色調とブレンドモードは SS アニメーションに適用されません**。*不透明度*・*移動*・*拡大縮小* は適用されます。
- 一部の画面効果は通常のピクチャと挙動が異なります（一部の PIXI フィルターは位置がずれる、など）。MZ 自身のフラッシュ / 色調オーバーレイには影響しません。

## ソースからビルドする {#building-from-source}

```sh
pnpm --filter @spritestudio/ssplayer-rmmz build      # dist/browser/ssplayer-rpgmakermz.js
pnpm --filter @spritestudio/ssplayer-rmmz run pack   # dist/pack/ssplayer-rmmz-plugin-<v>.zip
```

同梱の MZ サンプルで試す場合は次のとおりです。

```sh
pnpm --filter rmmz-example run sync:plugin   # ビルド済みプラグイン + 非 SIMD wasm を js/plugins/ へコピー
pnpm deploy-examples                         # SS-SDK のテストプロジェクトを spritestudio/ へ変換
nw examples/rmmz-example/SampleProject       # テストプレイ（または MZ エディターで開く）
```

サンプルで [テストプレイでの変換](#convert-on-test-play) を試すには、`packages/ssconverter-core/wasm/ssconverter_bg.wasm` を `SampleProject/js/plugins/` にコピーし、SpriteStudio のプロジェクトを `SampleProject/SpriteStudio_Source/` に置きます。どちらも git の管理対象外です。サンプルは Web デモとしても公開され、そこでは変換が動かないため、`sync:plugin` はコンバーターをコピーしません。

NW.js が無い場合は、`examples/rmmz-harness`（PixiJS v5 上の実際の `SSPlayer` /
`SSPlayerRenderer`）のブラウザーハーネスを利用できます。進捗は
[ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-rmmz/ROADMAP.md) を参照してください。
