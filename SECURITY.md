# Security Policy

## Supported Versions

SpriteStudio Player for Web is in beta. Fixes are issued against the latest release only — if you
are on an older one, please reproduce on the current release before reporting.

| Version | Supported |
|---|---|
| Latest `7.0.x` release | ✅ |
| Anything older | ❌ |

## Reporting a Vulnerability

**Please do not open a public GitHub Issue for a security problem.** Report it privately through the
official inquiry form:

👉 [**CRI Middleware Inquiry Form (English)**](https://www.webtech.co.jp/contact/en.html)

The English form has no file upload. If you need to send a reproduction, use the
[Japanese Help Center form](https://www.webtech.co.jp/help/ja/spritestudio7/inquiries/ssplayer_tool/),
which takes a zip of up to 8 MB.

Please include:

- What the impact is — crash, out-of-bounds read, arbitrary code execution, information disclosure.
- Steps to reproduce, ideally with a minimal `.ssab` and the smallest page or script needed.
- The package and its version or commit, the SpriteStudio SDK version (`scripts/SDK_VERSION.txt`), your
  browser (or NW.js / Node.js) and its version, and the rendering engine.
- Whether the input that triggers it comes from a trusted source in your project or from somewhere
  untrusted (downloaded content, user-supplied files).

We will confirm receipt, tell you whether we can reproduce it, and let you know when a fix ships.
Please give us a chance to release that fix before disclosing publicly.

### Which repository to report to

Playback is driven by the runtime shared with the other SpriteStudio players, which lives in
SpriteStudio-SDK. If the same problem reproduces on a different SpriteStudio player, it is most likely
in that shared core. Report it here all the same and say so; we will route it.

## Scope Notes

The players load binary animation data (`.ssab`) and hand it to the runtime's WebAssembly build.

**Only the file identifier is checked before the runtime sees the bytes.** `SSABResource` rejects a
buffer without the `"SSAB"` identifier, which catches a truncated download or the wrong file. The
runtime then parses without validating, so a deliberately crafted `.ssab` can still make it read outside
the pack — within the WebAssembly module's memory — or trap.

**Packs can come from the network.** `load(url)` fetches a pack, and instance parts fetch further packs
by the names stored inside it, under the same prefix. Serve `.ssab` from an origin you control and treat
it as content you vouch for; loading packs from an untrusted source is not a supported configuration.

`@spritestudio/ssconverter-core` converts `.sspj` in the browser. It sees only the files its host passes in.

Reports about the known gap above are welcome, but it is already known — a report that demonstrates
impact beyond it is more useful.

---

# セキュリティポリシー

## サポート対象バージョン

SpriteStudio Player for Web は beta 版です。修正は最新リリースに対してのみ提供されます。古いバージョンをご利用の場合は、最新リリースで再現することをご確認のうえご報告ください。

| バージョン | サポート |
|---|---|
| 最新の `7.0.x` リリース | ✅ |
| それ以前 | ❌ |

## 脆弱性の報告

**セキュリティに関する問題は、公開の GitHub Issue に投稿しないでください。** 再現データ（8 MB までの zip ファイル）の添付も可能なヘルプセンターより、非公開でご報告ください。

👉 [**ヘルプセンター（お問い合わせフォーム）**](https://www.webtech.co.jp/help/ja/spritestudio7/inquiries/ssplayer_tool/)

ご報告には以下を含めてください。

- 影響の内容（クラッシュ、境界外読み取り、任意コード実行、情報漏洩など）
- 再現手順。可能であれば最小限の `.ssab` と、必要最小限のページまたはスクリプト
- パッケージとそのバージョンまたはコミット、SpriteStudio SDK のバージョン（`scripts/SDK_VERSION.txt`）、ブラウザ（または NW.js / Node.js）とそのバージョン、描画エンジン
- 引き金となる入力が、プロジェクト内の信頼できるデータか、信頼できない経路（ダウンロードコンテンツ、ユーザーが用意したファイル）由来か

受領の確認、再現可否、修正版の公開時期についてご連絡します。修正を公開するまでの間、公表をお待ちいただけますようお願いします。

### 報告先リポジトリの判断

再生処理は、他の SpriteStudio Player と共通のランタイムが担っており、SpriteStudio-SDK で開発されています。他の SpriteStudio Player でも同じ問題が再現する場合、共通コア側の問題である可能性が高いため、その旨を添えて本リポジトリへご報告ください。こちらで振り分けます。

## 既知の注意点

各プレイヤーはバイナリのアニメーションデータ（`.ssab`）を読み込み、ランタイムの WebAssembly 版へ渡します。

**ランタイムに渡す前に確認するのはファイル識別子だけです。** `SSABResource` は `"SSAB"` 識別子の無いバッファを拒否するため、途中で切れたダウンロードや別のファイルは弾かれます。その後ランタイムは検証を行わずに解析するため、意図的に細工された `.ssab` は、ランタイムにパックの外（WebAssembly モジュールのメモリ内）を読ませたり、トラップを起こしたりする可能性があります。

**パックはネットワークから読み込めます。** `load(url)` はパックを取得し、インスタンスパーツはパック内に記録された名前で、同じプレフィックスの下から別のパックを取得します。`.ssab` は自社管理のオリジンから配信し、内容を保証できるコンテンツとして扱ってください。信頼できない入手元のパックの読み込みはサポート対象外です。

`@spritestudio/ssconverter-core` はブラウザ上で `.sspj` を変換します。参照するのはホストが渡したファイルだけです。

上記の既知の課題に関するご報告も歓迎しますが、すでに把握している内容です。これを超える影響を示すご報告のほうが有用です。
