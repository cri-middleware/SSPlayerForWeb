# ティラノビルダーのサンプル

[English](./README.md)

`@spritestudio/ssplayer-tyranobuilder` のコンポーネントで SpriteStudio のアニメーションを再生する、ティラノビルダーのプロジェクトです。シーンは `data/scenario/scene1.ks` の 1 つで、Ringo を表示し、アニメーションを切り替え、終わるまで待ち、移動させます。

## コミットしているもの

このサンプルで作ったものだけです。プロジェクト設定（`builder_config.json`）とシーンがそれに当たります。プロジェクトの残りは `setup` が配置します。

| 部分 | 入手元 |
| --- | --- |
| TyranoScript 本体とビルダーのプロジェクト雛形 | お手元のティラノビルダーで作った新規プロジェクト。ビルダーは市販品なので、雛形はこのリポジトリにコミットしません。 |
| プラグイン | このリポジトリのビルド（`packages/ssplayer-tyranobuilder/scripts/install.mjs` 経由） |
| Ringo の SpriteStudio データ | `SpriteStudio-SDK` サブモジュール（`tests/Ringo`） |
| 変換済みのデータ（`data/others/ssdata/`） | プロジェクトを開いたときにプラグインが変換 |

残すものは `.gitignore` にすべて書いてあります。

## セットアップ

ティラノビルダー、SDK サブモジュール、パッケージのビルド（[CONTRIBUTING.md](../../CONTRIBUTING.md)）が必要です。

1. ティラノビルダーで新規プロジェクトを作ります。名前は何でも構いません。雛形の入手元として使うだけなので、終わったら削除して構いません。
2. そのプロジェクト名を渡して setup を実行します。

   ```sh
   pnpm --filter tyranobuilderexample run setup <そのプロジェクト>
   ```

3. ティラノビルダーを起動し直して **tyranobuilderexample** を開きます。初回に開いたときに Ringo が変換されます。`scene1.ks` の ▶ でシーンを再生できます。

setup は `~/TyranoBuilder/myproject/tyranobuilderexample` からこのフォルダへリンクを張ります（Windows ではジャンクション）。ビルダーの一覧に表示され、保存はこのチェックアウトに書かれるので、シーンを編集すると `git diff` に出ます。同じ名前のプロジェクトがすでにある場合、setup はそれに触れずに止まります。

プラグインをビルドし直したら、プロジェクト名なしで setup を再実行すると新しいビルドが入ります。ティラノビルダーが `~/TyranoBuilder` 以外にある場合は `--builder <dir>` を渡してください。
