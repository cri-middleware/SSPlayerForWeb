;============================================================================
; make.ks — TyranoScript がセーブデータの【ロード時】に call する特別なファイル。
; DOM に無い状態（SS プレイヤーの canvas 等）をここで再構築する（§3.3）。
;
; [ss_restore] は stat.f.__ssplayers（[ss_new] 等が保存した状態）から
; プレイヤーを再生成し、frame ではなくアニメ先頭から再生を復元する。
; プラグイン本体（main.js）は first.ks の [plugin name="ssplayer"] で読み込み済み
; の前提。WASM は再初期化が必要なので [ss_restore] の前に [ss_init] を置く。
;
; ※ call として呼ばれるため [return] 必須。このファイルは削除しないこと。
;============================================================================

[ss_init wasm="others/plugin/ssplayer/ssruntime_bg.wasm"]
[ss_restore]

[return]
