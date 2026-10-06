# Releasing SpriteStudio Player for Web

Maintainers only. Contributors do not run any of this — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Cutting a release

Anyone with the Write role on this repository can cut a release: it is one run of the **Release** workflow on `main`, so nothing depends on whose machine starts it. You need `git` and `gh` (run `gh auth login` once), and for step 5, `npm` signed in to an account that can publish to the `@spritestudio` scope. The repository needs GitHub Pages enabled with GitHub Actions as its source, and a `*-v*` tag rule on its `github-pages` environment, or publishing a Release deploys nothing; both are settings a repository admin makes. The commands are bash: in zsh, run `setopt interactive_comments` first, so that the `#` comments are not taken as arguments; on Windows, use Git Bash.

Packages are versioned independently, and a release names the versions it sets, as `<package>@<version>` pairs where `<package>` is the directory under `packages/`. A release can carry the four public packages, which go to npm, and the private plugins listed in `PLUGIN_ROWS` in `scripts/build-release.sh`, whose Release is their only channel. What each version gained is written in its package's `CHANGELOG.md` and nowhere else: a Release carries the package's file and a link to that changelog. A contributor's pull request carries no version and no changelog entry — both are written here. There is no release branch: what `main` holds is what goes out, so `main` holds only what can ship.

### 1. Decide the versions

Look at what each package gained since its previous tag. A package that depends on another through `workspace:^` needs a release of its own only when it needs what the other added. One dependency is stricter than that: `ssplayer-webgl` and `ssplayer-pixi` build `ssplayer-core`'s wasm glue into their CDN bundles, while the CDN snippets load the runtime itself from `ssplayer-core`'s version, and the two work only as a pair. So once `scripts/SDK_VERSION.txt` names another SDK than it did at `ssplayer-core`'s tag, releasing either player means releasing `ssplayer-core` too, and `scripts/build-release.sh` stops the run otherwise. A version with a prerelease part (`7.0.0-beta.2`) goes to npm under that word's dist-tag (`beta`), and only a full release moves `latest`.

```bash
git fetch origin --tags
git tag --list '*-v*' --sort=-creatordate         # every release so far, newest first
git log --oneline ssplayer-core-v7.0.0-beta.1..origin/main -- packages/ssplayer-core   # before its first release: origin/main alone
git diff --stat ssplayer-core-v7.0.0-beta.1 origin/main -- scripts/SDK_VERSION.txt   # any output: a player release takes ssplayer-core along
```

A run releases every package whose current version has no Release yet, named or not. So the first release names every package at the version it already has, or leaves the plugins out with `-f release_plugins=false`:

```text
ssplayer-core@7.0.0-beta.1 ssplayer-webgl@7.0.0-beta.1 ssplayer-pixi@7.0.0-beta.1 ssconverter-core@7.0.0-beta.1 ssplayer-rmmz@7.0.0-beta.1 ssplayer-tyranoscript@7.0.0-beta.1 ssplayer-tyranobuilder@7.0.0-beta.1
```

### 2. Write the changelog

For each package being released, write what it gained under `## [Unreleased]` in `packages/<dir>/CHANGELOG.md`, in Keep a Changelog's sections (`### Added`, `### Changed`, `### Fixed`, `### Removed`), and merge it into `main` with a pull request. If a dependency the packages bundle changed, bring `THIRD_PARTY_NOTICES.md` up to date in the same pull request. The release turns each `## [Unreleased]` into `## [<version>] - <date>`, and stops before building anything when a package it releases has nothing there.

```bash
git switch -c release-notes origin/main
# write under ## [Unreleased] in packages/<dir>/CHANGELOG.md
git add packages/*/CHANGELOG.md THIRD_PARTY_NOTICES.md
git commit -m "docs: changelog for the next release"
git push -u origin release-notes
gh pr create -B main --fill
gh pr merge release-notes --merge --delete-branch
```

### 3. Run the release

```bash
gh workflow run release.yml --ref main -f versions="ssplayer-core@7.0.0-beta.2 ssplayer-webgl@7.0.0-beta.2"   # prints the run's URL, which ends in its <run-id>
gh run watch <run-id>
```

The run writes the versions, dates their changelog sections, repoints the version-pinned snippets in the package READMEs and `examples/cdn`, and commits; then it builds and checks everything with `scripts/build-release.sh`, and only after that pushes the commit, gives every package it releases a `<package>-v<version>` tag, and drafts its Release. A failure before the push leaves `main` untouched, and so does a `main` that moved during the run, which rejects the push. Then see what it made:

```bash
git fetch origin --tags
git log --oneline -1 origin/main                  # chore(release): <the versions>
git tag --points-at origin/main                   # one tag per package released
gh release list --limit 10                        # their drafts
```

With `versions` left empty, nothing is set, and every current version not yet released goes out: the retry after a run that failed. `-f release_plugins=false` leaves the plugins out. `publish_npm` stays off until npm trusted publishing is set up, and step 5 publishes by hand meanwhile.

### 4. Check the drafts

Each draft carries its package's file and a link to its changelog. Look at the files before anything goes to npm: until then, a fault is undone by deleting the draft (see [Undoing a release](#undoing-a-release)), and after it, only a new version fixes it.

```bash
dir=$(mktemp -d)
for tag in ssplayer-core-v7.0.0-beta.2 ssplayer-webgl-v7.0.0-beta.2; do   # every draft the run made
  gh release download "$tag" -D "$dir/$tag"
done
ls -R "$dir"                                      # one file each: a .tgz for npm, an archive for a plugin
```

`tar -tzf <file>.tgz` lists what an npm tarball holds, and `unzip -l <file>` what a plugin's archive holds.

### 5. Publish to npm

The public packages go to npm from the very tarball on their draft, before any Release is published, so that by the time a Release announces a version, `npm install` and the CDN snippets in the READMEs find it. Go in dependency order — `ssplayer-core` and `ssconverter-core`, then `ssplayer-webgl` and `ssplayer-pixi` — so that no version reaches npm before one it depends on. `--tag` is the prerelease's word (`beta`); leave it out for a full release. npm asks for a 2FA code for each. A release with no public package skips this step.

```bash
npm login                                         # once
dir=$(mktemp -d)
for tag in ssplayer-core-v7.0.0-beta.2 ssplayer-webgl-v7.0.0-beta.2; do   # the public packages released, dependencies first
  gh release download "$tag" -p '*.tgz' -D "$dir/$tag"
  npm publish "$dir/$tag"/*.tgz --tag beta --access public
done
npm view @spritestudio/ssplayer-core dist-tags    # beta: the version just published
```

### 6. Publish the Releases

Nothing on a draft needs writing, and a version with a `-` is already marked as a pre-release. Publish each one, here or with **Publish release** on the [Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases) page:

```bash
for tag in ssplayer-core-v7.0.0-beta.2 ssplayer-webgl-v7.0.0-beta.2; do
  gh release edit "$tag" --draft=false
done
```

Publishing starts `pages.yml`, which deploys the [documentation site](https://cri-middleware.github.io/SSPlayerForWeb/) and the examples. Every Release published starts a run of its own; they queue, and a newer one replaces one still waiting, which then shows as cancelled. Watch the newest through, then open the site:

```bash
gh run list --workflow pages.yml --limit 3        # the newest is the one to watch
gh run watch <run-id>
```

A failed run leaves the site as it was. When the cause was a setting outside the repository, re-run it with `gh run rerun <run-id>`; a fix in the repository goes into `main` by pull request and deploys with `gh workflow run pages.yml --ref main`.

## Undoing a release

**An npm version is permanent**: it cannot be withdrawn, only superseded. So is a published Release, whose file users have downloaded by its tag. A fault found after either is fixed by a new version. Before that:

*   A run that failed before the push is run again with the same versions, once the cause is fixed in `main`. The **Re-run** button would replay the old commit, and its push would be rejected.

    ```bash
    gh workflow run release.yml --ref main -f versions="ssplayer-core@7.0.0-beta.2 ssplayer-webgl@7.0.0-beta.2"
    ```

*   A run that failed after the push is run again with `versions` empty, before anything else is merged into `main`: the retry builds `main` as it then is, reuses the tags it had pushed, and drafts the Releases still missing.

    ```bash
    gh workflow run release.yml --ref main
    ```

*   A fault found in a draft takes its tag down too. Delete the draft of every package the fault reaches — `ssplayer-webgl` and `ssplayer-pixi` carry `ssplayer-core`'s wasm glue in their CDN bundles — merge the fix into `main`, correcting the version's changelog section if it needs it, and run again with `versions` empty, which tags the same versions on the fixed `main`.

    ```bash
    gh release delete ssplayer-core-v7.0.0-beta.2 --cleanup-tag --yes   # deletes the tag too, here and on GitHub
    ```

## Building the release locally

`scripts/build-release.sh` is the release build, and `release.yml` runs exactly this script for everything it uploads. It builds *both* channels into one directory (`release-dist` by default) and publishes neither: `<out>/npm/*.tgz` (`pnpm pack` for every package that is not `private`, so the `files` allow-list, the `prepack` artifact guard and the `workspace:^` rewrite all apply) and `<out>/plugins/*` (each private package's own `pack` script), plus `SHA256SUMS` over both. The workflow publishes those very tarballs and attaches those very archives, reading `<out>/manifest.json` to know which file belongs to which package. It builds under the versions the working tree has and sets none, so it can be run on any checkout to see what the packages would ship:

```bash
scripts/build-release.sh                          # -> release-dist/
```

**The verification is what earns the script its keep**, and every check in it is a failure that would otherwise ship: `workspace:` left in a packed manifest; a `files` entry missing from the tarball; `ssplayer-core` without its second (`dist/`) copy of the wasm, the one its ESM entry loads from beside itself in every bundled app; `ssplayer-webgl` or `ssplayer-pixi` going out under an `ssplayer-core` version whose runtime their CDN bundles do not match; the RPG Maker MZ plugin carrying the SIMD runtime instead of the no-SIMD one, which MZ's NW.js cannot load; `ssplayer.tbp` renamed or holding anything but the one `ssplayer/` folder, since the builder derives the plugin id from the filename; a `{{VERSION}}` left unsubstituted in the TyranoScript readme; and the docs' version pins disagreeing with the manifests. A new private package with a `pack` script fails the run until it is listed in `PLUGIN_ROWS`, the only place the plugin artifact names live.

Both channels are reproducible run to run. The pack scripts write the plugin archives with fflate and stamp every entry 1980-01-01, so the same inputs give the same bytes, and the plugins stage needs no `zip` on any platform.

<br>

---

# SpriteStudio Player for Web のリリース手順

維持者向けです。コントリビューターがこの手順を実行することはありません（[CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください）。

## リリースの手順

このリポジトリの Write ロールを持つ人なら誰でもリリースできます。リリースは `main` での **Release** ワークフローの実行 1 回なので、誰の手元から始めても結果は変わりません。必要なのは `git` と `gh`（最初に一度 `gh auth login`）、それに手順 5 のための `npm` で、`@spritestudio` scope に publish できるアカウントでログインしておきます。リポジトリ側では、GitHub Pages を有効にしてソースを GitHub Actions にし、`github-pages` environment に `*-v*` のタグのルールを足しておく必要があります。どちらかが欠けると、Release を公開しても何もデプロイされません。どちらもリポジトリの admin が行う設定です。コマンドは bash です。zsh では、`#` のコメントが引数として渡されないよう、先に `setopt interactive_comments` を実行します。Windows では Git Bash を使います。

パッケージは独立にバージョンを持ち、リリースは設定するバージョンを `<package>@<version>` の組で指定します。`<package>` は `packages/` の下のディレクトリ名です。リリースで出せるのは、npm に出す 4 つの公開パッケージと、`scripts/build-release.sh` の `PLUGIN_ROWS` にある private なプラグインです。プラグインは Release が唯一の配布経路です。各バージョンで何が変わったかは、そのパッケージの `CHANGELOG.md` にだけ書きます。Release が持つのはパッケージのファイルと、その changelog へのリンクだけです。コントリビューターのプルリクエストはバージョンも changelog の項目も持ちません。どちらもここで書きます。release ブランチはありません。`main` にあるものがそのまま出るので、`main` には出せるものだけを置きます。

### 1. バージョンを決める

各パッケージが前回のタグから何を得たかを見ます。`workspace:^` で別のパッケージに依存するパッケージは、相手が足したものを必要とするときだけ自分もリリースします。ただし 1 か所だけ、これより厳しい依存があります。`ssplayer-webgl` と `ssplayer-pixi` は CDN 用のバンドルに `ssplayer-core` の wasm glue を組み込み、CDN スニペットはランタイム本体を `ssplayer-core` の版から読み込みます。この 2 つは対でしか動きません。そのため `scripts/SDK_VERSION.txt` の SDK が `ssplayer-core` のタグの時点と変わっていれば、どちらかのプレイヤーをリリースするときは `ssplayer-core` もリリースします。そうしないと `scripts/build-release.sh` が実行を止めます。プレリリース部分のあるバージョン（`7.0.0-beta.2`）は、その語の dist-tag（`beta`）で npm に出ます。`latest` を動かすのは正式版だけです。

```bash
git fetch origin --tags
git tag --list '*-v*' --sort=-creatordate         # これまでのリリース。新しい順
git log --oneline ssplayer-core-v7.0.0-beta.1..origin/main -- packages/ssplayer-core   # 初回リリースの前は origin/main だけ
git diff --stat ssplayer-core-v7.0.0-beta.1 origin/main -- scripts/SDK_VERSION.txt   # 何か出たら、プレイヤーのリリースに ssplayer-core も含める
```

run は、指定したかどうかに関わらず、現在のバージョンにまだ Release が無いパッケージをすべて出します。そのため初回のリリースでは、全パッケージをいま持っているバージョンのまま指定するか、`-f release_plugins=false` でプラグインを外します。

```text
ssplayer-core@7.0.0-beta.1 ssplayer-webgl@7.0.0-beta.1 ssplayer-pixi@7.0.0-beta.1 ssconverter-core@7.0.0-beta.1 ssplayer-rmmz@7.0.0-beta.1 ssplayer-tyranoscript@7.0.0-beta.1 ssplayer-tyranobuilder@7.0.0-beta.1
```

### 2. changelog を書く

リリースするパッケージごとに、得たものを `packages/<dir>/CHANGELOG.md` の `## [Unreleased]` の下に、Keep a Changelog の節（`### Added`・`### Changed`・`### Fixed`・`### Removed`）で書き、プルリクエストで `main` にマージします。パッケージが同梱する依存が変わっていれば、同じプルリクエストで `THIRD_PARTY_NOTICES.md` も更新します。リリースは各 `## [Unreleased]` を `## [<version>] - <date>` に書き換えます。リリースするパッケージの `## [Unreleased]` が空なら、何もビルドせずに止まります。

```bash
git switch -c release-notes origin/main
# packages/<dir>/CHANGELOG.md の ## [Unreleased] の下に書く
git add packages/*/CHANGELOG.md THIRD_PARTY_NOTICES.md
git commit -m "docs: changelog for the next release"
git push -u origin release-notes
gh pr create -B main --fill
gh pr merge release-notes --merge --delete-branch
```

### 3. リリースを実行する

```bash
gh workflow run release.yml --ref main -f versions="ssplayer-core@7.0.0-beta.2 ssplayer-webgl@7.0.0-beta.2"   # run の URL が出る。末尾が <run-id>
gh run watch <run-id>
```

run はバージョンを書き込み、changelog の節に日付を入れ、パッケージの README と `examples/cdn` にあるバージョン固定のスニペットを追従させてコミットします。続けて `scripts/build-release.sh` ですべてをビルドして検査し、そのあとで初めてコミットを push し、リリースする各パッケージに `<package>-v<version>` のタグを打ち、Release の下書きを作ります。push より前に失敗すれば `main` は変わりません。run の途中で `main` が進んでいた場合も、push が拒否されるので同じです。終わったら、できたものを確かめます。

```bash
git fetch origin --tags
git log --oneline -1 origin/main                  # chore(release): <指定したバージョン>
git tag --points-at origin/main                   # リリースしたパッケージごとに 1 つ
gh release list --limit 10                        # その下書き
```

`versions` を空にすると何も設定せず、まだリリースしていない現在のバージョンをすべて出します。失敗した run のやり直しがこれです。`-f release_plugins=false` でプラグインを外せます。`publish_npm` は npm の trusted publishing を設定するまでオフのままにし、それまでは手順 5 で手動で publish します。

### 4. 下書きを確かめる

下書きには、パッケージのファイルと changelog へのリンクが入っています。npm に何か出す前に、ファイルを確かめます。それまでなら下書きを消せば取り消せますが（「リリースの取り消し」を参照）、出した後は新しいバージョンでしか直せません。

```bash
dir=$(mktemp -d)
for tag in ssplayer-core-v7.0.0-beta.2 ssplayer-webgl-v7.0.0-beta.2; do   # run が作った下書きすべて
  gh release download "$tag" -D "$dir/$tag"
done
ls -R "$dir"                                      # 1 つずつ。npm 用は .tgz、プラグインはアーカイブ
```

npm の tarball の中身は `tar -tzf <file>.tgz`、プラグインのアーカイブの中身は `unzip -l <file>` で一覧できます。

### 5. npm に publish する

公開パッケージは、下書きに添付された tarball そのものを npm に出します。どの Release を公開するよりも先に行い、Release がバージョンを告知する時点で、`npm install` と README の CDN スニペットがそのバージョンを見つけられるようにします。依存の順に、`ssplayer-core` と `ssconverter-core`、続けて `ssplayer-webgl` と `ssplayer-pixi` の順で出し、依存先より先に npm に載るバージョンが無いようにします。`--tag` はプレリリースの語（`beta`）で、正式版では付けません。npm はパッケージごとに 2FA のコードを求めます。公開パッケージを含まないリリースでは、この手順は飛ばします。

```bash
npm login                                         # 最初に一度
dir=$(mktemp -d)
for tag in ssplayer-core-v7.0.0-beta.2 ssplayer-webgl-v7.0.0-beta.2; do   # リリースした公開パッケージ。依存先から
  gh release download "$tag" -p '*.tgz' -D "$dir/$tag"
  npm publish "$dir/$tag"/*.tgz --tag beta --access public
done
npm view @spritestudio/ssplayer-core dist-tags    # beta: いま出したバージョン
```

### 6. Release を公開する

下書きに書き足すものはありません。`-` を含むバージョンは、すでに pre-release になっています。1 つずつ公開します。下のコマンドでも、[Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases) ページの **Publish release** でも構いません。

```bash
for tag in ssplayer-core-v7.0.0-beta.2 ssplayer-webgl-v7.0.0-beta.2; do
  gh release edit "$tag" --draft=false
done
```

公開すると `pages.yml` が動き、[ドキュメントサイト](https://cri-middleware.github.io/SSPlayerForWeb/) とサンプルをデプロイします。Release を 1 つ公開するごとに run が 1 つ始まります。run は順に並び、待っている run は新しい run に置き換えられて cancelled と表示されます。いちばん新しい run を最後まで見届けてから、サイトを開いて確かめます。

```bash
gh run list --workflow pages.yml --limit 3        # いちばん新しいものを見る
gh run watch <run-id>
```

run が失敗してもサイトは元のまま残ります。原因がリポジトリの外の設定にあったなら、`gh run rerun <run-id>` で再実行します。リポジトリ内の修正は、プルリクエストで `main` に入れてから `gh workflow run pages.yml --ref main` でデプロイします。

## リリースの取り消し

**npm のバージョンは恒久的です。** 取り下げられず、新しいバージョンで置き換えるしかありません。公開した Release も同じで、利用者はそのタグでファイルを取得しています。どちらかの後に見つかった不具合は、新しいバージョンで直します。それより前なら次のとおりです。

*   push より前に失敗した run は、原因を `main` で直してから、同じバージョンを指定して実行し直します。**Re-run** ボタンは古いコミットをそのまま再生するので、push が拒否されます。

    ```bash
    gh workflow run release.yml --ref main -f versions="ssplayer-core@7.0.0-beta.2 ssplayer-webgl@7.0.0-beta.2"
    ```

*   push の後に失敗した run は、ほかの変更が `main` にマージされる前に、`versions` を空にして実行し直します。やり直しはその時点の `main` をビルドし、push 済みのタグはそのまま使い、まだ無い Release の下書きを作ります。

    ```bash
    gh workflow run release.yml --ref main
    ```

*   下書きに不具合が見つかったら、タグもいっしょに消します。不具合が及ぶすべてのパッケージの下書きを消し（`ssplayer-webgl` と `ssplayer-pixi` は CDN 用のバンドルに `ssplayer-core` の wasm glue を含みます）、修正を `main` にマージして（必要ならそのバージョンの changelog の節も直して）、`versions` を空にして実行し直します。直した `main` に同じバージョンのタグが打たれます。

    ```bash
    gh release delete ssplayer-core-v7.0.0-beta.2 --cleanup-tag --yes   # タグも手元と GitHub の両方から消える
    ```

## リリースのローカルビルド

`scripts/build-release.sh` がリリースのビルドそのもので、`release.yml` はアップロードするものすべてについて、このスクリプトを実行しているだけです。**両方**のチャネルを 1 つのディレクトリ（既定 `release-dist`）にビルドし、どちらも publish しません。`<out>/npm/*.tgz`（`private` でない全パッケージの `pnpm pack`。`files` 許可リスト、`prepack` の成果物ガード、`workspace:^` の書き換えが適用されます）と `<out>/plugins/*`（各 private パッケージ自身の `pack` スクリプトの出力）、そして両方に対する `SHA256SUMS` です。ワークフローはこの tarball とアーカイブをそのまま publish・添付し、どのファイルがどのパッケージのものかを `<out>/manifest.json` から読みます。ビルドは作業ツリーにあるバージョンで行い、バージョンを書き換えないので、どのチェックアウトでも、パッケージが何を出荷するかを確かめるのに使えます。

```bash
scripts/build-release.sh                          # -> release-dist/
```

**このスクリプトの価値は検査にあります。** どの検査も、無ければそのまま出荷される失敗です。packed manifest に残った `workspace:`、tarball から欠けた `files` エントリ、ESM の入口が自分の隣から読み込む 2 つめ（`dist/`）の wasm コピーを欠いた `ssplayer-core`（バンドラで組んだアプリはすべてこれを読みます）、CDN 用バンドルと合わないランタイムの `ssplayer-core` の版のまま出る `ssplayer-webgl` / `ssplayer-pixi`、no-SIMD ではなく SIMD ランタイムを同梱した RPG ツクール MZ プラグイン（MZ の NW.js は読み込めません）、改名されたか `ssplayer/` フォルダ以外を含む `ssplayer.tbp`（ビルダーはファイル名からプラグイン ID を導きます）、TyranoScript の readme に残った未置換の `{{VERSION}}`、そして docs のバージョンピンと manifest の不一致。`pack` スクリプトを持つ private パッケージを追加すると、`PLUGIN_ROWS` に載せるまで実行が失敗します。プラグイン成果物の名前が書かれているのは今はそこだけです。

どちらのチャネルも実行ごとに再現可能です。プラグインのアーカイブは pack スクリプトが fflate で書き出し、全エントリの日時を 1980-01-01 に固定しているので、入力が同じならバイト列も同じになります。plugins 段はどのプラットフォームでも `zip` を必要としません。
