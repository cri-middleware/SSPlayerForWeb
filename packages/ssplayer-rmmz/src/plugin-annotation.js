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
 *      (ssconverter-web) and place the output under a "spritestudio" folder at
 *      your PROJECT ROOT — beside img/, not inside it (see DEPLOYMENT below):
 *        MyGame/spritestudio/<project>/<project>.ssab (+ its .png textures)
 *      Or let test play convert: put "ssconverter_bg.wasm" beside this plugin
 *      and your SpriteStudio project FOLDERS under SpriteStudio_Source/ at the
 *      project root. Every test play converts what changed into
 *      spritestudio/<project>/ before the title; after saving in SpriteStudio,
 *      press F5. A project that fails stops the boot with the reason and a
 *      Retry button. A deployed game never converts.
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
 * ■ DEPLOYMENT — KEEP SS ASSETS OUT OF img/
 *   Deployment's "Exclude unused files" option only ever removes files from
 *   these three folders (per the official MZ help):
 *     img/  audio/  effects/
 *   SS assets are loaded dynamically by this plugin, so MZ cannot see that they
 *   are used — anything you put under img/ is deleted. Keep them in their own
 *   project-root folder (spritestudio/) and the option leaves them alone, the
 *   same way it leaves js/plugins/ alone. No extra setup, nothing to register.
 *
 *   Leave the sources out: deployment copies the whole project folder, so
 *   enter "SpriteStudio_Source,ssconverter_bg.wasm" in [Exclude files/folders].
 *   The game needs neither to play.
 *
 *   Trade-off: MZ's "Encrypt Image Files" option is also limited to img/ and
 *   audio/, so SS textures outside img/ ship unencrypted. If you want them
 *   encrypted, move the WHOLE spritestudio folder back under img/
 *   (img/spritestudio/) — never split the .ssab from its textures. The .ssab
 *   isn't an image so it stays plain, while the textures beside it get
 *   encrypted and this plugin decrypts them automatically via ImageManager. In
 *   exchange you must turn "Exclude unused files" OFF, or copy
 *   img/spritestudio/ into the deployed output afterward.
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
 * @desc Path to the .ssab (relative to the game root), e.g. spritestudio/Ringo/Ringo.ssab
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
 * @desc Path to the .ssab (relative to the game root), e.g. spritestudio/Ringo/Ringo.ssab
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
 * @command setSSPartColor
 * @text Set SS Part Color
 * @desc Tint ONE part, winning over the animation. Normal parts only. Saved with the picture.
 * @arg pictureId
 * @text Picture Id
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg part
 * @text Part Name
 * @desc Part name as authored in the SpriteStudio project (e.g. "apple").
 * @type string
 * @default
 * @arg color
 * @text Color (hex)
 * @desc #RRGGBB or #RRGGBBAA. Alpha defaults to opaque. e.g. #0033FF, #0033FFBF
 * @type string
 * @default #FFFFFF
 * @arg blendOp
 * @text Blend
 * @desc How the color combines with the part, same four operations as an authored Parts Color.
 * @type select
 * @option Mix
 * @value 0
 * @option Multiply
 * @value 1
 * @option Add
 * @value 2
 * @option Subtract
 * @value 3
 * @default 0
 * @arg priority
 * @text Priority
 * @desc Who wins when the animation drives the same attribute.
 * @type select
 * @option Yield to the next keyframe
 * @value 0
 * @option Hold until the animation changes
 * @value 1
 * @option Permanent (survives animation changes)
 * @value 2
 * @default 1
 *
 * @command setSSPartVisibility
 * @text Set SS Part Visibility
 * @desc Force-hide ONE part (or revert it), winning over the animation. Saved with the picture.
 * @arg pictureId
 * @text Picture Id
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg part
 * @text Part Name
 * @type string
 * @default
 * @arg hide
 * @text Hide
 * @desc ON = force-hide, OFF = revert to the animation.
 * @type boolean
 * @default true
 * @arg cascade
 * @text Cascade to descendants
 * @desc ON also hides the part's children. (An authored hide never cascades.)
 * @type boolean
 * @default false
 *
 * @command setSSPartCell
 * @text Set SS Part Cell
 * @desc Make ONE part draw a different cell, winning over the animation. Normal / mask parts only. Saved with the picture.
 * @arg pictureId
 * @text Picture Id
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg part
 * @text Part Name
 * @type string
 * @default
 * @arg cellmap
 * @text Cell Map Name
 * @desc Name WITHOUT the .ssce extension (e.g. "Ringo").
 * @type string
 * @default
 * @arg cell
 * @text Cell Name
 * @desc Cell inside that map (e.g. "effect3"). Leave both blank to revert to the animation.
 * @type string
 * @default
 * @arg priority
 * @text Priority
 * @type select
 * @option Yield to the next keyframe
 * @value 0
 * @option Hold until the animation changes
 * @value 1
 * @option Permanent (survives animation changes)
 * @value 2
 * @default 1
 *
 * @command clearSSPartOverrides
 * @text Clear SS Part Overrides
 * @desc Remove the color / cell / visibility overrides. Blank part = every part.
 * @arg pictureId
 * @text Picture Id
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg part
 * @text Part Name
 * @desc Leave blank to clear every part on this picture.
 * @type string
 * @default
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
 *      【プロジェクト直下】の spritestudio フォルダに配置します。img/ の中では
 *      なく、img/ と並ぶ位置です（後述の「デプロイメント」参照）。
 *        ゲームフォルダ/spritestudio/<プロジェクト名>/<プロジェクト名>.ssab（＋ .png）
 *      テストプレイに変換させることもできます。このプラグインの隣に
 *      ssconverter_bg.wasm を置き、SpriteStudio のプロジェクトを【フォルダごと】
 *      プロジェクト直下の SpriteStudio_Source/ に置きます。テストプレイのたびに、
 *      変更のあったものがタイトルの前に spritestudio/<プロジェクト名>/ へ変換され
 *      ます。SpriteStudio で保存したら F5 を押してください。変換に失敗すると起動が
 *      止まり、理由と Retry ボタンが表示されます。デプロイしたゲームでは変換しません。
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
 * ■ デプロイメント — SS 素材は img/ の外に置いてください
 *   デプロイメントの「未使用ファイルを含まない」で除外されるのは、公式ヘルプに
 *   ある通り以下の 3 フォルダの中だけです。
 *     img/  audio/  effects/
 *   SS 素材は本プラグインが動的に読み込むためツクールからは未使用に見えます。
 *   img/ の中に置くと削除されますが、プロジェクト直下の spritestudio/ に置けば
 *   js/plugins/ と同じく対象外となり、そのまま出力されます。登録作業も追加設定も
 *   不要です。
 *
 *   ソースは除外してください。デプロイメントはプロジェクトフォルダを丸ごと書き出す
 *   ため、［除外するファイル/フォルダ］に「SpriteStudio_Source,ssconverter_bg.wasm」
 *   を入力します。どちらもゲームの実行には不要です。
 *
 *   トレードオフ：暗号化（画像ファイル）も img/・audio/ だけが対象のため、img/ の
 *   外に置いたテクスチャは暗号化されません。テクスチャを暗号化したい場合は、.ssab と
 *   テクスチャを分けるのではなく、spritestudio フォルダごと img/ の下
 *   （img/spritestudio/）へ戻してください。.ssab は画像ではないので暗号化されません
 *   が、同じフォルダにあるテクスチャは暗号化され、本プラグインが ImageManager 経由で
 *   読み込むため復号は自動です。ただしその際は「未使用ファイルを含まない」を OFF に
 *   するか、デプロイメント後に img/spritestudio/ フォルダを出力先へコピーする必要が
 *   あります。
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
 * @desc .ssab のパス（ゲームルートからの相対）。例: spritestudio/Ringo/Ringo.ssab
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
 * @desc .ssab のパス（ゲームルートからの相対）。例: spritestudio/Ringo/Ringo.ssab
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
 * @command setSSPartColor
 * @text SSパーツ色変更
 * @desc 特定パーツの色をアニメより優先して上書きします。通常パーツのみ。設定はセーブされます。
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg part
 * @text パーツ名
 * @desc SpriteStudio プロジェクトで付けたパーツ名（例: apple）。
 * @type string
 * @default
 * @arg color
 * @text 色（16進）
 * @desc #RRGGBB または #RRGGBBAA。α 省略時は不透明。例: #0033FF, #0033FFBF
 * @type string
 * @default #FFFFFF
 * @arg blendOp
 * @text 合成方法
 * @desc パーツカラーと同じ 4 種類です。
 * @type select
 * @option ミックス
 * @value 0
 * @option 乗算
 * @value 1
 * @option 加算
 * @value 2
 * @option 減算
 * @value 3
 * @default 0
 * @arg priority
 * @text 優先度
 * @desc アニメが同じ属性を持つ場合、どちらを優先するか。
 * @type select
 * @option 次のキーフレームに譲る
 * @value 0
 * @option アニメが変わるまで保持
 * @value 1
 * @option 恒久（アニメ変更をまたいで維持）
 * @value 2
 * @default 1
 *
 * @command setSSPartVisibility
 * @text SSパーツ表示切替
 * @desc 特定パーツをアニメより優先して強制的に非表示にします（解除も可）。設定はセーブされます。
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg part
 * @text パーツ名
 * @type string
 * @default
 * @arg hide
 * @text 非表示にする
 * @desc ON で強制非表示、OFF でアニメの状態に戻します。
 * @type boolean
 * @default true
 * @arg cascade
 * @text 子パーツにも波及
 * @desc ON にすると子孫パーツも一緒に非表示になります（アニメの非表示は波及しません）。
 * @type boolean
 * @default false
 *
 * @command setSSPartCell
 * @text SSパーツセル差替
 * @desc 特定パーツが描くセルをアニメより優先して差し替えます。通常パーツとマスクパーツのみ。設定はセーブされます。
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg part
 * @text パーツ名
 * @type string
 * @default
 * @arg cellmap
 * @text セルマップ名
 * @desc 拡張子 .ssce は付けません（例: Ringo）。
 * @type string
 * @default
 * @arg cell
 * @text セル名
 * @desc そのセルマップ内のセル名（例: effect3）。両方空にするとアニメの状態に戻ります。
 * @type string
 * @default
 * @arg priority
 * @text 優先度
 * @type select
 * @option 次のキーフレームに譲る
 * @value 0
 * @option アニメが変わるまで保持
 * @value 1
 * @option 恒久（アニメ変更をまたいで維持）
 * @value 2
 * @default 1
 *
 * @command clearSSPartOverrides
 * @text SSパーツ上書き解除
 * @desc 色 / セル / 表示の上書きを解除します。パーツ名を空にすると全パーツが対象です。
 * @arg pictureId
 * @text ピクチャ番号
 * @type number
 * @min 1
 * @max 100
 * @default 1
 * @arg part
 * @text パーツ名
 * @desc 空にするとこのピクチャの全パーツを解除します。
 * @type string
 * @default
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
