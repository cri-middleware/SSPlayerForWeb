/*:
 * @target MZ
 * @plugindesc SpriteStudio player for RPG Maker MZ (PixiJS v5 direct-draw). Plays .ssab animations attached to pictures.
 * @author SpriteStudio-SDK
 * @url https://github.com/cri-middleware/SpriteStudio-SDK
 * @help ssplayer-rpgmakermz.js
 *
 * Plays SpriteStudio (.ssab) animations inside RPG Maker MZ, drawn directly into
 * MZ's PixiJS v5 renderer so they respect Z-order with characters and pictures.
 *
 * SETUP
 *   1. Put this file and "ssruntime_bg.wasm" in js/plugins/ssplayer/ and enable
 *      the plugin. Point the "WASM Path" parameter at the .wasm.
 *   2. Convert your .sspj to .ssab (see the developer converter plugin) and place
 *      the output under img/spritestudio/<project>/.
 *   3. Use the "Show SS" plugin command to attach an animation to a picture id.
 *
 * The animation is attached as a CHILD of the picture, so Move Picture / scale
 * apply to it. Playback advances with MZ time (it pauses when the game pauses).
 *
 * The WASM runtime (ssruntime_bg.wasm) is loaded automatically from the same
 * folder as this plugin .js — no path configuration needed.
 *
 * ■ COMPATIBILITY — no special setup
 *   This plugin bundles the no-SIMD (scalar) SpriteStudio runtime, so it runs on
 *   RPG Maker MZ's bundled NW.js as-is — no "chromium-args" or WebAssembly SIMD
 *   flags are required. If the runtime fails to load for any other reason, SS
 *   animations are disabled but the game still runs.
 *
 * ■ DEPLOYMENT — IMPORTANT
 *   SS animations under img/spritestudio/ are loaded dynamically, so RPG Maker
 *   MZ's "Exclude unused files" deployment option WILL DELETE them. Either turn
 *   that option OFF, or copy your img/spritestudio/ folder into the deployed
 *   output afterward.
 *   Also, do NOT deploy the developer converter: remove
 *   ssplayer-rpgmakermz-devconvert.js and ssconverter_bg.wasm from js/plugins/
 *   before release (they are only needed during NW.js test-play).
 *
 * @command showSS
 * @text Show SS
 * @desc Attach an SS animation to a picture id (shows an anchor picture).
 *
 * @arg pictureId
 * @text Picture Id
 * @type number
 * @min 1
 * @max 100
 * @default 1
 *
 * @arg ssab
 * @text SSAB File
 * @desc Path to the .ssab (relative to the game root), e.g. img/spritestudio/Ringo/Ringo.ssab
 * @type string
 * @default
 *
 * @arg animation
 * @text Animation Name
 * @type string
 * @default
 *
 * @arg x
 * @text X
 * @type number
 * @min -100000
 * @max 100000
 * @default 408
 *
 * @arg y
 * @text Y
 * @type number
 * @min -100000
 * @max 100000
 * @default 312
 *
 * @arg scale
 * @text Scale (%)
 * @type number
 * @min 1
 * @max 2000
 * @default 100
 *
 * @arg loop
 * @text Loop Count
 * @desc -1 = infinite, 0/1 = play once.
 * @type number
 * @min -1
 * @default -1
 *
 * @arg signalSwitch
 * @text Signal -> Switch
 * @desc Game switch turned ON when the animation fires a SpriteStudio signal (0 = none).
 * @type switch
 * @default 0
 *
 * @arg wait
 * @text Wait for Completion
 * @desc Hold the event until the animation finishes. Use with a finite loop count (0/1), not an infinite loop.
 * @type boolean
 * @default false
 *
 * @command waitForSS
 * @text Wait for SS
 * @desc Hold the event until the picture's SS animation finishes (non-looping playback).
 * @arg pictureId
 * @text Picture Id
 * @type number
 * @min 1
 * @max 100
 * @default 1
 *
 * @command playSS
 * @text Play SS
 * @arg pictureId
 * @type number
 * @min 1
 * @max 100
 * @default 1
 *
 * @command pauseSS
 * @text Pause SS
 * @arg pictureId
 * @type number
 * @min 1
 * @max 100
 * @default 1
 *
 * @command stopSS
 * @text Stop SS
 * @arg pictureId
 * @type number
 * @min 1
 * @max 100
 * @default 1
 *
 * @command removeSS
 * @text Remove SS
 * @desc Detach the SS animation and erase the anchor picture.
 * @arg pictureId
 * @type number
 * @min 1
 * @max 100
 * @default 1
 */

/*:ja
 * @target MZ
 * @plugindesc RPG Maker MZ 用 SpriteStudio プレイヤー（PixiJS v5 ダイレクトドロー）。ピクチャに .ssab アニメを表示します。
 * @author SpriteStudio-SDK
 * @url https://github.com/cri-middleware/SpriteStudio-SDK
 * @help ssplayer-rpgmakermz.js
 *
 * SpriteStudio（.ssab）アニメを MZ の PixiJS v5 レンダラへ直接描画し、キャラや
 * ピクチャと正しい前後関係（Zオーダー）で表示します。
 *
 * 導入手順
 *   1. 本ファイルと "ssruntime_bg.wasm" を js/plugins/ssplayer/ に置き、プラグイン
 *      を有効化。パラメータ「WASMパス」を .wasm に合わせてください。
 *   2. .sspj を .ssab に変換し（開発用コンバータプラグイン参照）、出力を
 *      img/spritestudio/<プロジェクト名>/ に配置します。
 *   3. プラグインコマンド「SS表示」でピクチャ番号にアニメを割り当てます。
 *
 * アニメはピクチャの子として追加されるため、ピクチャの移動・拡大がそのまま適用
 * されます。再生は MZ の時間に同期し、ゲームのポーズで一緒に止まります。
 *
 * WASM ランタイム（ssruntime_bg.wasm）はこのプラグイン .js と同じフォルダから
 * 自動で読み込まれます。パス設定は不要です。
 *
 * ■ 動作環境 — 追加設定は不要
 *   本プラグインは no-SIMD（スカラー）版 SpriteStudio ランタイムを同梱しているため、
 *   RPG Maker MZ 同梱の NW.js でそのまま動作します。"chromium-args" や WebAssembly
 *   SIMD フラグの追加は不要です。何らかの理由でランタイムの読み込みに失敗した場合は、
 *   SS アニメは無効化されますが、ゲーム自体は動作します。
 *
 * ■ デプロイメント時の重要な注意
 *   img/spritestudio/ の SS アニメは動的にロードされるため、RPG Maker MZ の
 *   「未使用ファイルを削除」オプションで【削除されてしまいます】。同オプションを
 *   OFF にするか、デプロイメント後に img/spritestudio/ フォルダを出力先へコピー
 *   してください。
 *   また、開発用コンバータはデプロイに含めないでください。リリース前に
 *   ssplayer-rpgmakermz-devconvert.js と ssconverter_bg.wasm を js/plugins/ から
 *   削除してください（NW.js テストプレイ時のみ必要です）。
 *
 * @command showSS
 * @text SS表示
 * @desc SS アニメをピクチャ番号に割り当て（アンカーとなるピクチャを表示）。
 *
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 *
 * @arg ssab
 * @text SSABファイル
 * @desc .ssab のパス（ゲームルートからの相対）。例: img/spritestudio/Ringo/Ringo.ssab
 * @type string
 * @default
 *
 * @arg animation
 * @text アニメーション名
 * @type string
 * @default
 *
 * @arg x
 * @text X座標
 * @type number
 * @min -100000
 * @max 100000
 * @default 408
 *
 * @arg y
 * @text Y座標
 * @type number
 * @min -100000
 * @max 100000
 * @default 312
 *
 * @arg scale
 * @text 拡大率(%)
 * @type number
 * @min 1
 * @max 2000
 * @default 100
 *
 * @arg loop
 * @text ループ回数
 * @desc -1 = 無限、0/1 = 1回再生。
 * @type number
 * @min -1
 * @default -1
 *
 * @arg signalSwitch
 * @text シグナル→スイッチ
 * @desc アニメがSpriteStudioシグナルを発火したときONにするスイッチ（0=なし）。
 * @type switch
 * @default 0
 *
 * @arg wait
 * @text 完了までウェイト
 * @desc アニメ終了までイベントを待機します。無限ループではなく有限ループ(0/1)で使用してください。
 * @type boolean
 * @default false
 *
 * @command waitForSS
 * @text SS完了待ち
 * @desc 指定ピクチャの SS アニメが終わるまでイベントを待機します（非ループ再生向け）。
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 *
 * @command playSS
 * @text SS再生
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 *
 * @command pauseSS
 * @text SS一時停止
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 *
 * @command stopSS
 * @text SS停止
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 *
 * @command removeSS
 * @text SS削除
 * @desc SS アニメを外し、アンカーのピクチャを消去します。
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 */
