/*:
 * @target MZ
 * @plugindesc [DEV ONLY] Auto-converts SpriteStudio .sspj projects to .ssab on NW.js test-play. Do not deploy.
 * @author SpriteStudio-SDK
 * @url https://github.com/cri-middleware/SpriteStudio-SDK
 * @help ssplayer-rpgmakermz-devconvert.js
 *
 * DEVELOPER-ONLY companion to ssplayer-rpgmakermz.js.
 *
 * On NW.js test-play it scans <game>/ss_source/ for .sspj projects and converts
 * any that changed into .ssab under <game>/img/spritestudio/<project>/, so you
 * can drop a SpriteStudio project in and just hit Play. It is a no-op in a
 * deployed (browser/mobile) game, which has no filesystem — ship the already
 * converted .ssab and DO NOT include this plugin in your release.
 *
 * ■ BEFORE DEPLOYMENT: delete BOTH this plugin (ssplayer-rpgmakermz-devconvert.js)
 *   AND ssconverter_bg.wasm (~1.4 MB) from js/plugins/, and disable this plugin.
 *   They are only used during NW.js test-play and would only bloat a release.
 *
 * "ssconverter_bg.wasm" is loaded from the same folder as this plugin .js.
 *
 * @param sourceDir
 * @text Source Folder
 * @desc Folder scanned for .sspj (relative to the game root).
 * @type string
 * @default ss_source
 *
 * @param outDir
 * @text Output Folder
 * @desc Where converted .ssab are written (relative to the game root).
 * @type string
 * @default img/spritestudio
 */

/*:ja
 * @target MZ
 * @plugindesc 【開発用】NW.js テストプレイ時に SpriteStudio の .sspj を .ssab へ自動変換します。製品版には含めないでください。
 * @author SpriteStudio-SDK
 * @url https://github.com/cri-middleware/SpriteStudio-SDK
 * @help ssplayer-rpgmakermz-devconvert.js
 *
 * ssplayer-rpgmakermz.js の【開発用】コンパニオンプラグインです。
 *
 * NW.js テストプレイ時に <game>/ss_source/ 内の .sspj を走査し、変更があった
 * プロジェクトを <game>/img/spritestudio/<プロジェクト名>/ へ .ssab として変換
 * します。SpriteStudio プロジェクトを置いてテストプレイするだけで反映されます。
 * デプロイ版（ブラウザ/モバイル）はファイルシステムが無いため何もしません。
 * 変換済みの .ssab を同梱し、本プラグインは製品版に含めないでください。
 *
 * ■ デプロイメント前に：本プラグイン（ssplayer-rpgmakermz-devconvert.js）と
 *   ssconverter_bg.wasm（約1.4MB）の【両方】を js/plugins/ から削除し、本プラグイン
 *   を無効化してください。これらは NW.js テストプレイ時のみ使用し、リリースでは
 *   容量を増やすだけです。
 *
 * "ssconverter_bg.wasm" はこのプラグイン .js と同じフォルダから読み込みます。
 *
 * @param sourceDir
 * @text ソースフォルダ
 * @desc .sspj を探すフォルダ（ゲームルートからの相対）。
 * @type string
 * @default ss_source
 *
 * @param outDir
 * @text 出力フォルダ
 * @desc 変換した .ssab の出力先（ゲームルートからの相対）。
 * @type string
 * @default img/spritestudio
 */
