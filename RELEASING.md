# Releasing SSPlayerForWeb

Maintainers only. Contributors do not run any of this — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Building the documentation site

```bash
scripts/prepare-docs.sh    # pnpm install + the SDK wasm
scripts/build-docs.sh      # TypeDoc, then VitePress -> docs/.vitepress/dist
```

`pages.yml` runs `build-docs.sh` too, so CI and a local build cannot drift. Two options earn their
keep: `api=no` skips TypeDoc when only prose changed, and `base=/SSPlayerForWeb/` sets `DOCS_BASE`
the way the project site needs it. **Building the docs is the only gate there is** — nothing builds
them on a pull request, and a dead link fails the build, VitePress checking by default. This is
*one* build for both locales, VitePress resolving `docs/ja` itself, which is why this
`build-docs` takes no `locale=` where the Zensical player repos' do. The wasm is not optional:
TypeDoc parses `packages/*/src`, which import the bindings.

`docs/.vitepress/config.mts` builds the Open Graph and Twitter Card tags in `transformHead`, from
the title and description VitePress has already resolved. **One code path serves both locales** —
Japanese cards come from `locales.ja.description`, so localize by adding a per-locale config value,
never by branching on the locale inside `transformHead`. `og:url` is built from `SITE_URL`,
deliberately not from `base`, which is `/` during local dev.

## Building the whole published site

`scripts/build-pages.sh` builds everything into one directory (`_site` by default): the docs at the
root, `ssconverter-web` for every schema version in `versions.json` under `/ssconverter/`, and the
five examples under `/examples/`. `pages.yml` runs this same script, keeping only what is GitHub's
— the checkout, the toolchain, the artifact upload and the deploy.

`base=` defaults to `/<repo>/`, because a project site is served under it and a site built for `/`
looks fine locally and 404s once deployed. `skip=<stages>` is what makes the script usable while
iterating (`skip=install,wasm,packages,assets,rmmz,tyranoscript,ssconverter` rebuilds the docs
alone); a skipped stage leaves its part out with a warning, while a stage that ran and produced
nothing is an error. `sdk=download`, the default, takes the prebuilt wasm for
`scripts/SDK_VERSION.txt`; `sdk=build` compiles it from the submodule and is the way through while
that SDK release does not exist yet — but it reaches the `ssconverter` stage **only as far as the
one schema version whose `sdk` tag matches `SDK_VERSION.txt`**, every other version still
downloading the release it pins, which is the point of pinning it. Each version logs which of the
two it took.

Three things it needs that `pnpm install` does not: the SpriteStudio-SDK submodule, network
access, and — on the `.sh` path only — `jq`, which the `.ps1` twin does without.

## Cutting a release

A release is a maintainer running the **Release** workflow on `main` once the accumulated
changesets are worth shipping. Packages are versioned independently through Changesets; the
branching model follows from that and is described in [CONTRIBUTING.md](./CONTRIBUTING.md).

`scripts/build-release.sh` builds *both* channels into one directory (`release-dist` by default)
and publishes neither: `<out>/npm/*.tgz` (`pnpm pack` for every package that is not `private`, so
the `files` allow-list, the `prepack` artifact guard and the `workspace:^` rewrite all apply
exactly as they would on publish) and `<out>/plugins/*` (each private package's own `pack` script
— the files `release.yml` attaches to the per-plugin GitHub Releases), plus `SHA256SUMS` over
both. `release.yml` runs it for the plugin assets it uploads, so the archives a maintainer looks
over are the ones the Releases carry, and the workflow reads `<out>/manifest.json` to know which
file belongs to which package.

The npm half is the exception and cannot be otherwise: `changeset publish` packs from the
workspace itself, so there is no tarball to hand it. Building them locally buys the only look at
an npm artifact anyone gets while it can still be fixed, since a published version is immutable.
The script never bumps a version — `changeset version` runs inside the release — so a local run
beforehand produces artifacts one bump behind, and it says so, naming what each package would
become, when changesets are pending or pre mode is active.

**The verification is what earns the script its keep**, and every check in it is a failure that
would otherwise ship: `workspace:` left in a packed manifest; a `files` entry missing from the
tarball; `ssplayer-core` without its second (`dist/`) copy of the wasm that the CDN snippets load
by URL; the RPG Maker MZ plugin carrying the SIMD runtime instead of the no-SIMD one, which MZ's
NW.js cannot load; `ssplayer.tbp` renamed or holding anything but the one `ssplayer/` folder,
since the builder derives the plugin id from the filename; a `{{VERSION}}` left unsubstituted in
the TyranoScript readme; and the docs' version pins disagreeing with the manifests. A new private
package with a `pack` script fails the run until it is listed in `PLUGIN_ROWS`, the only place the
plugin artifact names live.

The npm tarballs are reproducible run to run; the plugin archives are not, because `zip` stores
mtimes, so compare those by content rather than by hash. The Windows twin needs `zip` on PATH for
the plugins stage, which Windows does not ship.

<br>

---

# SSPlayerForWeb のリリース手順

維持者向けです。コントリビューターがこの手順を実行することはありません（[CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください）。

## ドキュメントサイトのビルド

```bash
scripts/prepare-docs.sh    # pnpm install と SDK の wasm
scripts/build-docs.sh      # TypeDoc のあと VitePress -> docs/.vitepress/dist
```

`pages.yml` も `build-docs.sh` を実行するので、CI と手元のビルドがずれません。役に立つオプションは
2 つです。文章だけを直したときに TypeDoc を飛ばす `api=no` と、プロジェクトサイトに必要な
`DOCS_BASE` を設定する `base=/SSPlayerForWeb/` です。**ゲートはこのビルドだけです。** プルリクエストでは docs はビルドされず、リンク切れはビルドを失敗させます（VitePress の既定の挙動）。VitePress が
`docs/ja` を自分で解決するため、これは両ロケールを**一度に**ビルドします。Zensical の Player 群の
`build-docs` が `locale=` を取るのに対し、こちらが取らないのはそのためです。wasm は省略できません。
TypeDoc が読む `packages/*/src` がバインディングを import しているからです。

`docs/.vitepress/config.mts` は Open Graph / Twitter Card タグを `transformHead` で、VitePress が解決済みのタイトルと説明から組み立てます。**1 つのコードパスが両ロケールを賄います。** 日本語のカードは `locales.ja.description` から来るので、ローカライズはロケールごとの設定値を足して行い、
`transformHead` の中でロケール分岐を書かないでください。`og:url` は `base` ではなく `SITE_URL` から作ります（`base` はローカル開発では `/` になるためです）。

## 公開サイト全体のビルド

`scripts/build-pages.sh` が全体を 1 つのディレクトリ（既定 `_site`）に組み立てます。ルートに docs、
`/ssconverter/` に `versions.json` の各スキーマバージョンの `ssconverter-web`、`/examples/` にサンプル 5 本です。`pages.yml` も同じスクリプトを実行し、GitHub 側の仕事（チェックアウト、ツールチェイン、アーティファクトのアップロード、デプロイ）だけを持ちます。

`base=` の既定は `/<repo>/` です。プロジェクトサイトはその下で配信されるため、`/` 向けに建てたサイトはローカルでは問題なく見えて、デプロイすると 404 します。`skip=<stages>` が反復作業を可能にします（`skip=install,wasm,packages,assets,rmmz,tyranoscript,ssconverter` で docs だけ建て直せます）。スキップした段はその部分をサイトから外し警告を出しますが、走ったのに何も出さなかった段はエラーです。既定の `sdk=download` は `scripts/SDK_VERSION.txt` のビルド済み wasm を取得します。`sdk=build` は
submodule からコンパイルし、その SDK リリースがまだ無いときの回避路ですが、`ssconverter` 段に届くのは **`sdk` タグが `SDK_VERSION.txt` と一致するスキーマバージョン 1 つだけ**です。他のバージョンは自分がピンしたリリースをダウンロードし続けます（それがピンの意味です）。どちらを取ったかは各バージョンがログに出します。

`pnpm install` では足りないものが 3 つあります。SpriteStudio-SDK submodule、ネットワーク、そして
`.sh` の経路でのみ `jq` です（`.ps1` 双子は `ConvertFrom-Json` で済ませます）。

## リリースの手順

リリースとは、溜まった changeset が出荷に値するようになったときに、維持者が `main` で **Release**
ワークフローを実行することです。パッケージは Changesets により独立にバージョニングされ、ブランチモデルはそこから導かれます（[CONTRIBUTING.md](./CONTRIBUTING.md) に記載）。

`scripts/build-release.sh` は**両方**のチャンネルを 1 つのディレクトリ（既定 `release-dist`）にビルドし、どちらも publish しません。`<out>/npm/*.tgz`（`private` でない全パッケージの `pnpm pack`。
`files` 許可リスト、`prepack` の成果物ガード、`workspace:^` の書き換えが publish と同じように適用されます）と `<out>/plugins/*`（各 private パッケージ自身の `pack` スクリプトの出力。
`release.yml` がプラグインごとの GitHub Release に添付するファイルそのもの）、そして両方に対する
`SHA256SUMS` です。`release.yml` はアップロードするプラグイン asset のためにこれを実行するので、維持者が確認するアーカイブが Release に載るものと同一になります。どのファイルがどのパッケージのものかは、ワークフローが `<out>/manifest.json` から読みます。

npm 側だけは例外で、そうする他にありません。`changeset publish` はワークスペースから直接
pack するため、渡せる tarball が存在しないのです。ローカルでビルドしておくことが、npm の成果物をまだ直せるうちに確認できる唯一の機会になります（publish 済みのバージョンは変更できません）。このスクリプトはバージョンを上げません（`changeset version` はリリースの中で走ります）。したがって事前のローカル実行は 1 バンプ古い成果物を作ります。changeset が未処理のときや pre モードのときは、各パッケージがどのバージョンになるかを明示してそう伝えます。

**このスクリプトの価値は検査にあります。** どの検査も、無ければそのまま出荷される失敗です。
packed manifest に残った `workspace:`、tarball から欠けた `files` エントリ、CDN スニペットが URL で読み込む 2 つめ（`dist/`）の wasm コピーを欠いた `ssplayer-core`、no-SIMD ではなく SIMD ランタイムを同梱した RPG ツクール MZ プラグイン（MZ の NW.js は読み込めません）、改名されたか `ssplayer/`
フォルダ以外を含む `ssplayer.tbp`（ビルダーはファイル名からプラグイン ID を導きます）、
TyranoScript の readme に残った未置換の `{{VERSION}}`、そして docs のバージョンピンと manifest の不一致。`pack` スクリプトを持つ private パッケージを追加すると、`PLUGIN_ROWS` に載せるまで実行が失敗します。プラグイン成果物の名前が書かれているのは今はそこだけです。

npm の tarball は実行ごとに再現可能ですが、プラグインのアーカイブは再現しません（`zip` が mtime を格納するため）。そちらはハッシュではなく中身で比較してください。Windows 双子は plugins 段で PATH 上の
`zip` を必要とします（Windows には同梱されていません）。
