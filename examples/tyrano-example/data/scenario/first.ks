;============================================================================
; ssplayer-tyrano — 手書きシナリオ最小確認 (PT1)
;
; SpriteStudio アニメを [ss_*] カスタムタグで表示・再生する最小例。
; レンダラは @spritestudio/ssplayer-webgl (SSCanvasPlayer)。
;
; 前提: このプロジェクトに TyranoScript 本体 (index.html + tyrano/) を配置し、
;       `pnpm --filter tyrano-example run sync:plugin` でプラグイン資産
;       (main.js + ssruntime_bg.wasm) を同期済みであること (README 参照)。
; 画面解像度は TyranoScript 既定の 1280x720 を想定 (x/y はその論理座標)。
;============================================================================

; プラグイン (data/others/plugin/ssplayer/init.ks) を読み込む。
; → main.js が [ss_*] を master_tag に登録する。
[plugin name="ssplayer"]

[cm]

; WASM ランタイムを一度だけ初期化。wasm パスは data/ 基準で解決される。
[ss_init wasm="others/plugin/ssplayer/ssruntime_bg.wasm"]

「ssplayer-tyrano デモ。SpriteStudio アニメを表示します。」[l][r]

; プレイヤーを生成 → ssab ロード → レイヤー0 に canvas を挿入 → 再生。
; anime を省略すると ssab の先頭アニメを自動選択する。
[ss_new name="ringo" storage="others/ssdata/Ringo.ssab" layer="0" x="640" y="480" scale="1" loop="true"]

「レイヤー0に Ringo が表示され、ループ再生されています。」[l][r]

; 別アニメへ切替 (Ringo に含まれるアニメ名があれば anime= で指定可)。
; ここでは同じアニメを頭から再生し直す例。
[ss_play name="ringo" loop="true"]

「ss_play タグで再生し直しました。」[l][r]

; --- セーブ / ロード復元のテスト (PT2 / §3.3) ---
; メニューからセーブ → タイトルへ戻る → ロードすると、make.ks の ss_restore が
; stat からプレイヤーを再構築します（テキスト内に角括弧のタグ記法は書かないこと）。
「ここでメニューからセーブ→ロードすると、Ringo が復元されます（make.ks の ss_restore）。」[l][r]

; 一時停止 / 再開の確認。
[ss_pause name="ringo"]
「ss_pause で停止中。クリックで再開します。」[l][r]
[ss_resume name="ringo"]

; --- 内部 transform の移動（アンカー基準・絶対座標）。Ringo は見えたまま動く ---
[ss_move name="ringo" x="900" time="700"]
「ss_move で右へ補間移動しました（内部 transform・アンカー基準の絶対座標）。」[l][r]
[ss_pos name="ringo" x="640"]
「ss_pos で元の位置へ瞬間移動しました。」[l][r]

; --- フェードアウト → フェードイン（TyranoScript 標準 [anim] を canvas に適用） ---
; canvas にはプレイヤー名 "ringo" が CSS クラスとして付くので $(".ringo") で選択される。
; ★ [anim] の opacity は 0〜255（0〜1 ではない！）。255 で完全表示、0 で完全透明。
; [anim] は非ブロッキング（アニメスタック）なので [wait] で完了を待ってから次へ。
[anim name="ringo" time="700" opacity="0"]
[wait time="800"]
[anim name="ringo" time="700" opacity="255"]
[wait time="800"]
「anim タグでフェードアウト→フェードインしました（標準タグで演出可能）。」[l][r]

「クリックで Ringo を解放して終了します。」[l][r]

; 解放 (canvas 除去 + destroy + レジストリ削除)。
[ss_free name="ringo"]

[s]
