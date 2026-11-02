;============================================================================
; ssplayer-tyranoscript — 手書きシナリオ最小確認
;
; SpriteStudio アニメを [ss_*] カスタムタグで表示・再生する最小例。
; レンダラは @spritestudio/ssplayer-webgl (SSCanvasPlayer)。
;
; 前提: このプロジェクトに TyranoScript 本体 (index.html + tyrano/) を配置し、
;       `pnpm --filter tyranoscript-example run sync:plugin` でプラグイン資産
;       (main.js + ssruntime_bg.wasm) を同期済みであること (README 参照)。
; 画面解像度は TyranoScript 既定の 1280x720 を想定 (x/y はその論理座標)。
;============================================================================

; プラグイン (data/others/plugin/ssplayer/init.ks) を読み込む。
; → main.js が [ss_*] を master_tag に登録し、続けて init.ks が
;   [ss_init] で WASM ランタイムを起動する。準備はこの 1 行で終わり。
[plugin name="ssplayer"]

; 背景に色を敷く。既定の真っ黒だと、半透明の描画や合成の不具合が
; 「キャラに重なったところだけ」しか見えず、原因の切り分けができない
; （黒の上に半透明の黒を重ねても黒のままなので）。単色ではなくグラデに
; しているのは、バンディングやアルファの取り違えもそれ単体で見えるため。
; 背景画像を使うなら [bg storage="..."] に置き換えて構わない。
[iscript]
$(".base_fore").css("background", "linear-gradient(160deg, #2b3a4a 0%, #3d3550 55%, #4a3a3a 100%)");
[endscript]

[cm]

「ssplayer-tyranoscript デモ。SpriteStudio アニメを表示します。」[l][r]

; プレイヤーを生成 → ssab ロード → レイヤー0 に要素を挿入 → 再生。
; 描画はレイヤーごとの共有 canvas（オーバーレイ）1 枚が受け持つので、
; キャラを何体出しても WebGL コンテキストは増えない。
; anime を省略すると ssab の先頭アニメを自動選択する。
[ss_new name="ringo" storage="others/ssdata/Ringo/Ringo.ssab" layer="0" x="640" y="480" scale="1" loop="true"]

「レイヤー0に Ringo が表示され、ループ再生されています。」[l][r]

; 別アニメへ切替 (Ringo に含まれるアニメ名があれば anime= で指定可)。
; ここでは同じアニメを頭から再生し直す例。
[ss_play name="ringo" loop="true"]

「ss_play タグで再生し直しました。」[l][r]

; --- セーブ / ロード復元のテスト ---
; メニューからセーブ → タイトルへ戻る → ロードすると、プラグインが stat から
; プレイヤーを再構築します。make.ks への記述は不要です
; （テキスト内に角括弧のタグ記法は書かないこと）。
「ここでメニューからセーブ→ロードすると、Ringo が自動で復元されます。」[l][r]

; 一時停止 / 再開の確認。
[ss_pause name="ringo"]
「ss_pause で停止中。クリックで再開します。」[l][r]
[ss_resume name="ringo"]

; --- 内部 transform の移動（アンカー基準・絶対座標）。Ringo は見えたまま動く ---
[ss_move name="ringo" x="900" time="700"]
「ss_move で右へ補間移動しました（内部 transform・アンカー基準の絶対座標）。」[l][r]
[ss_pos name="ringo" x="640"]
「ss_pos で元の位置へ瞬間移動しました。」[l][r]

; --- フェードアウト → フェードイン（TyranoScript 標準 [anim] を要素に適用） ---
; canvas にはプレイヤー名 "ringo" が CSS クラスとして付くので $(".ringo") で選択される。
; ★ [anim] の opacity は 0〜255（0〜1 ではない！）。255 で完全表示、0 で完全透明。
; [anim] は非ブロッキング（アニメスタック）なので [wait] で完了を待ってから次へ。
[anim name="ringo" time="700" opacity="0"]
[wait time="800"]
[anim name="ringo" time="700" opacity="255"]
[wait time="800"]
「anim タグでフェードアウト→フェードインしました（標準タグで演出可能）。」[l][r]

;============================================================================
; ここからキャラクター用プラグイン相当の機能
;============================================================================

; --- next= によるアニメ連鎖（シナリオは止まらない） ---
; ss_wait と違い、テキストを進めながら「1回再生 → 待機ループ」が自動で行われる。
; next= を指定して loop= を省略すると 1 回再生になる。
[ss_play name="ringo" anime="jump" next="wait1"]
「ss_play の next= で jump を1回再生し、自動で wait1 へ戻ります（シナリオは止まりません）。」[l][r]

; atframe= を使うと、終了を待たずにそのフレームで次のアニメへ切り替わる。
[ss_play name="ringo" anime="attack1" next="wait1" atframe="10"]
「atframe=10 で attack1 の途中から wait1 へ切り替えました。」[l][r]

; --- 先読み（表示せずロード） → ss_show で登場 ---
; visible="false" はロードだけ行うので、重い ssab を事前に準備しておける。
; zindex= は同じレイヤー内での重なり順（未指定だと生成順）。
[ss_new name="ringo2" storage="others/ssdata/Ringo/Ringo.ssab" layer="0" x="300" y="480" anime="dance" visible="false" zindex="1"]
「2体目を visible=false で先読みしました（まだ画面には出ていません）。」[l][r]

[ss_show name="ringo2" time="800"]
「ss_show でフェードイン。ロード済みなので待たされません。」[l][r]

; ss_hide は破棄しない（ss_free と違いロード状態が残るので ss_show が即時）。
[ss_hide name="ringo2" time="500"]
「ss_hide で非表示にしました（解放はされていません）。」[l][r]
[ss_show name="ringo2" time="500"]
「ss_show で即座に復帰しました（再ロードなし）。」[l][r]

; --- 話者連動（キャラクター用プラグインの jname 相当） ---
; #あかね の台詞が表示されている間だけ talk のアニメを再生し、終わると idle へ戻す。
[ss_chara name="ringo" jname="あかね" talk="dance" idle="wait1"]

#あかね
台詞を表示している間だけ dance が再生され、行末で wait1 に戻ります。[p]

#
[ss_chara name="ringo" talk=""]

; --- 全プレイヤーの一括フェード（シーン切替向け） ---
[ss_fadeout time="600"]
「ss_fadeout で全プレイヤーをまとめて隠しました。」[l][r]
[ss_fadein time="600"]
「ss_fadein で元に戻ります（フェードアウト前に表示されていたものだけ）。」[l][r]

「クリックで Ringo を解放して終了します。」[l][r]

; 解放 (canvas 除去 + destroy + レジストリ削除)。
[ss_free_all]

[s]
