========================================================================
 ssplayer — SpriteStudio アニメーション再生プラグイン
 for TyranoScript
========================================================================

■ バージョン
    プラグイン          : {{VERSION}}
    作成時ティラノ版    : TyranoScript V520

■ 概略
    SpriteStudio で作ったアニメーション（.ssab）を、シナリオに
    [ss_*] タグを書くだけで表示・再生できるようにするプラグインです。
    プログラミングは必要ありません。

    各キャラクターはレイヤー上の要素として置かれ（描画はそのレイヤー
    で共有する <canvas> 1 枚に行います）、キャラ・背景・メッセージと
    同じレイヤースタックに並びます。ティラノ標準の [anim] / [kanim]
    でフェードや移動ができます（scale / rotate は効かないので、
    [ss_pos] / [ss_move] を使ってください）。

■ 動作環境
    ・TyranoScript V520 で動作確認しています。
    ・セーブデータからの自動復元には V515 以降が必要です
      （load-beforemaking / snapsave-start イベントを使用します）。
      V514 以前で使う場合は data/scenario/make.ks に [ss_restore] を
      記述してください。それ以外の機能は影響を受けません。
    ・描画に WebGL1 が必要です（WebGL2 があれば自動で使用します）。

■ 同梱ファイル
    init.ks             プラグインローダ（[plugin] から呼ばれます）
    main.js             プラグイン本体（レンダラ + core を内包）
    ssruntime_bg.wasm   アニメーションランタイム
    readme.txt          このファイル

■ 導入
    1. この ssplayer フォルダごと、ティラノプロジェクトの
       data/others/plugin/ にコピーします。

           data/others/plugin/ssplayer/
             init.ks
             main.js
             ssruntime_bg.wasm

    2. 変換済みのアニメーション（.ssab とテクスチャ）を
       data/others/ssdata/ に置きます。
       .sspj から .ssab への変換方法はドキュメントを参照してください。

    3. シナリオから [plugin name="ssplayer"] で読み込みます。

■ 使い方（最小サンプル）

    ; first.ks — ゲーム冒頭で 1 回だけ
    [plugin name="ssplayer"]

    ; scene1.ks — 出したい場面で
    [ss_new name="chr" storage="others/ssdata/Chara.ssab" layer="0" x="640" y="480" loop="true"]
    [ss_play name="chr"]

    [plugin] がプラグインの読み込みとランタイムの起動をまとめて行い
    ます。first.ks に書くのはこの 1 行だけです（[ss_init] の記述も
    make.ks への追記も不要です）。

    アニメの連鎖、話者と連動したトークアニメ、パーツ色/セルの上書き、
    フェード、移動なども用意しています。タグの一覧と属性の詳細は
    下記ドキュメントを参照してください。

■ ティラノビルダーで制作する場合
    このフォルダは TyranoScript 用です。ティラノビルダーには別配布の
    ssplayer.tbp があり、こちらのファイルをそのまま内包した上で、
    エディタ側（コンポーネントと .sspj の自動変換）を追加しています。

    どちらか一方だけを入れてください。展開先はどちらも
    data/others/plugin/ssplayer/ で、重ねて入れるとエディタ側と
    ランタイム側でバージョンがずれます。

■ ドキュメント
    https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/tyrano

■ 作成者
    株式会社 CRI・ミドルウェア
    https://github.com/cri-middleware/SSPlayerForWeb

■ ライセンス
    BSD-3-Clause
    Copyright (c) CRI Middleware Co., Ltd. All rights reserved.
    第三者ソフトウェアの権利表記は上記リポジトリの
    THIRD_PARTY_NOTICES.md を参照してください。
