[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyranobuilder

**ティラノビルダー** で **SpriteStudio** のアニメを使えるようにするプラグインです。コンポーネントパレットから配置するだけで、シナリオを書く必要はありません。

> **対象読者:** ティラノビルダーで制作する方。シナリオを手書きする場合は
> [`@spritestudio/ssplayer-tyranoscript`](../ssplayer-tyranoscript/README.ja.md)
> を使ってください（同じ `[ss_*]` タグを TyranoScript に追加します）。
> **ステータス:** beta。

▶️ **[オンラインデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** —
エディタ用プラグイン自体はブラウザで動かせませんが、これは同梱しているランタイムと同じもので、TyranoScript のサンプルで動かしています。

## クイックスタート

**ゲームを作る場合**はこのまま下へ。入れる → 追加する → 配置する、の順で、シナリオは書きません。その先（編集の取り込み、全コンポーネント、うまくいかないとき）も同じ道の続きで、[ティラノビルダーガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/tyranobuilder)にあります。
**プラグイン自体を変更する場合**は下の[開発者向け](#開発者向け)、その後 [CONTRIBUTING.md](../../CONTRIBUTING.md) へ。

ティラノビルダーと、**SpriteStudio 7.5 以上**で作成したプロジェクトを用意してください。

1. **導入**: [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-tyranobuilder&expanded=true) から `ssplayer.tbp` をダウンロードします。`@spritestudio/ssplayer-tyranobuilder <version>` という名前の Release を開き、**Assets** にあるファイルを取ってください（*Source code* のアーカイブではありません）。ティラノビルダーでメニューの **プロジェクト → プラグイン** を開き、**プラグインを追加** でそのファイルを選びます。ティラノビルダーはファイル名からプラグイン名を決めるので、`ssplayer.tbp` の名前は変えないでください。必要なのはこのファイルだけで、TyranoScript 用のプラグイン ZIP を一緒に入れてはいけません。
2. **アニメを追加**: SpriteStudio のプロジェクトを `.sspj` だけでなくフォルダごと、ゲームのフォルダの `SpriteStudio_Source/` にコピーし（初めてプロジェクトを開いたときにプラグインが作ります）、プロジェクトを開くか開き直します。開くときに変換され、メッセージで知らせます。

   ```
   mygame/
   ├── SpriteStudio_Source/
   │   └── Ringo/            ← プロジェクトのフォルダをそのまま
   │       ├── Ringo.sspj
   │       ├── Ringo.png
   │       └── …
   └── data/others/ssdata/
       └── Ringo/            ← プロジェクトを開いたときに変換される
           ├── Ringo.ssab
           └── Ringo.png
   ```

3. **配置**: コンポーネントパレットの **プラグイン** から **SpriteStudio 表示** を配置し、プルダウンでアニメを選びます。

SpriteStudio で編集したら、そのコンポーネントの **今すぐ再変換** を押してください。エディタを開いている間、裏で変換が走ることはありません。ティラノビルダーの無料版が読み込めるプラグインは 2 つまでで、これで 1 つを使います。

SpriteStudio のデータが手元に無くても始められます。[公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) が手頃です。

**次に読む:** [ティラノビルダーガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/tyranobuilder) ·
[コンポーネント](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/tyranobuilder#the-components) ·
[うまくいかないとき](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/tyranobuilder#troubleshooting) ·
[制約と適用範囲](https://cri-middleware.github.io/SSPlayerForWeb/ja/limitations#tyranoscript-tyranobuilder)

---

## 開発者向け

```sh
pnpm --filter @spritestudio/ssplayer-tyranoscript  run build   # ランタイム側
pnpm --filter @spritestudio/ssplayer-tyranobuilder run build
pnpm --filter @spritestudio/ssplayer-tyranobuilder run pack    # → dist/pack/ssplayer.tbp
pnpm --filter @spritestudio/ssplayer-tyranobuilder run test
```

ビルドのたびにインストールダイアログを操作するのは手間なので、プロジェクトへ直接配置できます:

```sh
node packages/ssplayer-tyranobuilder/scripts/install.mjs mygame --sample
```

`~/TyranoBuilder/myproject` 配下のプロジェクト名か、任意の場所のパスを指定します。指定しなければ、1 つだけならそれを使い、複数なら候補を並べます。`--sample` は SDK の
Ringo を `SpriteStudio_Source/` に置くので、初回から変換対象があります。

その後プロジェクトを開き直してください。TyranoBuilder のメインウィンドウには DevTools
が無いので、確認先は `<project>/ss_import_log.txt` です（実行環境と全変換履歴がセッションをまたいで追記されます）。

[`examples/tyranobuilderexample`](../../examples/tyranobuilderexample) は、すぐに開けるサンプルプロジェクトです。Ringo にコンポーネントを使うシーンが 1 つ入っています。ビルダーで雛形用の新規プロジェクトを作り、`pnpm --filter tyranobuilderexample run setup <そのプロジェクト>` を実行します。詳しくはその README を参照してください。

エディタ内部の仕組み（ベンダー非公開の部分を含む）はソースのコメント（主に `src/plugin.builder.ts`、`src/builderTypes.d.ts`、`src/buttonParam.ts`）に、残タスクは [ROADMAP.md](./ROADMAP.md) にあります。

## ライセンス

BSD-3-Clause。[LICENSE.md](./LICENSE.md) を参照してください。
