[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyranobuilder

**TyranoBuilder** で **SpriteStudio** のアニメを使えるようにするプラグインです。コンポーネントパレットから配置するだけで、シナリオを書く必要はありません。

SpriteStudio のプロジェクトをフォルダに置いておくと、プロジェクトを開くたびにエディタが変換します。変換されたアニメは、他の素材と同じようにプルダウンから選べます。

> **対象読者:** TyranoBuilder で制作する方。シナリオを手書きする場合は
> [`@spritestudio/ssplayer-tyranoscript`](../ssplayer-tyranoscript/README.ja.md)
> を使ってください（同じ `[ss_*]` タグを TyranoScript に追加します）。**ステータス:** beta。

▶️ **[オンラインデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** —
エディタ用プラグイン自体はブラウザで動かせませんが、これは同梱しているランタイムと同じもので、TyranoScript のサンプルで動かしています（🚧 初回リリース後に公開）。

## インストール

[Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases) から
`ssplayer.tbp` をダウンロードし、TyranoBuilder の**プラグイン設定 → 追加 → そのファイルを選択**。

**ファイル名は変えないでください。** TyranoBuilder はファイル名からプラグイン名を決めるため、`ssplayer.tbp` のままである必要があります。

これ以外の準備は不要です。プラグイン読み込みのタグも、ランタイムの初期化も要りません。

**必要なのはこのファイルだけです。** `.tbp` にはランタイム側 — つまり
[`@spritestudio/ssplayer-tyranoscript`](../ssplayer-tyranoscript/README.ja.md) の
`[ss_*]` タグ — も入っているため、そちらのプラグイン ZIP を重ねて入れる必要はありません。あの ZIP は TyranoScript 用で、展開先はこのファイルと同じ
`data/others/plugin/ssplayer/` です。両方入れるとエディタ側とランタイム側でバージョンがずれます。

> TyranoBuilder の無料版はプラグインを 2 つまでしか読み込みません（本プラグインで 1 つです）。

## アニメを追加する

1. SpriteStudio のプロジェクトを、プロジェクトフォルダ内の `SpriteStudio_Source/`
   に置きます。アニメは複数のファイルで構成されるので、**`.sspj` だけでなくフォルダごと**置いてください。サブフォルダに入れても構いません（全体を探します）。
2. TyranoBuilder でプロジェクトを開きます。変換が走り、完了するとメッセージが出ます。
3. **SpriteStudio 表示** コンポーネントを配置し、プルダウンからアニメを選びます。

## SpriteStudio で編集したあと

変換は**プロジェクトを開いたときに1回だけ**走ります。作業中にバックグラウンドで動き続けることはありません。そのため SpriteStudio で保存したあとは、編集したアニメを再生している **SpriteStudio 表示** コンポーネントの **今すぐ再変換** にチェックを入れてください。そのアニメデータだけを変換し直し、結果を表示します。設定ではなくボタンなので、チェックは自動で外れます。

**プロジェクトを開いたまま新しい `.sspj` を追加した場合**は、再変換ではなくこちらです。再変換はコンポーネント上にあり、コンポーネントは既に存在するデータしか指定できないため、一度も変換していないプロジェクトには押す場所がありません。エディタの**プラグイン** メニューからプラグイン管理を開き、**SpriteStudio** を選んで**今すぐ取り込む** を押してください。プロジェクトを開いたときと同じように、追加・編集されたものを変換します。

このパネルには **SpriteStudio_Source を開く** と **変換ログを開く** もあり、入っているコンバータのバージョンも表示されます。不具合を報告するときはこの行を添えてください。

**プロジェクトからアニメを削除した場合**、対応する `.ssab` は次の変換で取り除かれます。プルダウンから消え、エクスポートしたゲームにも入らなくなります。削除されるのはこのプラグインが作ったファイルだけで、自分で置いたファイルはそのまま残ります。

**同じファイル名のプロジェクトは 2 つ置けません。** `chara/hero.sspj` と
`enemy/hero.sspj` はどちらも `data/others/ssdata/hero/` に変換されるため、先に見つかった方だけを変換し、どれとどれがぶつかったかを表示します。どちらかの名前を変えてください。

## コンポーネント

パレットの **プラグイン** グループに入ります。

| | |
| --- | --- |
| **SpriteStudio 表示** | アニメを読み込んでレイヤーに表示 |
| **SpriteStudio フェードイン / フェードアウト** | 表示 / 非表示 |
| **SpriteStudio アニメ変更** | 別のアニメーションに切り替え |
| **SpriteStudio 停止 / 一時停止 / 再開** | 再生の制御 |
| **SpriteStudio 音声停止** | アニメが鳴らした音を止める |
| **SpriteStudio 待機** | アニメが終わるまでストーリーを止める |
| **SpriteStudio シグナル待機** | 攻撃が当たった瞬間など、アニメがシグナルを出すまでストーリーを止める |
| **SpriteStudio 再生速度 / フレーム移動** | 再生速度を変える / 指定フレームへ移動 |
| **SpriteStudio 区間再生 / 再生方向** | 指定範囲だけをループ / 順・逆・往復 |
| **SpriteStudio 話者連動** | キャラクターの台詞が表示されている間だけトークアニメを再生 |
| **SpriteStudio パーツの色 / パーツの表示 / パーツの画像** | パーツ 1 つの色・表示・描くセルを変える |
| **SpriteStudio パーツの変更を解除** | パーツの変更を元に戻す |
| **SpriteStudio 位置変更 / 移動** | 位置を変える / 時間をかけて動かす |
| **SpriteStudio 削除 / 全削除** | 個別 / 全部を破棄 |
| **SpriteStudio 全体フェードアウト / フェードイン** | まとめて操作（場面転換用） |
| **SpriteStudio 全体一時停止 / 全体再開** | まとめて操作（メニュー画面用） |
| **SpriteStudio 音声設定** | 既定と違う設定にしたいときだけ |

表記は TyranoBuilder 自身の言語に従います（`<TyranoBuilder>/lang/lang.txt` で決まります）。英語表示のエディタでは "SpriteStudio: show" のように出ます。

入力欄で知っておくと便利なもの:

- **管理名** — 他のコンポーネントがアニメを見つけるための名前です。「表示」で決めて、それ以外では同じシーン内の名前がプルダウンに並びます。
- **アニメデータ** — プロジェクト内のすべての `.ssab` が出ます（自動変換したものが先頭）。自分で別の場所に置いたものも選べます。
- **アニメーション** — 選んだアニメデータに実際に含まれるものが出ます。
- **次に再生** — 再生が終わったら続けて再生するアニメです。**「ループ再生する」をオフにしたときだけ**選べます（ループし続けるアニメは終わらないため）。
- **パーツ**・**セルマップ**・**セル** — その管理名のアニメデータに含まれるものが並びます。**パーツ**には変更できるものだけが出ます（色は通常パーツ、画像は通常パーツとマスクパーツ）。

## ファイルの置き場所

| | |
| --- | --- |
| `SpriteStudio_Source/` | あなたの `.sspj` プロジェクト — エクスポートしたゲームには**含まれません** |
| `data/others/ssdata/` | 変換後のアニメ（ゲームが再生するもの） |
| `ss_import_log.txt` | 変換の記録とエラー内容 |

変換済みの `.ssab` は `data/` 以下ならどこに置いても構いません。プルダウンはどちらでも見つけますし、**今すぐ再変換** は `data/others/ssdata/` ではなくその `.ssab` がある場所へ書き直します。

## うまくいかないとき

変換に失敗した場合は理由が画面に表示されます。同じ内容は、成功した変換の記録とともにプロジェクトフォルダの `ss_import_log.txt` に残ります。このファイルはプラグイン管理パネルから開けます。

プレビュー中にコンポーネントが役目を果たせないとき（「表示」で作っていない管理名や、アニメデータに無くなったアニメーションを指定したときなど）は、その理由がシーンのファイル名と行番号付きのダイアログで表示されます。書き出したゲームでは表示されません。書き出し時にエンジンのデバッグ設定がオフになるためです。

- **アニメがプルダウンに出ない** — `.sspj` がフォルダごと `SpriteStudio_Source/` に入っているか確認してください。
- **パレットに SpriteStudio のコンポーネントが無い** — プラグインが読み込まれていません。`.tbp` を入れ直し、無料版のプラグイン 2 個制限を超えていないか確認してください。
- **変換はされたがゲームに出ない** — 「表示」がそれを参照するコンポーネントより前にあるか、レイヤー番号がゲームで使っているものか確認してください。

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

[`examples/tyranobuilderexample`](../../examples/tyranobuilderexample) は、すぐに開けるサンプルプロジェクトです。Ringo にコンポーネントを使うシーンが 1 つ入っています。

エディタ内部の仕組み（ベンダー非公開の部分を含む）はソースのコメント（主に `src/plugin.builder.ts`、`src/builderTypes.d.ts`、`src/buttonParam.ts`）に、残タスクは [ROADMAP.md](./ROADMAP.md) にあります。

## ライセンス

BSD-3-Clause。[LICENSE.md](./LICENSE.md) を参照してください。
