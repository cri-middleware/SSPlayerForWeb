# Releasing SpriteStudio Player for Web

Maintainers only. Contributors do not run any of this — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Cutting a release

Anyone with the Write role on this repository can cut a release: it is one run of the **Release** workflow on `main`, so nothing depends on whose machine starts it. You need `git`, `gh` 2.87 or later (run `gh auth login` once) and `jq`, and for step 6, `npm` signed in to an account that can publish to the `@spritestudio` scope. The repository needs GitHub Pages enabled with GitHub Actions as its source, and a `*-v*` tag rule on its `github-pages` environment, or publishing a Release deploys nothing; both are settings a repository admin makes. Each public package on npm needs a trusted publisher for this repository's `release.yml`, allowed to stage. npm sets one up only for a package it already has, so a package's first version goes out by hand (step 6). The commands are bash: in zsh, run `setopt interactive_comments` first, so that the `#` comments are not taken as arguments; on Windows, use Git Bash.

Packages are versioned independently, and a release names the versions it sets, as `<package>@<version>` pairs where `<package>` is the directory under `packages/`. A release can carry the four public packages, which go to npm, and the private plugins listed in `PLUGIN_ROWS` in `scripts/build-release.sh`, whose Release is their only channel. What each version gained is written in its package's `CHANGELOG.md` and nowhere else: a Release carries the package's file and a link to that changelog. A contributor's pull request carries no version and no changelog entry — both are written here. There is no release branch: what `main` holds is what goes out, so `main` holds only what can ship.

Every block runs as written in a new shell: it works out what it needs from git and GitHub. One value is set by hand, written as a placeholder to fill in: `<versions>`, the pairs from step 1 in quotes, in step 4 and its retry under [Undoing a release](#undoing-a-release). A block that acts on a draft or a staged version takes it as `<tag>` or `<stage-id>` the same way. Left as it is, a placeholder stops its line with a syntax error, and a list left unquoted leaves `VERSIONS` unset, which the dispatch refuses: an empty `versions` is the retry of whatever is not yet released.

An agent can run every block. A person sorts the scan's matches in step 3, decides two steps — the merge in step 2, which puts the notes on `main`, and step 7, which publishes the Releases for good — and runs step 6, which asks for a 2FA code.

### 1. Decide the versions

Look at what each package gained since its previous tag. A package that depends on another through `workspace:^` needs a release of its own only when it needs what the other added. One dependency is stricter than that: `ssplayer-webgl` and `ssplayer-pixi` build `ssplayer-core`'s wasm glue into their CDN bundles, while the CDN snippets load the runtime itself from `ssplayer-core`'s version, and the two work only as a pair. So once `scripts/SDK_VERSION.txt` names another SDK than it did at `ssplayer-core`'s tag, releasing either player means releasing `ssplayer-core` too, and `scripts/build-release.sh` stops the run otherwise. A version with a prerelease part (`7.0.0-beta.2`) goes to npm under that word's dist-tag (`beta`), and only a full release moves `latest`.

```bash
git fetch origin --tags
for pkg in $(git ls-tree -r --name-only origin/main -- packages | sed -n 's|^packages/\([^/]*\)/CHANGELOG\.md$|\1|p'); do   # every package a release can carry
  prev=$(git -c versionsort.suffix=- tag --list "$pkg-v*" --sort=-v:refname | head -n 1)
  echo "== $pkg, last released: ${prev:-never}"
  git log --oneline ${prev:+"$prev.."}origin/main -- "packages/$pkg"
done
prev=$(git -c versionsort.suffix=- tag --list 'ssplayer-core-v*' --sort=-v:refname | head -n 1)
[ -z "$prev" ] || git diff --stat "$prev" origin/main -- scripts/SDK_VERSION.txt   # any output: a player release takes ssplayer-core along
```

A run releases every package whose current version has no Release yet, named or not. So the first release names every package at the version it already has, or leaves the plugins out with `-f release_plugins=false`:

```text
ssplayer-core@7.0.0-beta.1 ssplayer-webgl@7.0.0-beta.1 ssplayer-pixi@7.0.0-beta.1 ssconverter-core@7.0.0-beta.1 ssplayer-rmmz@7.0.0-beta.1 ssplayer-tyranoscript@7.0.0-beta.1 ssplayer-tyranobuilder@7.0.0-beta.1
```

Step 4 takes the decision in place of its `<versions>`, in quotes, as in `"ssplayer-core@7.0.0-beta.2 ssplayer-webgl@7.0.0-beta.2"`.

### 2. Write the changelog

For each package being released, write what it gained under `## [Unreleased]` in `packages/<dir>/CHANGELOG.md`, in Keep a Changelog's sections (`### Added`, `### Changed`, `### Fixed`, `### Removed`), and merge it into `main` with a pull request. If a dependency the packages bundle changed, bring `THIRD_PARTY_NOTICES.md` up to date in the same pull request. The release turns each `## [Unreleased]` into `## [<version>] - <date>`, and stops before building anything when a package it releases has nothing there.

```bash
git switch -c release-notes origin/main
# write under ## [Unreleased] in packages/<dir>/CHANGELOG.md
git add packages/*/CHANGELOG.md THIRD_PARTY_NOTICES.md
git commit -m "docs: changelog for the next release"
git push -u origin release-notes
gh pr create -B main --fill
```

**A person runs the merge**, which puts the notes on `main`: choose **Create a merge commit** on the pull request's page, or run

```bash
gh pr merge release-notes --merge --delete-branch
```

### 3. Build the site and scan the code

`pages.yml` builds the site only once a Release is published, from its tag, and a re-run builds that same tag: a fault in the docs or the examples found then can only be fixed in `main` and deployed from there. So build the site now, from the `main` the release will be cut from. `scripts/build-pages.sh` is the script `pages.yml` runs, and it needs the SpriteStudio-SDK submodule and network access. A failure is fixed by a pull request into `main` before step 4.

```bash
git switch main && git pull --ff-only && git submodule update --init
scripts/build-pages.sh                            # -> _site/, the site pages.yml would deploy
```

Then scan `main` for code copied from others. `provenance.yml` runs SCANOSS, which matches the tracked files against public open-source code by sending their fingerprints rather than the code, and ScanCode, which finds copyright and license notices. It keeps both reports and a summary of what they found on the run (`provenance`); the block downloads them into `qa/<run ID>` and prints the summary. **A person sorts the matches.** A match with the earlier SpriteStudio Players and SDK is our own code. A match with a library this repository bundles must be listed in `THIRD_PARTY_NOTICES.md`. Anything else is rewritten, unless its license, read at its source, is compatible with BSD-3-Clause and the code keeps the notice that license asks for. Fix a match by a pull request into `main` before step 4, and run the block again.

```bash
RUN=$(gh workflow run provenance.yml --ref main | sed 's|.*/||')
gh run watch "${RUN:?}" --exit-status &&
  gh run download "${RUN:?}" -n provenance -D "qa/$RUN" &&
  cat "qa/$RUN/summary.md"
```

### 4. Run the release

```bash
VERSIONS=<versions>                               # the pairs from step 1, in quotes
RUN=$(gh workflow run release.yml --ref main -f versions="${VERSIONS:?}" | sed 's|.*/||')
gh run watch "${RUN:?}" --exit-status
```

The run writes the versions, dates their changelog sections, repoints the version-pinned snippets in the package READMEs and `examples/cdn`, and commits; then it builds and checks everything with `scripts/build-release.sh`, and only after that pushes the commit, gives every package it releases a `<package>-v<version>` tag, drafts its Release, and stages each public package on npm, where it waits for step 6. A failure before the push leaves `main` untouched, and so does a `main` that moved during the run, which rejects the push. Then see what it made:

```bash
git fetch origin --tags
git log --oneline -1 origin/main                  # chore(release): <the versions>
gh release list --json tagName,isDraft -q '.[] | select(.isDraft) | .tagName'   # its drafts
```

`-f release_plugins=false` leaves the plugins out. A package npm does not have yet cannot be staged, so a run that releases one — the first release is one — adds `-f publish_npm=false`, and step 6 publishes it by hand.

### 5. Check the drafts

Each draft carries its package's file and a link to its changelog. Look at the files before anything on npm is approved: until then, a fault is undone by deleting the draft and rejecting what was staged (see [Undoing a release](#undoing-a-release)), and after it, only a new version fixes it.

```bash
dir=$(mktemp -d)
for tag in $(gh release list --json tagName,isDraft -q '.[] | select(.isDraft) | .tagName'); do
  gh release download "$tag" -D "$dir/$tag"
done
ls -R "$dir"                                      # one file each: a .tgz for npm, an archive for a plugin
```

`tar -tzf <file>.tgz` lists what an npm tarball holds, and `unzip -l <file>` what a plugin's archive holds.

### 6. Approve on npm

**A person runs this step**: approving, like publishing by hand, asks for a 2FA code. A version the run staged stays out of sight on npm until a maintainer approves it, and approving applies the dist-tag it was staged under. Approve before any Release is published, so that by the time a Release announces a version, `npm install` and the CDN snippets in the READMEs find it; and in dependency order — `ssplayer-core` and `ssconverter-core`, then `ssplayer-webgl` and `ssplayer-pixi` — so that no version is public before one it depends on. Approve on npmjs.com, or here:

```bash
npm login                                         # once
for pkg in ssplayer-core ssconverter-core ssplayer-webgl ssplayer-pixi; do
  npm stage list "@spritestudio/$pkg"             # each staged version, with its stage id
done
npm stage approve <stage-id>                      # once per staged version, in the order above
```

A package the run did not stage — every one in a run with `publish_npm=false`, and any after a failed **Stage on npm** — is published by hand instead, from the very tarball on its draft. The loop goes in dependency order and stops at the first failure, and it takes the dist-tag from the version: the prerelease's word (`beta`), or `latest` for a full release.

```bash
dir=$(mktemp -d)
drafts=$(gh release list --json tagName,isDraft -q '.[] | select(.isDraft) | .tagName')
for pkg in ssplayer-core ssconverter-core ssplayer-webgl ssplayer-pixi; do   # dependencies first; leave out any the run staged
  tag=$(printf '%s\n' "$drafts" | grep "^$pkg-v" || true)
  [ -n "$tag" ] || continue
  version=${tag#"$pkg-v"}
  case "$version" in *-*) dist=${version#*-}; dist=${dist%%.*} ;; *) dist=latest ;; esac
  gh release download "$tag" -p '*.tgz' -D "$dir/$tag"
  npm publish "$dir/$tag"/*.tgz --tag "$dist" --access public || break
  npm view "@spritestudio/$pkg" dist-tags
done
```

### 7. Publish the Releases

**A person publishes the Releases**: a published Release is permanent. Nothing on a draft needs writing, and a version with a `-` is already marked as a pre-release. Publishing starts `pages.yml`, which deploys the [documentation site](https://cri-middleware.github.io/SSPlayerForWeb/) and the examples.

```bash
for tag in $(gh release list --json tagName,isDraft -q '.[] | select(.isDraft) | .tagName'); do
  gh release edit "$tag" --draft=false
done
```

Then watch the deploy. Every Release published starts a run of its own; they queue, and a newer one replaces one still waiting, which then shows as cancelled, so the run to watch is the one for the Release published last. The block finds that Release itself, and waits up to a minute for its run, which appears a few seconds after it.

```bash
tag=$(gh release list --json tagName,publishedAt,isDraft -q '[.[] | select(.isDraft | not)] | sort_by(.publishedAt) | last | .tagName')
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  RUN=$(gh run list -w pages.yml -b "${tag:?}" -L 1 --json databaseId -q '.[0].databaseId')
  [ -n "$RUN" ] && break
  sleep 5
done
gh run watch "${RUN:?}" --exit-status
```

Then open the site. A failed run leaves the site as it was. When the cause was a setting outside the repository, re-run it with `gh run rerun <run-id>`, the run the block watched; a fix in the repository goes into `main` by pull request and deploys with `gh workflow run pages.yml --ref main`.

## Undoing a release

**A version npm has made public is permanent**, whether approved or published by hand: it cannot be withdrawn, only superseded. So is a published Release, whose file users have downloaded by its tag. A fault found after either is fixed by a new version. A staged version is not public yet, and `npm stage reject <stage-id>` removes it (a person, with 2FA). Before that:

*   A run that failed before the push is run again with the same versions, once the cause is fixed in `main`. The **Re-run** button would replay the old commit, and its push would be rejected.

    ```bash
    VERSIONS=<versions>                               # the pairs from step 1, in quotes
    RUN=$(gh workflow run release.yml --ref main -f versions="${VERSIONS:?}" | sed 's|.*/||')
    gh run watch "${RUN:?}" --exit-status
    ```

*   A run that failed after the push is run again with `versions` empty, before anything else is merged into `main`: the retry builds `main` as it then is, reuses the tags it had pushed, drafts the Releases still missing, and stages what npm does not have, skipping a version already staged.

    ```bash
    RUN=$(gh workflow run release.yml --ref main | sed 's|.*/||')
    gh run watch "${RUN:?}" --exit-status
    ```

*   A fault found in a draft takes its tag down too. Delete the draft of every package the fault reaches — `ssplayer-webgl` and `ssplayer-pixi` carry `ssplayer-core`'s wasm glue in their CDN bundles — and reject what the run staged for them. Merge the fix into `main`, correcting the version's changelog section if it needs it, and run again with `versions` empty, which tags the same versions on the fixed `main` and stages them again.

    ```bash
    gh release delete --cleanup-tag --yes <tag>       # once per draft; deletes the tag too, here and on GitHub
    npm stage reject <stage-id>                       # once per staged version; a person, with 2FA
    ```

## Building the release locally

`scripts/build-release.sh` is the release build, and `release.yml` runs exactly this script for everything it uploads. It builds *both* channels into one directory (`release-dist` by default) and publishes neither: `<out>/npm/*.tgz` (`pnpm pack` for every package that is not `private`, so the `files` allow-list, the `prepack` artifact guard and the `workspace:^` rewrite all apply) and `<out>/plugins/*` (each private package's own `pack` script), plus `SHA256SUMS` over both. The workflow stages those very tarballs and attaches those very archives, reading `<out>/manifest.json` to know which file belongs to which package. It builds under the versions the working tree has and sets none, so it can be run on any checkout to see what the packages would ship:

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

このリポジトリの Write ロールを持つ人なら誰でもリリースできます。リリースは `main` での **Release** ワークフローの実行 1 回なので、誰の手元から始めても結果は変わりません。必要なのは `git`、`gh` 2.87 以降（最初に一度 `gh auth login`）、`jq`、それに手順 6 のための `npm` で、`@spritestudio` scope に publish できるアカウントでログインしておきます。リポジトリ側では、GitHub Pages を有効にしてソースを GitHub Actions にし、`github-pages` environment に `*-v*` のタグのルールを足しておく必要があります。どちらかが欠けると、Release を公開しても何もデプロイされません。どちらもリポジトリの admin が行う設定です。npm 側では、公開パッケージごとに、このリポジトリの `release.yml` を trusted publisher として登録し、stage を許可しておきます。npm はすでにあるパッケージにしか trusted publisher を設定できないので、パッケージの最初のバージョンは手作業で出します（手順 6）。コマンドは bash です。zsh では、`#` のコメントが引数として渡されないよう、先に `setopt interactive_comments` を実行します。Windows では Git Bash を使います。

パッケージは独立にバージョンを持ち、リリースは設定するバージョンを `<package>@<version>` の組で指定します。`<package>` は `packages/` の下のディレクトリ名です。リリースで出せるのは、npm に出す 4 つの公開パッケージと、`scripts/build-release.sh` の `PLUGIN_ROWS` にある private なプラグインです。プラグインは Release が唯一の配布経路です。各バージョンで何が変わったかは、そのパッケージの `CHANGELOG.md` にだけ書きます。Release が持つのはパッケージのファイルと、その changelog へのリンクだけです。コントリビューターのプルリクエストはバージョンも changelog の項目も持ちません。どちらもここで書きます。release ブランチはありません。`main` にあるものがそのまま出るので、`main` には出せるものだけを置きます。

どのブロックも、新しいシェルで書かれたとおりに実行できます。必要なものは git と GitHub から求めます。手で設定する値は 1 つで、埋めるプレースホルダとして書いてあります。手順 4 と「リリースの取り消し」にあるその再実行の `<versions>` で、手順 1 で決めた組を引用符で囲んで入れます。下書きや stage したバージョンに対して操作するブロックも、それを `<tag>` や `<stage-id>` で受け取ります。埋めずに実行すると、その行は構文エラーで止まります。組を引用符で囲み忘れると `VERSIONS` は設定されず、dispatch はそれを拒否します。空の `versions` は、まだリリースしていないものすべての再実行になるためです。

どのブロックもエージェントに実行させられます。手順 3 の照合の一致は人が仕分けます。2 つの手順は人が判断します。ノートを `main` に入れる手順 2 のマージと、取り消せない公開を行う手順 7 です。2FA のコードを求められる手順 6 も人が行います。

### 1. バージョンを決める

各パッケージが前回のタグから何を得たかを見ます。`workspace:^` で別のパッケージに依存するパッケージは、相手が足したものを必要とするときだけ自分もリリースします。ただし 1 か所だけ、これより厳しい依存があります。`ssplayer-webgl` と `ssplayer-pixi` は CDN 用のバンドルに `ssplayer-core` の wasm glue を組み込み、CDN スニペットはランタイム本体を `ssplayer-core` の版から読み込みます。この 2 つは対でしか動きません。そのため `scripts/SDK_VERSION.txt` の SDK が `ssplayer-core` のタグの時点と変わっていれば、どちらかのプレイヤーをリリースするときは `ssplayer-core` もリリースします。そうしないと `scripts/build-release.sh` が実行を止めます。プレリリース部分のあるバージョン（`7.0.0-beta.2`）は、その語の dist-tag（`beta`）で npm に出ます。`latest` を動かすのは正式版だけです。

```bash
git fetch origin --tags
for pkg in $(git ls-tree -r --name-only origin/main -- packages | sed -n 's|^packages/\([^/]*\)/CHANGELOG\.md$|\1|p'); do   # リリースで出せるパッケージすべて
  prev=$(git -c versionsort.suffix=- tag --list "$pkg-v*" --sort=-v:refname | head -n 1)
  echo "== $pkg, last released: ${prev:-never}"
  git log --oneline ${prev:+"$prev.."}origin/main -- "packages/$pkg"
done
prev=$(git -c versionsort.suffix=- tag --list 'ssplayer-core-v*' --sort=-v:refname | head -n 1)
[ -z "$prev" ] || git diff --stat "$prev" origin/main -- scripts/SDK_VERSION.txt   # 何か出たら、プレイヤーのリリースに ssplayer-core も含める
```

run は、指定したかどうかに関わらず、現在のバージョンにまだ Release が無いパッケージをすべて出します。そのため初回のリリースでは、全パッケージをいま持っているバージョンのまま指定するか、`-f release_plugins=false` でプラグインを外します。

```text
ssplayer-core@7.0.0-beta.1 ssplayer-webgl@7.0.0-beta.1 ssplayer-pixi@7.0.0-beta.1 ssconverter-core@7.0.0-beta.1 ssplayer-rmmz@7.0.0-beta.1 ssplayer-tyranoscript@7.0.0-beta.1 ssplayer-tyranobuilder@7.0.0-beta.1
```

手順 4 は、決めた組を引用符で囲んで `<versions>` の位置に受け取ります（`"ssplayer-core@7.0.0-beta.2 ssplayer-webgl@7.0.0-beta.2"` など）。

### 2. changelog を書く

リリースするパッケージごとに、得たものを `packages/<dir>/CHANGELOG.md` の `## [Unreleased]` の下に、Keep a Changelog の節（`### Added`・`### Changed`・`### Fixed`・`### Removed`）で書き、プルリクエストで `main` にマージします。パッケージが同梱する依存が変わっていれば、同じプルリクエストで `THIRD_PARTY_NOTICES.md` も更新します。リリースは各 `## [Unreleased]` を `## [<version>] - <date>` に書き換えます。リリースするパッケージの `## [Unreleased]` が空なら、何もビルドせずに止まります。

```bash
git switch -c release-notes origin/main
# packages/<dir>/CHANGELOG.md の ## [Unreleased] の下に書く
git add packages/*/CHANGELOG.md THIRD_PARTY_NOTICES.md
git commit -m "docs: changelog for the next release"
git push -u origin release-notes
gh pr create -B main --fill
```

**マージは人が行います。** ノートが `main` に入るためです。プルリクエストのページで **Create a merge commit** を選ぶか、次を実行します。

```bash
gh pr merge release-notes --merge --delete-branch
```

### 3. サイトをビルドし、コードを照合する

`pages.yml` がサイトをビルドするのは Release を公開したときだけで、そのタグから作ります。再実行しても同じタグをビルドするだけなので、そこで docs やサンプルの不具合が見つかると、`main` で直してそこからデプロイするしかありません。そこで、リリースを切る `main` から、先にサイトをビルドしておきます。`scripts/build-pages.sh` は `pages.yml` が実行するスクリプトそのもので、SpriteStudio-SDK の submodule とネットワーク接続が要ります。失敗したら、手順 4 の前にプルリクエストで `main` を直します。

```bash
git switch main && git pull --ff-only && git submodule update --init
scripts/build-pages.sh                            # -> _site/。pages.yml がデプロイするサイト
```

続けて、他者のコードを写した箇所が無いかを、`main` で照合します。`provenance.yml` は SCANOSS と ScanCode を実行します。SCANOSS は、追跡しているファイルを公開されているオープンソースのコードと照合します。送るのはコードではなく指紋です。ScanCode は、著作権表示とライセンスの記述を見つけます。2 つの報告と、見つかったものの一覧は run に残ります（`provenance`）。ブロックはそれを `qa/<run ID>` にダウンロードし、一覧を表示します。**一致は人が仕分けます。** 以前の SpriteStudio の Player・SDK との一致は、自社のコードです。このリポジトリが同梱するライブラリとの一致は、`THIRD_PARTY_NOTICES.md` に載っていなければなりません。それ以外は書き直します。残せるのは、出所で確かめたライセンスが BSD-3-Clause と両立し、そのライセンスが求める表示をコードに残すときだけです。一致を直すときは、手順 4 の前にプルリクエストで `main` を直し、このブロックをもう一度実行します。

```bash
RUN=$(gh workflow run provenance.yml --ref main | sed 's|.*/||')
gh run watch "${RUN:?}" --exit-status &&
  gh run download "${RUN:?}" -n provenance -D "qa/$RUN" &&
  cat "qa/$RUN/summary.md"
```

### 4. リリースを実行する

```bash
VERSIONS=<versions>                               # 手順 1 の組を引用符で囲む
RUN=$(gh workflow run release.yml --ref main -f versions="${VERSIONS:?}" | sed 's|.*/||')
gh run watch "${RUN:?}" --exit-status
```

run はバージョンを書き込み、changelog の節に日付を入れ、パッケージの README と `examples/cdn` にあるバージョン固定のスニペットを追従させてコミットします。続けて `scripts/build-release.sh` ですべてをビルドして検査し、そのあとで初めてコミットを push し、リリースする各パッケージに `<package>-v<version>` のタグを打ち、Release の下書きを作り、公開パッケージを npm に stage します。stage したものは手順 6 を待ちます。push より前に失敗すれば `main` は変わりません。run の途中で `main` が進んでいた場合も、push が拒否されるので同じです。終わったら、できたものを確かめます。

```bash
git fetch origin --tags
git log --oneline -1 origin/main                  # chore(release): <指定したバージョン>
gh release list --json tagName,isDraft -q '.[] | select(.isDraft) | .tagName'   # できた下書き
```

`-f release_plugins=false` でプラグインを外せます。npm にまだ無いパッケージは stage できないので、それを出す run（初回のリリースがそうです）には `-f publish_npm=false` を足し、手順 6 で手作業で publish します。

### 5. 下書きを確かめる

下書きには、パッケージのファイルと changelog へのリンクが入っています。npm で何か承認する前に、ファイルを確かめます。それまでなら、下書きを消して stage したものを取り下げれば取り消せますが（「リリースの取り消し」を参照）、承認した後は新しいバージョンでしか直せません。

```bash
dir=$(mktemp -d)
for tag in $(gh release list --json tagName,isDraft -q '.[] | select(.isDraft) | .tagName'); do
  gh release download "$tag" -D "$dir/$tag"
done
ls -R "$dir"                                      # 1 つずつ。npm 用は .tgz、プラグインはアーカイブ
```

npm の tarball の中身は `tar -tzf <file>.tgz`、プラグインのアーカイブの中身は `unzip -l <file>` で一覧できます。

### 6. npm で承認する

**この手順は人が行います。** 承認も、手作業の publish も、2FA のコードを求められるためです。run が stage したバージョンは、maintainer が承認するまで npm 上で見えないままで、承認すると stage したときの dist-tag が付きます。どの Release を公開するよりも先に承認し、Release がバージョンを告知する時点で、`npm install` と README の CDN スニペットがそのバージョンを見つけられるようにします。順番は依存の順で、`ssplayer-core` と `ssconverter-core`、続けて `ssplayer-webgl` と `ssplayer-pixi` です。依存先より先に公開されるバージョンが無いようにするためです。承認は npmjs.com でも、次のコマンドでもできます。

```bash
npm login                                         # 最初に一度
for pkg in ssplayer-core ssconverter-core ssplayer-webgl ssplayer-pixi; do
  npm stage list "@spritestudio/$pkg"             # stage されたバージョンと、その stage id
done
npm stage approve <stage-id>                      # stage されたバージョンごとに 1 回。上の順に
```

run が stage しなかったパッケージは、下書きに添付された tarball そのものを手作業で publish します。`publish_npm=false` で実行した run のパッケージすべてと、**Stage on npm** が失敗した後のパッケージがこれにあたります。ループは依存の順に進んで最初の失敗で止まり、dist-tag をバージョンから決めます。プレリリースならその語（`beta`）、正式版なら `latest` です。

```bash
dir=$(mktemp -d)
drafts=$(gh release list --json tagName,isDraft -q '.[] | select(.isDraft) | .tagName')
for pkg in ssplayer-core ssconverter-core ssplayer-webgl ssplayer-pixi; do   # 依存先から。run が stage したものは外す
  tag=$(printf '%s\n' "$drafts" | grep "^$pkg-v" || true)
  [ -n "$tag" ] || continue
  version=${tag#"$pkg-v"}
  case "$version" in *-*) dist=${version#*-}; dist=${dist%%.*} ;; *) dist=latest ;; esac
  gh release download "$tag" -p '*.tgz' -D "$dir/$tag"
  npm publish "$dir/$tag"/*.tgz --tag "$dist" --access public || break
  npm view "@spritestudio/$pkg" dist-tags
done
```

### 7. Release を公開する

**Release の公開は人が行います。** 公開した Release は取り消せないためです。下書きに書き足すものはありません。`-` を含むバージョンは、すでに pre-release になっています。公開すると `pages.yml` が動き、[ドキュメントサイト](https://cri-middleware.github.io/SSPlayerForWeb/) とサンプルをデプロイします。

```bash
for tag in $(gh release list --json tagName,isDraft -q '.[] | select(.isDraft) | .tagName'); do
  gh release edit "$tag" --draft=false
done
```

続けてデプロイを見届けます。Release を 1 つ公開するごとに run が 1 つ始まります。run は順に並び、待っている run は新しい run に置き換えられて cancelled と表示されるので、見届けるのは最後に公開した Release の run です。ブロックはその Release を自分で探し、run が一覧に出るまで最大 1 分待ちます。run は Release の公開から数秒遅れて出るためです。

```bash
tag=$(gh release list --json tagName,publishedAt,isDraft -q '[.[] | select(.isDraft | not)] | sort_by(.publishedAt) | last | .tagName')
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  RUN=$(gh run list -w pages.yml -b "${tag:?}" -L 1 --json databaseId -q '.[0].databaseId')
  [ -n "$RUN" ] && break
  sleep 5
done
gh run watch "${RUN:?}" --exit-status
```

終わったら、サイトを開いて確かめます。run が失敗してもサイトは元のまま残ります。原因がリポジトリの外の設定にあったなら、ブロックが見届けた run を `gh run rerun <run-id>` で再実行します。リポジトリ内の修正は、プルリクエストで `main` に入れてから `gh workflow run pages.yml --ref main` でデプロイします。

## リリースの取り消し

**npm で公開されたバージョンは恒久的です。** 承認したものも手作業で publish したものも、取り下げられず、新しいバージョンで置き換えるしかありません。公開した Release も同じで、利用者はそのタグでファイルを取得しています。どちらかの後に見つかった不具合は、新しいバージョンで直します。stage しただけのバージョンはまだ公開されておらず、`npm stage reject <stage-id>` で取り下げられます（人が 2FA で行います）。それより前なら次のとおりです。

*   push より前に失敗した run は、原因を `main` で直してから、同じバージョンを指定して実行し直します。**Re-run** ボタンは古いコミットをそのまま再生するので、push が拒否されます。

    ```bash
    VERSIONS=<versions>                               # 手順 1 の組を引用符で囲む
    RUN=$(gh workflow run release.yml --ref main -f versions="${VERSIONS:?}" | sed 's|.*/||')
    gh run watch "${RUN:?}" --exit-status
    ```

*   push の後に失敗した run は、ほかの変更が `main` にマージされる前に、`versions` を空にして実行し直します。やり直しはその時点の `main` をビルドし、push 済みのタグはそのまま使い、まだ無い Release の下書きを作り、npm に無いものを stage します。stage 済みのバージョンは飛ばします。

    ```bash
    RUN=$(gh workflow run release.yml --ref main | sed 's|.*/||')
    gh run watch "${RUN:?}" --exit-status
    ```

*   下書きに不具合が見つかったら、タグもいっしょに消します。不具合が及ぶすべてのパッケージの下書きを消し（`ssplayer-webgl` と `ssplayer-pixi` は CDN 用のバンドルに `ssplayer-core` の wasm glue を含みます）、run がそれらについて stage したものを取り下げます。修正を `main` にマージして（必要ならそのバージョンの changelog の節も直して）、`versions` を空にして実行し直します。直した `main` に同じバージョンのタグが打たれ、もう一度 stage されます。

    ```bash
    gh release delete --cleanup-tag --yes <tag>       # 下書きごとに 1 回。タグも手元と GitHub の両方から消える
    npm stage reject <stage-id>                       # stage されたバージョンごとに 1 回。人が 2FA で行う
    ```

## リリースのローカルビルド

`scripts/build-release.sh` がリリースのビルドそのもので、`release.yml` はアップロードするものすべてについて、このスクリプトを実行しているだけです。**両方**のチャネルを 1 つのディレクトリ（既定 `release-dist`）にビルドし、どちらも publish しません。`<out>/npm/*.tgz`（`private` でない全パッケージの `pnpm pack`。`files` 許可リスト、`prepack` の成果物ガード、`workspace:^` の書き換えが適用されます）と `<out>/plugins/*`（各 private パッケージ自身の `pack` スクリプトの出力）、そして両方に対する `SHA256SUMS` です。ワークフローはこの tarball を npm に stage し、アーカイブをそのまま添付し、どのファイルがどのパッケージのものかを `<out>/manifest.json` から読みます。ビルドは作業ツリーにあるバージョンで行い、バージョンを書き換えないので、どのチェックアウトでも、パッケージが何を出荷するかを確かめるのに使えます。

```bash
scripts/build-release.sh                          # -> release-dist/
```

**このスクリプトの価値は検査にあります。** どの検査も、無ければそのまま出荷される失敗です。packed manifest に残った `workspace:`、tarball から欠けた `files` エントリ、ESM の入口が自分の隣から読み込む 2 つめ（`dist/`）の wasm コピーを欠いた `ssplayer-core`（バンドラで組んだアプリはすべてこれを読みます）、CDN 用バンドルと合わないランタイムの `ssplayer-core` の版のまま出る `ssplayer-webgl` / `ssplayer-pixi`、no-SIMD ではなく SIMD ランタイムを同梱した RPG ツクール MZ プラグイン（MZ の NW.js は読み込めません）、改名されたか `ssplayer/` フォルダ以外を含む `ssplayer.tbp`（ビルダーはファイル名からプラグイン ID を導きます）、TyranoScript の readme に残った未置換の `{{VERSION}}`、そして docs のバージョンピンと manifest の不一致。`pack` スクリプトを持つ private パッケージを追加すると、`PLUGIN_ROWS` に載せるまで実行が失敗します。プラグイン成果物の名前が書かれているのは今はそこだけです。

どちらのチャネルも実行ごとに再現可能です。プラグインのアーカイブは pack スクリプトが fflate で書き出し、全エントリの日時を 1980-01-01 に固定しているので、入力が同じならバイト列も同じになります。plugins 段はどのプラットフォームでも `zip` を必要としません。
