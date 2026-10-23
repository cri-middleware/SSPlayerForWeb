---
description: SpriteStudio Player for Web を開発・改造する人向け。パッケージの構成、変更したビルドの使い方、RPG ツクール MZ と Tyrano 系ホストでの確かめ方、プラグインがこの作りになっている理由。
---

# 開発者向けガイド

このページは、SpriteStudio Player for Web を開発する人と、自分のプロジェクトのために改造する人に向けたものです。サイトのほかのページより読み手に求めるものが多く、ファイル名を挙げて説明し、ビルドの通るチェックアウトがある前提で書いています。セットアップ・ビルド・テスト・ドキュメントサイトは [CONTRIBUTING](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/CONTRIBUTING.md) にあります。各パッケージの README の末尾にはコントリビューター向けの節があり、そのパッケージの内部を説明しています。このページは、それらをまたぐ地図です。

SpriteStudio の Player に共通すること（再生・モーションブレンド・サウンドキー・パーツトラッキングの振る舞い）は、SDK の[ポーティングガイド](https://github.com/cri-middleware/SpriteStudio-SDK/tree/develop/libs/ssruntime/docs)に一度だけ書いてあります。

## 1. 構成 {#how-it-is-put-together}

ワークスペースは、ページやゲームの中で動く再生側と、`.sspj` を `.ssab` に変える変換側に分かれます。どのパッケージがどれの上に載っているかは、README の[構成図](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/README.ja.md#monorepo-構成)にあります。

| パッケージ | 役割 | 読み始める場所 |
|---|---|---|
| `ssplayer-core` | ランタイムの WASM と、そのフレームを描画データに変える部分。DOM にもエンジンにも依存しない。 | `SSRuntimeManager.ts`（WASM の初期化とランタイムのアクセサ）、`InternalPlayerBase.ts`（再生中のアニメ 1 つ）、`GeometryBuilder.ts`・`MaskPlanner.ts`・`EffectBatchPlanner.ts`（描画データ）。`src/ss/` は生成コード。 |
| `ssplayer-webgl` | 素の WebGL で描く独自のレンダラーと `<ss-player>` | `SSWebGLRenderer.ts`（描画）、`SSPlayer.ts`（プレイヤーとそのイベント）、`SSSurface.ts`（canvas とティッカー）、`SSOverlay.ts`（DOM 要素で位置を決める複数のプレイヤーを 1 枚の canvas に描く）、`element.ts` |
| `ssplayer-pixi` | PixiJS v8 の表示オブジェクト | `SSPlayer.ts`、`SSShaderLib.ts`、`SSBlendModes.ts` |
| `ssplayer-rmmz` | RPG ツクール MZ のプラグイン | [下記](#rpg-maker-mz) |
| `ssplayer-tyranoscript` | `[ss_*]` タグ。ティラノビルダーと TyranoStudio でもランタイム側になる | [下記](#tyranoscript) |
| `ssplayer-tyranobuilder` | ティラノビルダーのエディタ側（コンポーネントと自動インポート） | [下記](#tyranobuilder) |
| `ssconverter-core` | コンバーターの WASM。プロジェクトのバイト列を受け取り、`.ssab` のバイト列を返す | `src/index.ts` |
| `ssconverter-importer` | エディタ用プラグインが共有する自動インポート。ティラノビルダーはプロジェクトを開いたとき、MZ はテストプレイの開始時に走らせる | `autoImporter.ts`（1 回の変換と記録ファイル）、`converter.ts`（Worker）、`hostFs.ts`（ホストのファイルシステム）、`importLog.ts`。ホストが渡すものは [README](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssconverter-importer/README.ja.md) にある。 |
| `ssconverter-web` | 変換ページとその Node CLI | `src/main.ts`、`scripts/cli.js` |

### RPG ツクール MZ {#rpg-maker-mz}

`ssplayer-rmmz` は IIFE を 1 本、`dist/browser/ssplayer-rpgmakermz.js` としてビルドし、MZ が表示するプラグインのヘルプを `src/plugin-annotation.js` から先頭に付けます。レンダラーと起動待ちの詳細は [README](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-rmmz/README.ja.md) のコントリビューター向けの節にあります。

| ファイル | 役割 |
|---|---|
| `src/plugin.ts` | 入口。レンダラーの登録、WASM の初期化開始、ピクチャとの橋渡しの設置、プラグインコマンドの登録 |
| `src/SSPlayer.ts` | プレイヤーを 1 つ持つ `PIXI.Container`。自前のタイマーは持たない。 |
| `src/SSPlayerRenderer.ts` | MZ の `gl` の上で `SSWebGLRenderer` を通して描く `PIXI.ObjectRenderer` |
| `src/rmmz/boot.ts` | WASM の準備ができるまで MZ の起動を待たせる |
| `src/rmmz/gamePictureBridge.ts`、`Sprite_SpriteStudio.ts` | アニメは `Game_Picture` に属するのでゲームと一緒にセーブされ、`Sprite_Picture` の子が描く |
| `src/rmmz/RMMZResourceManager.ts`、`RMMZAudioManager.ts` | テクスチャは `ImageManager`、音は `AudioManager` を通す |
| `src/rmmz/autoImport.ts` | テストプレイ時の変換。`ssconverter-importer` の上に載る |
| `src/rmmz/liveRegistry.ts`、`interpreterWait.ts`、`messageTalk.ts`、`playAnimation.ts` | ピクチャ番号ごとの再生中プレイヤー、アニメの終了待ち、メッセージ表示中の口パク、アニメの切り替え |
| `src/plugin-annotation.js` | プラグインのヘルプとパラメータ（英語と日本語の `/*:ja`） |

### TyranoScript {#tyranoscript}

`ssplayer-tyranoscript` は、読み込まれるとタグを登録する IIFE、`dist/browser/main.js` をビルドします。読み込むのはプラグインの `init.ks` です。座標・セーブデータ・音の経路は [README](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-tyranoscript/README.ja.md) のコントリビューター向けの節にあります。

| ファイル | 役割 |
|---|---|
| `src/plugin.ts` | 入口 |
| `src/registerTags.ts` | すべての `[ss_*]` タグ |
| `src/LayerCanvas.ts` | Tyrano のレイヤー上にキャラクターごとの `<div>` を置き、レイヤーごとに canvas を 1 枚持つ（`SSOverlay`） |
| `src/PlayerRegistry.ts` | 名前付きのプレイヤーと、それぞれに予約された次のアニメ |
| `src/SaveLoadBridge.ts` | セーブに入れるものと、ロード時の作り直し |
| `src/CharaTalkBridge.ts` | `[ss_chara]`。テキストの表示中に口パクする |
| `src/TyranoAudioManager.ts` | サウンドキーを howler で鳴らす |
| `src/storagePath.ts` | `storage=` を、エンジンが自分のものを解決するのと同じ方法で解決する |
| `plugin/` | `init.ks` と `readme.txt`。プラグイン ZIP の元になるテンプレート |

### ティラノビルダー {#tyranobuilder}

1 つのプラグインフォルダに 2 つの半分が入ります。このパッケージからビルドするエディタ用の `ssplayer.builder.js` と、ゲーム用の TyranoScript の `main.js` です。中身は `scripts/pluginFiles.mjs` が列挙し、`scripts/pack-tbp.mjs` が `ssplayer.tbp` にまとめます。

| ファイル | 役割 |
|---|---|
| `src/plugin.builder.ts` | プロジェクトを開いたときにビルダーが生成する入口。インポートを走らせ、コンポーネントを登録し、結果を知らせる |
| `src/builderImporter.ts` | ビルダーが使う形の共有インポーターと、アニメデータ 1 つの **今すぐ再変換** |
| `src/components.ts` | パレットのコンポーネント。`[ss_*]` タグ 1 つに 1 つ |
| `src/managerPanel.ts` | プラグイン管理画面のパネル（**今すぐ取り込む**） |
| `src/buttonParam.ts` | コンポーネントのインスペクタに置く本物のボタン |
| `src/packContents.ts` | インスペクタの選択肢。`.ssab` から読む |
| `src/studioFs.ts`、`src/builderTypes.d.ts` | ビルダーがプラグインに見せる面（`window.studio_api`、`TB`）。Ver 3.00 の実物から読んだもの |
| `lang/ja.json` | エディタに表示する日本語の文字列 |

## 2. 変更した Player を使う {#using-a-changed-player}

サイトのほかのページは、リリースが公開したものをインストールします。変更を自分のアプリやゲームで試すには、同じ成果物をチェックアウトからビルドします。

```sh
scripts/build-release.sh        # Windows: scripts\build-release.ps1
```

`release-dist/npm/*.tgz`（npm パッケージ）と `release-dist/plugins/`（MZ の ZIP、TyranoScript の ZIP、`ssplayer.tbp`）を書き出します。版は作業ツリーにあるものです。SDK の WASM は `scripts/SDK_VERSION.txt` のリリースから取ります。変更が `SpriteStudio-SDK` サブモジュールにあるときは `sdk=build` を付けると、そこからコンパイルします（Rust と wasm-pack が要ります）。`skip=` で外せる段は `--help` にあります。

- **npm パッケージ**: アプリが使う tarball を、アプリが import するものとその依存先をまとめて、1 回のコマンドでインストールします。

  ```sh
  npm install <checkout>/release-dist/npm/spritestudio-ssplayer-core-<version>.tgz <checkout>/release-dist/npm/spritestudio-ssplayer-webgl-<version>.tgz
  ```

  tarball は依存先を版で指定しているため、`ssplayer-webgl` だけを入れると、`ssplayer-core` は手元のものではなく npm のリリース版が入ります。
- **RPG ツクール MZ**: MZ の ZIP をゲームの `js/plugins/` に展開します。作者が行う手順と同じです。
- **TyranoScript**: TyranoScript の ZIP の `ssplayer/` を、ゲームの `data/others/plugin/` に展開します。
- **ティラノビルダー**: `ssplayer.tbp` をビルダーからインストールします。ダイアログを省くなら、`node packages/ssplayer-tyranobuilder/scripts/install.mjs <project>` が同じファイルをプロジェクトに直接コピーします。オプションはパッケージの [README](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-tyranobuilder/README.ja.md) にあります。

繰り返し試す間は、パッケージ 1 つの `build` と、同梱のサンプルの `sync:plugin` で足ります。コマンドは各プラグインの README のコントリビューター向けの節にあります。

## 3. 実際のホストで確かめる {#checking-against-the-real-host}

パッケージのテストは、MZ と TyranoScript の代役を相手に走ります。実際のホストでしか分からないこと（タイミング、セーブの仕組み、エディタ）は、ホストを動かして確かめます。以下はどれもホストの GUI を操作せずに回せます。パスは macOS のものです。

### ホストの表記の引き方 {#where-the-hosts-labels-come-from}

ガイドでは、メニュー・ダイアログ・オプションの名前をホストの表示どおりに書きます。名前はホストの実物から引きます。

- **RPG ツクール MZ**: 英語の表記はエディタのバイナリ（`RPGMZ.app/Contents/MacOS/RPGMZ`）に ASCII で入っていて、`grep -a` で見つかります。日本語の表記は同じバイナリの Qt の翻訳に **UTF-16BE** で入っていて、UTF-8 で探しても見つかりません。UTF-16BE のバイト列で探してください。文字列の隣にあるコンテキスト名（デプロイメントの画面なら `Layout_DeploymentOptions`）で、どの画面のものかが分かります。同梱のヘルプ（`Contents/Resources/help-ja/`）でも確かめられます。
- **ティラノビルダー**（`TyranoBuilder.app/Contents/Resources/app/` の下）: メニューは `js/main/MenuBar.js`、各ウィンドウの文字列は `template/window/*.tmpl.html`、英語の UI は `lang/en.json`（キーが日本語の原文）です。
- **プラグイン側の表記**: MZ は `src/plugin-annotation.js` の `@text` の行、ティラノビルダーは `lang/ja.json` です。

### RPG ツクール MZ {#checking-rpg-maker-mz}

RPG ツクール MZ に同梱の NW.js は、プロジェクトのフォルダをそのまま実行できます（`RPGMZ.app/Contents/Resources/nwjs-mac/nwjs.app/Contents/MacOS/nwjs <project> test`）。エディタのテストプレイと同じランタイムで、WebAssembly SIMD はありません。**`test` を付けてください。** MZ はテストプレイかどうかを最初の引数から読む（`Utils.isOptionValid`）ので、付けずに起動するとデプロイ後のゲームと同じ扱いになり、テストプレイ時の変換が走りません。

人が操作せずに確かめるには、`examples/rmmz-example/SampleProject` などのプロジェクトを repo の外にコピーし、自分で書いたプラグインをその `js/plugins/` と `js/plugins.js` に足します。そのプラグインがゲームを進め、結果を `require('fs')` で書き、`nw.App.quit()` を呼ぶようにします。突き止めるのに時間がかかったこと:

- MZ はウィンドウにフォーカスが無いとシーンを更新しません（`SceneManager.isGameActive()`）。裏のウィンドウでアニメが止まるのは MZ の挙動で、プラグインのせいではありません。
- フレームは `requestAnimationFrame` ではなく `Graphics.frameCount` で数えます。ゲームが止まっている間もアニメーションフレームは来るので、それで数えた確認はずれて不安定になります。
- `DataManager.setupNewGame(); SceneManager.goto(Scene_Map)` でタイトル画面を飛ばせます。
- MZ 1.x には `SceneManager.renderScene` がありません。`Graphics._app.renderer.on('postrender', …)` に処理を掛け、そこで `gl.readPixels` で画素を読みます（行は下から数えます）。
- 毎フレーム記録して、異なる値の数を数えます。Ringo の `attack1` は 20 フレームなので、60 フレームおきに覗くと常に同じフレームが見えます。
- 存在しないファイルの fetch は 404 を返さず、reject されます（`TypeError: Failed to fetch`）。
- 読み込みの失敗は、更新中に投げられる MZ の `["LoadError", url, retry]` です。これでシーンのループが止まり、`Graphics.frameCount` も止まります。エラー画面をまたぐ確認は `setTimeout` で刻みます。Retry は `#retryButton` です。
- MZ が効果音として鳴らすのは `audio/se/<name>.ogg` だけです。`WebAudio.prototype.play` と `stop` を包めば、何が鳴ったか（`buffer.name`）を記録できます。

MZ が無い環境では、`examples/rmmz-harness`（`pnpm --filter rmmz-harness dev`）が本物の `SSPlayer` と `SSPlayerRenderer` を PixiJS v5 の上で動かします。代役にしているのは MZ の `ImageManager` と `Bitmap` だけです。公開しているサンプル（このサイトの `examples/rmmz/`）は、ヘッドレスのブラウザでは 1 回クリックしてフォーカスを与えるまで、黒いスプラッシュ画面のまま止まります。

### TyranoScript {#checking-tyranoscript}

`examples/tyranoscript-example` は、エンジンを除いた TyranoScript のプロジェクトです。エンジンの取得とプロジェクトの配信は、その README にあります。スクリプトから動かすには、Chrome をヘッドレスで起動し（`--headless=new --remote-debugging-port=<port> --use-angle=swiftshader --enable-unsafe-swiftshader --user-data-dir=<scratch>`）、DevTools プロトコルでページに繋ぎます。ヘッドレスのページは表示中として扱われるので、`requestAnimationFrame` が回ります。

- `TYRANO.kag.ftag.master_tag.ss_play` があれば、タグの準備ができています。
- `first.ks` をクリックで進める代わりに、使い捨ての `data/scenario/zz_*.ks` を書き、`TYRANO.kag.ftag.startTag('jump', { storage, target })` で飛びます。終わったら消します。
- `kag.error` は `alert` です。`Page.javascriptDialogOpening` で受けて、`Page.handleJavaScriptDialog` で閉じます。スキップは `TYRANO.kag.setSkip(true)` です。
- `[ss_new]` が失敗してもシナリオは止まらず、次のタグが `player "…" not found` を出します。本当のエラーはその上の `[ss] ss_new failed:` の行です。
- サンプルの `.ssab` は `pnpm deploy-examples`、プラグインは `sync:plugin` が配ります。SDK を上げたら両方を配り直してください。`.ssab` より古いランタイムはそれを読めず、`ssruntime_bg.wasm` はサイズが同じでも中身が変わるので、`packages/ssplayer-core/dist/` とハッシュで比べます。

イベントを試すデータ: SDK の `tests/overall/overall.sspj` を `node packages/ssconverter-web/scripts/cli.js -o <dir> <overall.sspj>` で変換します。`Signal.ssab` は `anime_1` の 10 フレーム目でシグナルを出し、`Sound.ssab` はサウンドキーを鳴らします。どちらも MZ でも使えます。

### ティラノビルダー {#checking-tyranobuilder}

エディタのウィンドウには DevTools が無いので、インポーターの報告は `<project>/ss_import_log.txt` を見ます。ゲーム側のエラーは **プロジェクト → デバッグ実行**（英語の UI では **Project → Debug**）で追います。DevTools が開くのはこのプレビューだけです。通常のプレビューもプロジェクトを `file://` で読み、そこでも `fetch` は通ります。TyranoScript では再生されるのにビルダーでは出ないアニメは `file://` の問題ではないので、まずコンソールを取ってください。

**本物のエディタを操作する**: `TyranoBuilder.app/Contents/MacOS/TyranoBuilder --remote-debugging-port=<port>` で起動すると、エディタに DevTools の接続口（`http://127.0.0.1:<port>/json`）ができます。

- コンポーネントは `app.component.insertComponent(tag, index, <直前のコンポーネントの c.j_component>)` で足し、値は `app.component.changeParam(c, key, value)` で入れます。5 番目の引数に `{ pm }` を渡すと、既定値がすべて消えます。
- コンポーネントが書き出すタグは `app.component.createTyranoScriptCode(c)` で見られます。
- プレビュー（シナリオタブの ▶）は `/json` に別のターゲットとして出ます。`scene1.ks`・`first.ks`・`_preview.ks` を実際に書くので、先に `data/scenario` を退避してください。
- プレビュー内の `kag.error` はネイティブのダイアログで、プロトコルからは閉じられません。そのウィンドウを `/json/close/<id>` で閉じたら、エディタを起動し直してください。そのセッションではプレビューが開かなくなります。
- 終了は `kill -9` です。通常の kill は未保存の確認ダイアログで止まり、ポートも残ります。

**ビルダーの Electron でプラグインをヘッドレスに動かす**: `TyranoBuilder.app` は Electron のランタイムなので、コピーの `Contents/Resources/app/` を自分の小さなテスト用アプリに置き換えると、ビルダーの Electron と `webPreferences` のもとで、ウィンドウを出さずにプラグインを動かせます。

1. アプリをコピーします（APFS なら `cp -Rc` で複製されます）。
2. コピーの `Contents/Resources/app/` を、自分の `package.json`・`main.js`・`preload.js`・ページに置き換えます。preload はビルダーのものと同じように `studio_api` を公開し、`fs-extra` はビルダー自身の `node_modules` から require します。
3. コピーにアドホック署名をします（`codesign --force --deep --sign - <copy>.app`）。署名しないと、macOS が起動直後に何も言わずに止めます。
4. `Contents/MacOS/TyranoBuilder` を実行します。ページはビルダーと同じ方法でプラグインを読み込み（`await import('file://…/ssplayer.builder.js')` のあと、`{ $, getProjectPath }` を持つ `TB` で `new module.plugin_setting(TB)`）、結果を書いて終了します。

対象には本物のプロジェクトではなく、プロジェクトの `data/` のコピーを渡してください。プラグインは実際に変換し、ログにも追記します。エディタのスレッドの停止は `setInterval` の間隔の開きで測ります。`requestAnimationFrame` は非表示のウィンドウで間引かれるためです。読み込みの前に `Worker` を消すと、スレッド内で変換するフォールバックを同じ条件で比べられます。Node から起動するときは `stdio: 'ignore'` にしてください。

### TyranoStudio {#checking-tyranostudio}

TyranoStudio は同梱の TyranoScript でゲームを動かすので、そこで動くのは TyranoScript 用のプラグインです。ライセンスがアプリの改造を禁じているので、起動フラグだけで確かめます（`Contents/MacOS/TyranoStudio --remote-debugging-port=<port>`）。プレビューは別の Electron ウィンドウで、プロジェクトの `index.html` を `file://` で開き、`TYRANO.kag.is_studio === true` になります。ここでも `kag.error` はネイティブのダイアログなので、リロードの前に初期化スクリプトで `window.alert` を置き換えてください。

ティラノビルダーと TyranoStudio は Electron のユーザーデータのフォルダ（`~/Library/Application Support/studio`）を共有していて、`localStorage` も共有します。片方のプレビューで作ったセーブがもう片方にも出るので、起動中のアプリから `localStorage.removeItem` で消してください。

### ブラウザ {#checking-in-a-browser}

`SSSurface` は `document.hidden` の間は止まります（`pauseWhenHidden`、既定で有効）。そのため裏のタブのページは `0.0 / 0` のまま動かず、WebGL と PixiJS のサンプルのどちらでも同じです。`<ss-player>` はティッカーが回る前に 1 フレーム描くので、裏のタブでも絵は出ます。確かめるのは表示中のタブか、上のヘッドレスの Chrome です。

## 4. この作りになっている理由 {#why-it-is-built-the-way-it-is}

ここに挙げる理由はどれも複数のファイルにまたがります。詳細は、それぞれが指すコードにあります。

**ホストごとのプラグインは、ホスト自身の GL コンテキストに描きます。** `ssplayer-rmmz` は MZ のレンダラーに `PIXI.ObjectRenderer` を登録し、生の描画の前後で、MZ 自身の Effekseer のスプライトと同じ状態の保存と復元を行います（`SSPlayerRenderer.ts`）。そのためアニメは MZ のスプライトと一緒に並び、上に canvas は重なりません。`ssplayer-tyranoscript` は Tyrano のレイヤーごとに canvas を 1 枚持ち、キャラクターの位置は `<div>` から決めます（`LayerCanvas.ts`、`ssplayer-webgl` の `SSOverlay.ts`）。ブラウザが許す WebGL コンテキストは 8〜16 個ほどしかなく、`[anim]` と `[kanim]` が名前で見つけるのもその `<div>` だからです。

**MZ には SIMD を使わないランタイムを渡します。** MZ の NW.js は WebAssembly SIMD の無い Chromium で、既定のランタイムは SIMD を必要とします（`ssplayer-core` の `SSRuntimeManager.ts` の `initializeWasm` は、`requireSimd: false` が渡されない限りそこで止まります）。そのため MZ の ZIP と MZ のサンプルは `packages/ssplayer-core/wasm-nosimd/` の `ssruntime_bg.wasm` を使い（`ssplayer-rmmz/scripts/pack-plugin.mjs`、`examples/rmmz-example/scripts/sync-plugin.mjs`）、Tyrano 系のプラグインは `packages/ssplayer-core/dist/` の SIMD 版を使います。

**変換はホストの開始時に行い、監視はしません。** `.sspj` を変換する 3 つのホストは、同じ時点を共有しています。開始時です。Ren'Py は開発者モードでゲームを起動したとき、ティラノビルダーはプロジェクトを開いたとき（`plugin.builder.ts`）、MZ はテストプレイの開始時に変換します（`rmmz/autoImport.ts`）。MZ は F5 でテストプレイを再起動するので、SpriteStudio で保存して F5 を押すのが MZ での繰り返しのすべてです。その後、Ren'Py は自動リロード（Shift+R）を有効にすると保存を拾います。リロードがインポートをもう一度走らせるからです。ティラノビルダーには、プラグインが乗れる再読み込みの仕組みがありません。監視するならプラグイン自身がエディタのスレッドで行うことになり、ポーリングなら 1 回ごとにソースファイル 1 つにつき 1 回の `stat` がかかり、そのすべてがエディタを描画しているスレッド上の Electron の `contextBridge` 越しの同期呼び出しになります。しかも作者はその間 SpriteStudio を見ています。そこでビルダーは指示されたときに変換します。**今すぐ取り込む**（**プロジェクト → プラグイン** → **SpriteStudio**）はプロジェクトを開いたときと同じ変換を走らせ（`managerPanel.ts`）、**SpriteStudio 表示** コンポーネントの **今すぐ再変換** はそのアニメデータ 1 つを作り直します（`builderImporter.ts`）。記録ファイルと「変更された」の判定は `ssconverter-importer` のものです（`autoImporter.ts` とその README）。

**ビルダーは、成功をトーストで、対処が要るものをダイアログで知らせます**（`plugin.builder.ts` の `notifyRun` と初回の確認）。再変換が終わるのは、作者が SpriteStudio で作業している最中であることが多く、モーダルにすると作業中のアプリからフォーカスを奪います。変換の失敗がダイアログなのは、理由そのものを見せる必要があり、エディタには頼れるコンソールが無いからです。名前の衝突がダイアログなのは、どちらかの名前を変えてもらう必要があるからです。一度も変換したことがなく `.sspj` も無いプロジェクトには、プロジェクトの置き場所を伝えるダイアログを出します。

**コンバーターは Worker で動きますが、読み書きするファイルは別です。** コンバーターの呼び出しは同期的で、エディタが固まるほど長くかかります（数字は `ssconverter-importer` の `converter.ts` にあります）。そのため Blob URL から起動した Worker で動かし、ホストが Worker を起動できなければ呼び出し元のスレッドで動かします。プラグインがファイルシステムに届く経路は `window.studio_api` だけで、それを持つのはエディタのスレッドだけなので（`hostFs.ts`）、各プロジェクトの前後の読み書きはそこに残ります。これを移すことは、パッケージの [ROADMAP](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-tyranobuilder/ROADMAP.md) にあります。

**インポーターのフォルダは固定です。** MZ は `SpriteStudio_Source/` を読んで `spritestudio/` に書き（`rmmz/autoImport.ts`）、ティラノビルダーは `SpriteStudio_Source/` を読んで `data/others/ssdata/` に書きます（`builderImporter.ts`）。共有のインポーターはどちらの名前もオプションで受け取り（`autoImporter.ts` の `sourceDirName`・`outDirName`）、Ren'Py のインポーターはそれをゲーム側に公開していますが（`ss_source_dir`・`ss_output_dir`）、この 2 つのプラグインは公開していません。

**ビルダーが編集時に使うものは、書き出したゲームに入れません。** 書き出しは `index.html`・`data/`・`tyrano/` の 3 つを絞り込まずにコピーするもので、`.tbp` がファイルを届けられるのは `data/` の下にあるプラグインフォルダだけです。そのためプラグインは、そこにコンバーターの WASM を見つけるとプロジェクトの `.ss_tools/` に移し（`plugin.builder.ts` の `relocateConverterWasm`）、インポートの記録とログはプロジェクトのルートに置きます。

**1 つのプラグインフォルダに 2 つの半分を入れます。** `.tbp` はエディタ側と TyranoScript のランタイム（`init.ks`・`main.js`・`ssruntime_bg.wasm`）を 1 つの `ssplayer/` フォルダに入れて運びます（`scripts/pluginFiles.mjs`）。ランタイムが無いと、コンポーネントで組んだシナリオはエディタでは問題なく読めても、ゲームでは未知の `[ss_init]` で失敗します。1 つのプラグインにすることで、ビルダーのプラグイン数の上限も 1 つ分で済みます。作者が `.tbp` と TyranoScript の ZIP の**どちらか一方**だけを入れ、両方は入れないのはこのためです。どちらも同じ `data/others/plugin/ssplayer/` に展開されるので、重ねるとエディタ側とランタイム側の版がずれます。

**ホストごとのインポーターの報告先。** ティラノビルダーのメインウィンドウには DevTools が無いので、インポーターは `<project>/ss_import_log.txt` に書き、その都度書き出してセッションをまたいで追記します（`importLog.ts`）。MZ のテストプレイにはコンソール（F8）があり、エラー画面がプロジェクト名と理由を表示するので、MZ はログファイルを書きません（`rmmz/autoImport.ts`）。
