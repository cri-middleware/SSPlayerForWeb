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
 *   1. Put this file and "ssruntime_bg.wasm" together in js/plugins/ (same
 *      folder) and enable the plugin. The WASM loads automatically from beside
 *      this .js — no path parameter to set.
 *   2. Convert your .sspj to .ssab with the SpriteStudio converter tooling
 *      (ssconverter-web) and place the output under img/spritestudio/<project>/.
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
 * @command setSSAsPicture
 * @text Set SS As Picture
 * @desc Attach an SS animation to a picture ALREADY shown by "Show Picture". Control position/erase with the standard Move/Erase Picture commands.
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
 * @command changeSSAnimation
 * @text Change SS Animation
 * @desc Switch the animation on an existing SS picture without reloading the .ssab.
 * @arg pictureId
 * @text Picture Id
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg animation
 * @text Animation Name
 * @type string
 * @default
 * @arg loop
 * @text Loop Count
 * @desc -1 = infinite, 0/1 = play once. Leave blank to keep the current value.
 * @type number
 * @min -1
 * @default -1
 *
 * @command setSSSpeed
 * @text Set SS Speed
 * @desc Playback speed multiplier (1 = normal, 0.5 = half, 2 = double). Subframe interpolation keeps slow speeds smooth.
 * @arg pictureId
 * @text Picture Id
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg speed
 * @text Speed
 * @type number
 * @decimals 2
 * @min 0
 * @default 1
 *
 * @command playSSOnce
 * @text Play SS Once (return to loop)
 * @desc Play an animation, then automatically return to the base loop. Ideal for portrait expressions/emotes over an idle loop.
 * @arg pictureId
 * @text Picture Id
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg animation
 * @text Animation Name
 * @desc The one-shot animation to play before returning to the current loop.
 * @type string
 * @default
 * @arg loop
 * @text Play Count
 * @desc How many times to play the one-shot before returning to the loop (>=1).
 * @type number
 * @min 1
 * @default 1
 *
 * @command playSSSequence
 * @text Play SS Sequence
 * @desc Play a comma-separated list of animations: each plays once except the LAST, which loops. e.g. "attack1,attack2,wait1".
 * @arg pictureId
 * @text Picture Id
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg animations
 * @text Animations (comma-separated)
 * @desc e.g. "attack1,attack2,wait1". All but the last play once; make the last your idle/base loop.
 * @type string
 * @default
 * @arg loop
 * @text Final Loop Count
 * @desc Loop count for the LAST animation. -1 = loop forever.
 * @type number
 * @min -1
 * @default -1
 *
 * @command setSSTalk
 * @text Set SS Talk (lip-sync)
 * @desc Bind a picture to a SPEAKER NAME: plays "talk" while THAT speaker's message prints, "idle" otherwise. Only the current speaker lip-syncs.
 * @arg pictureId
 * @text Picture Id
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg name
 * @text Speaker Name
 * @desc The message name-box name this picture speaks for. Empty = unnamed messages.
 * @type string
 * @default
 * @arg talk
 * @text Talk Animation
 * @desc Animation to loop while this speaker's text is being printed.
 * @type string
 * @default
 * @arg idle
 * @text Idle Animation
 * @desc Animation to loop when the message finishes.
 * @type string
 * @default
 *
 * @command clearSSTalk
 * @text Clear SS Talk
 * @desc Remove a picture's talk binding (stops lip-sync for it).
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
 *   1. 本ファイルと "ssruntime_bg.wasm" を js/plugins/ に一緒に（同じフォルダに）置き、
 *      プラグインを有効化。WASM はこの .js と同じ場所から自動で読み込まれます（パス設定不要）。
 *   2. .sspj を SpriteStudio コンバータ（ssconverter-web）で .ssab に変換し、出力を
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
 * @command setSSAsPicture
 * @text SSをピクチャに割当
 * @desc 「ピクチャの表示」で既に表示済みのピクチャに SS アニメを割り当てます。位置移動・消去は標準の「ピクチャの移動/消去」で操作します。
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
 * @command changeSSAnimation
 * @text SSアニメ切替
 * @desc 表示中の SS ピクチャのアニメを、.ssab を再ロードせずに切り替えます。
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg animation
 * @text アニメーション名
 * @type string
 * @default
 * @arg loop
 * @text ループ回数
 * @desc -1 = 無限、0/1 = 1回再生。空欄なら現在値を維持。
 * @type number
 * @min -1
 * @default -1
 *
 * @command setSSSpeed
 * @text SS再生速度
 * @desc 再生速度の倍率（1=標準, 0.5=半分, 2=倍速）。サブフレーム補間により低速でも滑らかです。
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg speed
 * @text 速度
 * @type number
 * @decimals 2
 * @min 0
 * @default 1
 *
 * @command playSSOnce
 * @text SSワンショット再生
 * @desc アニメを再生し、自動で元の base ループへ戻します。立ち絵の表情/エモート向け。
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg animation
 * @text アニメーション名
 * @desc ループへ戻す前に再生するアニメ名。
 * @type string
 * @default
 * @arg loop
 * @text 再生回数
 * @desc ループへ戻る前に何回再生するか（1以上）。
 * @type number
 * @min 1
 * @default 1
 *
 * @command playSSSequence
 * @text SS連続再生
 * @desc カンマ区切りのアニメ列を再生：末尾以外は各1回、末尾はループ。例「attack1,attack2,wait1」。
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg animations
 * @text アニメ列（カンマ区切り）
 * @desc 例「attack1,attack2,wait1」。末尾以外は各1回。末尾は idle/base ループにするのが基本。
 * @type string
 * @default
 * @arg loop
 * @text 末尾のループ回数
 * @desc 末尾アニメのループ回数。-1 = 無限ループ。
 * @type number
 * @min -1
 * @default -1
 *
 * @command setSSTalk
 * @text SSリップシンク設定
 * @desc ピクチャを「話者名」に紐づけ：その話者の文章表示中のみ talk、それ以外は idle。喋っているキャラだけ口パクします。
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg name
 * @text 話者名
 * @desc このピクチャが担当する「名前欄」の名前。空欄＝名前なしの文章に対応。
 * @type string
 * @default
 * @arg talk
 * @text 発話アニメ
 * @desc この話者の文章表示中にループ再生するアニメ。
 * @type string
 * @default
 * @arg idle
 * @text 待機アニメ
 * @desc 文章が終わったらループ再生するアニメ。
 * @type string
 * @default
 *
 * @command clearSSTalk
 * @text SSリップシンク解除
 * @desc ピクチャのリップシンク登録を解除します。
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
