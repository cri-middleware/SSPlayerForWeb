---
description: SpriteStudio Player for Web をチェックアウトからビルドし、変更した版を自分のゲームやアプリで使い、RPG ツクール MZ と Tyrano 系のホストで確かめる方法。
---

# ビルドガイド

SpriteStudio Player for Web を開発する人と、自分のプロジェクトのために改造する人に向けたページです。チェックアウトがある前提で、サイトのほかのページより読み手に求めるものが多くなっています。パッケージの組み合わせと、プラグインがこの作りになっている理由は[プレイヤーの構成](./architecture.md)にあります。

SpriteStudio の Player に共通すること（再生・モーションブレンド・サウンドキー・パーツトラッキングの振る舞い）は、SDK の[ポーティングガイド](https://github.com/cri-middleware/SpriteStudio-SDK/tree/develop/libs/ssruntime/docs)に一度だけ書いてあります。

## チェックアウトからビルドする {#building-from-a-checkout}

セットアップ・ビルド・テスト・ドキュメントサイトは [CONTRIBUTING](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/CONTRIBUTING.md) にあります。新しいチェックアウトからレンダラーのサンプルを動かすまでは `pnpm run example` が、ブラウザのコンバータの起動は `pnpm --filter @spritestudio/ssconverter-web dev` が行います。各プラグインの README の末尾にあるコントリビューター向けの節に、そのプラグインのビルド・パック・実行があります。

## 変更したプレイヤーを使う {#using-a-changed-player}

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

## 実際のホストで確かめる {#checking-against-the-real-host}

パッケージのテストは、MZ と TyranoScript の代役を相手に走ります。実際のホストでしか分からないこと（タイミング、セーブの仕組み、エディタ）は、ホストを動かして確かめます。以下はどれもホストの GUI を操作せずに回せます。パスは macOS のものです。

### ホストの表記の引き方 {#where-the-hosts-labels-come-from}

ガイドでは、メニュー・ダイアログ・オプションの名前をホストの表示どおりに書きます。名前はホストの実物から引きます。

- **RPG ツクール MZ**: 英語の表記はエディタのバイナリ（`RPGMZ.app/Contents/MacOS/RPGMZ`）に ASCII で入っていて、`grep -a` で見つかります。日本語の表記は同じバイナリの Qt の翻訳に **UTF-16BE** で入っていて、UTF-8 で探しても見つかりません。UTF-16BE のバイト列で探してください。文字列の隣にあるコンテキスト名（デプロイメントの画面なら `Layout_DeploymentOptions`）で、どの画面のものかが分かります。同梱のヘルプ（`Contents/Resources/help-ja/`）でも確かめられます。
- **ティラノビルダー**（`TyranoBuilder.app/Contents/Resources/app/` の下）: メニューは `js/main/MenuBar.js`、各ウィンドウの文字列は `template/window/*.tmpl.html`、英語の UI は `lang/en.json`（キーが日本語の原文）です。
- **プラグイン側の表記**: MZ はプラグインのヘルプの注釈にある `@text` の行（英語と `/*:ja` の下）、ティラノビルダーは `.tbp` が運ぶ日本語の言語ファイルです。

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

MZ が無い環境では、`examples/rmmz-harness`（`pnpm --filter rmmz-harness dev`）が、プラグインのプレイヤーとレンダラーを本物の PixiJS v5 の上で動かします。代役にしているのは MZ の `ImageManager` と `Bitmap` だけです。公開しているサンプル（このサイトの `examples/rmmz/`）は、ヘッドレスのブラウザでは 1 回クリックしてフォーカスを与えるまで、黒いスプラッシュ画面のまま止まります。

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

### TyranoStudio {#checking-tyranostudio}

TyranoStudio は同梱の TyranoScript でゲームを動かすので、そこで動くのは TyranoScript 用のプラグインです。ライセンスがアプリの改造を禁じているので、起動フラグだけで確かめます（`Contents/MacOS/TyranoStudio --remote-debugging-port=<port>`）。プレビューは別の Electron ウィンドウで、プロジェクトの `index.html` を `file://` で開き、`TYRANO.kag.is_studio === true` になります。ここでも `kag.error` はネイティブのダイアログなので、リロードの前に初期化スクリプトで `window.alert` を置き換えてください。

ティラノビルダーと TyranoStudio は Electron のユーザーデータのフォルダ（`~/Library/Application Support/studio`）を共有していて、`localStorage` も共有します。片方のプレビューで作ったセーブがもう片方にも出るので、起動中のアプリから `localStorage.removeItem` で消してください。

### ブラウザ {#checking-in-a-browser}

`SSSurface` は `document.hidden` の間は止まります（`pauseWhenHidden`、既定で有効）。そのため裏のタブのページは `0.0 / 0` のまま動かず、WebGL と PixiJS のサンプルのどちらでも同じです。`<ss-player>` はティッカーが回る前に 1 フレーム描くので、裏のタブでも絵は出ます。確かめるのは表示中のタブか、上のヘッドレスの Chrome です。
