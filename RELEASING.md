# Releasing SpriteStudio Player for Web

Maintainers only. Contributors do not run any of this — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Cutting a release

Anyone with the Write role on this repository can cut a release: it is one run of the **Release** workflow on `main`, so nothing depends on whose machine starts it. You need `gh` (run `gh auth login` once), and the repository needs the `SS_NPM_TOKEN` secret for the npm half: an npm Granular Access Token with read and write access to the packages and **Bypass 2FA** turned on, since the workflow cannot answer a 2FA prompt.

Packages are versioned independently, and a release names the versions it sets, as `<package>@<version>` pairs where `<package>` is the directory under `packages/`. The workflow writes them, builds and checks everything, commits them to `main`, publishes the public packages to npm, and gives every package it released a `<package>-v<version>` tag and a draft GitHub Release carrying its file — the npm tarball, or a plugin's archive. The private plugins listed in `PLUGIN_ROWS` in `scripts/build-release.sh` are never on npm: their Release is their only channel. A pull request carries no version and no release note — both are decided here.

### 1. Decide the versions

Look at what each package gained since its previous tag. A package that depends on another through `workspace:^` needs a release of its own only when it needs what the other added. One dependency is stricter than that: `ssplayer-webgl` and `ssplayer-pixi` build `ssplayer-core`'s wasm glue into their CDN bundles, while the CDN snippets load the runtime itself from `ssplayer-core`'s version, and the two work only as a pair. So once `scripts/SDK_VERSION.txt` names another SDK than it did at `ssplayer-core`'s tag, releasing either player means releasing `ssplayer-core` too, and `scripts/build-release.sh` stops the run otherwise. A version with a prerelease part (`7.0.0-beta.2`) goes to npm under that word's dist-tag (`beta`), so `latest` stays on the last full release.

```bash
git log --oneline ssplayer-core-v7.0.0-beta.1..origin/main -- packages/ssplayer-core
```

### 2. Run the workflow

```bash
gh workflow run release.yml --ref main -f versions="ssplayer-core@7.0.0-beta.2 ssplayer-webgl@7.0.0-beta.2"
gh run watch                                      # the run takes a few seconds to appear
```

The run writes the versions, repoints the version-pinned CDN snippets in the docs, and commits; then it builds and checks everything with `scripts/build-release.sh`, and only after that pushes the commit, publishes to npm and drafts the Releases. A failure before the push leaves `main` and npm untouched, and so does a `main` that moved during the run, which rejects the push.

With `versions` left empty, nothing is set, and every current version not yet released goes out: the first release, and the retry after a run that failed. `-f release_plugins=false` leaves the plugins out. `-f publish_npm=false` skips npm and nothing else: the public packages still get their Releases, tarball attached, which is how they ship before npm can take them, and a later run with `versions` empty publishes them there.

### 3. Publish the drafts

Open each draft on the [Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases) page. Its generated notes list every pull request since that package's previous tag, the other packages' included: cut them down to what this package gained. Check the attached file, choose **Set as a pre-release** or **Set as the latest release**, and **Publish release**. Publishing starts `pages.yml`, which deploys the [documentation site](https://cri-middleware.github.io/SSPlayerForWeb/) and the examples. Watch the run through, then open the site: a failed run leaves the site as it was. Once the cause is fixed, re-run it.

```bash
gh run watch                                      # pages.yml; the run takes a few seconds to appear
```

## Undoing a release

**An npm version is permanent**: it cannot be withdrawn, only superseded, so a fault found after step 2 is fixed by a new version. A run that failed before publishing anything is simply run again. One that failed partway through is run again with `versions` empty: it skips whatever npm and the Releases already have and finishes the rest, reusing any tag it had pushed. A draft can be deleted until it is published.

## Building the release locally

`scripts/build-release.sh` is the release build, and `release.yml` runs exactly this script for everything it uploads. It builds *both* channels into one directory (`release-dist` by default) and publishes neither: `<out>/npm/*.tgz` (`pnpm pack` for every package that is not `private`, so the `files` allow-list, the `prepack` artifact guard and the `workspace:^` rewrite all apply) and `<out>/plugins/*` (each private package's own `pack` script), plus `SHA256SUMS` over both. The workflow publishes those very tarballs and attaches those very archives, reading `<out>/manifest.json` to know which file belongs to which package. Run before a release, it is the one look at an npm artifact anyone gets while it can still be fixed.

```bash
node scripts/set-versions.mjs ssplayer-core@7.0.0-beta.2 && node scripts/sync-doc-versions.mjs   # the versions a release would set
scripts/build-release.sh                          # -> release-dist/
git checkout -- .                                 # put the versions back
```

**The verification is what earns the script its keep**, and every check in it is a failure that would otherwise ship: `workspace:` left in a packed manifest; a `files` entry missing from the tarball; `ssplayer-core` without its second (`dist/`) copy of the wasm, the one its ESM entry loads from beside itself in every bundled app; `ssplayer-webgl` or `ssplayer-pixi` going out under an `ssplayer-core` version whose runtime their CDN bundles do not match; the RPG Maker MZ plugin carrying the SIMD runtime instead of the no-SIMD one, which MZ's NW.js cannot load; `ssplayer.tbp` renamed or holding anything but the one `ssplayer/` folder, since the builder derives the plugin id from the filename; a `{{VERSION}}` left unsubstituted in the TyranoScript readme; and the docs' version pins disagreeing with the manifests. A new private package with a `pack` script fails the run until it is listed in `PLUGIN_ROWS`, the only place the plugin artifact names live.

Both channels are reproducible run to run. The pack scripts write the plugin archives with fflate and stamp every entry 1980-01-01, so the same inputs give the same bytes, and the plugins stage needs no `zip` on any platform.

<br>

---

# SpriteStudio Player for Web のリリース手順

維持者向けです。コントリビューターがこの手順を実行することはありません（[CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください）。

## リリースの手順

このリポジトリの Write ロールを持つ人なら誰でもリリースできます。リリースは `main` での **Release** ワークフローの実行 1 回なので、誰の手元から始めても結果は変わりません。必要なのは `gh`（最初に一度 `gh auth login`）で、npm 側にはリポジトリの `SS_NPM_TOKEN` secret が要ります。これは npm の Granular Access Token で、パッケージへの読み書きの権限と **Bypass 2FA** を有効にしたものです。ワークフローは 2FA の入力に答えられないためです。

パッケージは独立にバージョンを持ち、リリースは設定するバージョンを `<package>@<version>` の組で指定します。`<package>` は `packages/` の下のディレクトリ名です。ワークフローはそれを書き込み、すべてをビルドして検査し、`main` へコミットし、公開パッケージを npm へ publish し、リリースした各パッケージに `<package>-v<version>` のタグと、そのファイル（npm の tarball か、プラグインのアーカイブ）を添付した下書きの GitHub Release を作ります。`scripts/build-release.sh` の `PLUGIN_ROWS` にある private なプラグインは npm には出ません。Release が唯一の配布経路です。プルリクエストはバージョンもリリースノートも持ちません。どちらもここで決めます。

### 1. バージョンを決める

各パッケージが前回のタグから何を得たかを見ます。`workspace:^` で別のパッケージに依存するパッケージは、相手が足したものを必要とするときだけ自分もリリースします。ただし 1 か所だけ、これより厳しい依存があります。`ssplayer-webgl` と `ssplayer-pixi` は CDN 用のバンドルに `ssplayer-core` の wasm glue を組み込み、CDN スニペットはランタイム本体を `ssplayer-core` の版から読み込みます。この 2 つは対でしか動きません。そのため `scripts/SDK_VERSION.txt` の SDK が `ssplayer-core` のタグの時点と変わっていれば、どちらかのプレイヤーをリリースするときは `ssplayer-core` もリリースします。そうしないと `scripts/build-release.sh` が実行を止めます。プレリリース部分のあるバージョン（`7.0.0-beta.2`）は、その語の dist-tag（`beta`）で npm に出るので、`latest` は最後の正式版に残ります。

```bash
git log --oneline ssplayer-core-v7.0.0-beta.1..origin/main -- packages/ssplayer-core
```

### 2. ワークフローを実行する

```bash
gh workflow run release.yml --ref main -f versions="ssplayer-core@7.0.0-beta.2 ssplayer-webgl@7.0.0-beta.2"
gh run watch                                      # run が一覧に出るまで数秒かかる
```

run はバージョンを書き込み、docs のバージョン固定の CDN スニペットを追従させてコミットします。続けて `scripts/build-release.sh` ですべてをビルドして検査し、そのあとで初めてコミットを push し、npm へ publish し、Release の下書きを作ります。push より前に失敗すれば `main` も npm も変わりません。run の途中で `main` が進んでいた場合も、push が拒否されるので同じです。

`versions` を空にすると何も設定せず、まだリリースしていない現在のバージョンをすべて出します。初回のリリースと、失敗した run のやり直しがこれです。`-f release_plugins=false` でプラグインを外せます。`-f publish_npm=false` が飛ばすのは npm だけです。公開パッケージにも tarball を添付した Release は作られるので、npm に出せるようになるまではこれで配れます。あとで `versions` を空にして実行すれば npm にも出ます。

### 3. 下書きを公開する

[Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases) ページで下書きを 1 つずつ開きます。自動生成のノートには、そのパッケージの前回のタグ以降のプルリクエストが、他のパッケージのものも含めてすべて並ぶので、このパッケージが得たものだけに絞ります。添付のファイルを確かめ、**Set as a pre-release** か **Set as the latest release** を選んで、**Publish release** を押します。公開すると `pages.yml` が動き、[ドキュメントサイト](https://cri-middleware.github.io/SSPlayerForWeb/) とサンプルをデプロイします。run を最後まで見届けてから、サイトを開いて確かめます。run が失敗してもサイトは元のまま残ります。原因を直したら run を再実行します。

```bash
gh run watch                                      # pages.yml。run が一覧に出るまで数秒かかる
```

## リリースの取り消し

**npm のバージョンは恒久的です。** 取り下げられず、上書きもできないので、手順 2 の後に見つかった不具合は新しいバージョンで直します。何も publish する前に失敗した run は、そのまま実行し直します。途中で失敗した run は `versions` を空にして実行し直します。npm と Release にすでにあるものは飛ばして残りを終わらせ、push 済みのタグはそのまま使います。下書きは公開するまで消せます。

## リリースのローカルビルド

`scripts/build-release.sh` がリリースのビルドそのもので、`release.yml` はアップロードするものすべてについて、このスクリプトを実行しているだけです。**両方**のチャネルを 1 つのディレクトリ（既定 `release-dist`）にビルドし、どちらも publish しません。`<out>/npm/*.tgz`（`private` でない全パッケージの `pnpm pack`。`files` 許可リスト、`prepack` の成果物ガード、`workspace:^` の書き換えが適用されます）と `<out>/plugins/*`（各 private パッケージ自身の `pack` スクリプトの出力）、そして両方に対する `SHA256SUMS` です。ワークフローはこの tarball とアーカイブをそのまま publish・添付し、どのファイルがどのパッケージのものかを `<out>/manifest.json` から読みます。リリースの前に実行すれば、npm の成果物をまだ直せるうちに確認できる唯一の機会になります。

```bash
node scripts/set-versions.mjs ssplayer-core@7.0.0-beta.2 && node scripts/sync-doc-versions.mjs   # リリースが設定するバージョン
scripts/build-release.sh                          # -> release-dist/
git checkout -- .                                 # バージョンを元に戻す
```

**このスクリプトの価値は検査にあります。** どの検査も、無ければそのまま出荷される失敗です。packed manifest に残った `workspace:`、tarball から欠けた `files` エントリ、ESM の入口が自分の隣から読み込む 2 つめ（`dist/`）の wasm コピーを欠いた `ssplayer-core`（バンドラで組んだアプリはすべてこれを読みます）、CDN 用バンドルと合わないランタイムの `ssplayer-core` の版のまま出る `ssplayer-webgl` / `ssplayer-pixi`、no-SIMD ではなく SIMD ランタイムを同梱した RPG ツクール MZ プラグイン（MZ の NW.js は読み込めません）、改名されたか `ssplayer/` フォルダ以外を含む `ssplayer.tbp`（ビルダーはファイル名からプラグイン ID を導きます）、TyranoScript の readme に残った未置換の `{{VERSION}}`、そして docs のバージョンピンと manifest の不一致。`pack` スクリプトを持つ private パッケージを追加すると、`PLUGIN_ROWS` に載せるまで実行が失敗します。プラグイン成果物の名前が書かれているのは今はそこだけです。

どちらのチャネルも実行ごとに再現可能です。プラグインのアーカイブは pack スクリプトが fflate で書き出し、全エントリの日時を 1980-01-01 に固定しているので、入力が同じならバイト列も同じになります。plugins 段はどのプラットフォームでも `zip` を必要としません。
