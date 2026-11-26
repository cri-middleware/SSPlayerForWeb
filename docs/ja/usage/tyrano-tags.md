---
description: TyranoScript プラグインが追加する [ss_*] タグのすべて。属性、連鎖、クロスフェードとトラック、速度と区間、シグナル、トークアニメ、パーツ上書き。
---

# TyranoScript のタグ

TyranoScript プラグインが追加する `[ss_*]` タグのすべてです。プラグインの導入、アニメーションの変換、最初のシーンは [TyranoScript で使う](/ja/usage/tyrano) にあります。ティラノビルダーのコンポーネントも、これと同じタグを書き出します。

| タグ | 役割 | 主な属性 |
| --- | --- | --- |
| `[ss_init]` | **音声設定**。ランタイムは `[plugin name="ssplayer"]` が起動済みなので、このタグは音声設定を変える用途だけです | `audio=`, `sounddir=`, `soundext=`, `sevolume=`（`wasm=` はプラグインが指定） |
| `[ss_new]` | プレイヤー生成 → ssab ロード → レイヤーへ挿入 → 再生 | `name=`(必須) `storage=`(必須) `anime=` `layer=` `page=` `x=` `y=` `scale=` `loop=` `visible=` `zindex=` |
| `[ss_play]` | 再生 / アニメ切替（続けて再生するアニメも指定可） | `name=`(必須) `anime=` `transition=` `loop=` `start=` `next=` `nextloop=` `atframe=` |
| `[ss_show]` | プレイヤーを表示（位置指定・登場アニメ・フェード） | `name=`(必須) `x=` `y=` `scale=` `zindex=` `anime=` `transition=` `loop=` `next=` `time=` `wait=` |
| `[ss_hide]` | 破棄せずに非表示にする（ロード状態は維持） | `name=`(必須) `time=` `wait=` |
| `[ss_fadein]` / `[ss_fadeout]` | 全プレイヤーを一括フェード（シーン切替向け） | `time=` `wait=` |
| `[ss_chara]` | 話者と連動し、発話中はトークアニメを再生 | `name=`(必須) `jname=` `talk=` `idle=` `transition=` |
| `[ss_track]` | キャラ自身のアニメ（トラック 0）より上のトラックにアニメを重ねる | `name=`(必須) `track=`(必須) `anime=`(必須) `alpha=` `blend=` `loop=` `transition=` |
| `[ss_track_fade]` | トラックの効き具合をフェード | `name=`(必須) `track=`(必須) `alpha=` `time=` `wait=` |
| `[ss_track_clear]` | トラックを空にする | `name=`(必須) `track=`(必須) |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` | 個別プレイヤーの停止 / 一時停止 / 再開 | `name=`(必須) |
| `[ss_stop_audio]` | プレイヤーが鳴らした音をすぐ止める | `name=`(必須) |
| `[ss_speed]` | 再生速度（`1` = 等速） | `name=`(必須) `speed=`(必須) |
| `[ss_seek]` | 指定フレームへ移動 | `name=`(必須) `frame=`(必須) |
| `[ss_section]` | 指定範囲のフレームだけを再生（両端とも省略で解除） | `name=`(必須) `start=` `end=` |
| `[ss_direction]` | 順再生 / 逆再生、1 回 / 往復 | `name=`(必須) `direction=` `style=` |
| `[ss_wait]` | アニメ終了（ループ時は 1 周）までシナリオを待つ | `name=`(必須) |
| `[ss_wait_signal]` | アニメがシグナル（`command=` 指定時はそのコマンド）を出すまでシナリオを待つ | `name=`(必須) `command=` `var=` |
| `[ss_pos]` | 瞬間移動 / スケール / 重なり順（アンカー基準・絶対） | `name=`(必須) `x=` `y=` `scale=` `zindex=` |
| `[ss_move]` | 補間移動 / スケール（easeOut・既定は非ブロッキング） | `name=`(必須) `x=` `y=` `scale=` `time=` `wait=` |
| `[ss_part_color]` | パーツの色をアニメより優先して上書き（通常パーツのみ） | `name=`(必須) `part=`(必須) `color=`(必須) `blend=` `priority=` |
| `[ss_part_visible]` | パーツを強制的に非表示 / 解除。`cascade=` で子孫にも波及 | `name=`(必須) `part=`(必須) `hide=` `cascade=` |
| `[ss_part_cell]` | パーツが描くセルを差し替え（通常 / マスクパーツのみ） | `name=`(必須) `part=`(必須) `cellmap=`(必須) `cell=`(必須) `priority=` |
| `[ss_part_clear]` | パーツ上書きを解除（`part=` 省略で全パーツ） | `name=`(必須) `part=` |
| `[ss_free]` | 1 プレイヤーを解放 | `name=`(必須) |
| `[ss_free_all]` | 全プレイヤー解放（シーン遷移 / レイヤークリア時） | — |
| `[ss_pause_all]` / `[ss_resume_all]` | 全プレイヤー一時停止 / 再開（メニュー等で使用） | — |
| `[ss_restore]` | セーブから全プレイヤーを再構築。**通常は不要**（ロード時に自動復元されます）。ロード完了まで待たせたい場合や、イベント機構の無い古いエンジンでのみ使います | — |

共通の属性は次の値を取ります。

- `x` / `y`: 他の画面要素と同じく、Tyrano の通常の左上原点ピクセル（`config.scWidth × scHeight`、既定 `0,0`）です。アニメの**アンカー**がその位置に来ます。
- `loop`: `true` = 無限（既定）/ `false` = 1 回 / 数値 = その回数。
- `layer`: Tyrano のレイヤー番号（**大きいほど手前**、既定 `0`）。`page` は `fore`（既定）/ `back` です。
- `scale`: 拡大率（既定 `1`）。
- `anime`: `.ssab` 内のアニメ名。空にすると**先頭**のアニメになります。
- `[ss_play]` の `start`: 開始フレーム（既定 `-1` = アニメーションの先頭から。`[ss_section]` で区間を設定している場合は区間の先頭から）。
- `visible`: `false` にすると表示せずにロードだけ行います（[先読み・表示・非表示](#preload-show-hide) を参照）。
- `zindex`: *同じレイヤーの中での*重なり順。指定しない場合、同じレイヤーのプレイヤーは作成順に重なります。
- `time`: 時間（ms）。フェード、`[ss_move]` では移動にかける時間です。既定は `[ss_show]` / `[ss_hide]` が `0`（即時）、`[ss_fadein]` / `[ss_fadeout]` が `1000`、`[ss_track_fade]` と `[ss_move]` が `500` です。
- `wait`: `true` にすると演出が終わるまでシナリオを止めます。フェードでは既定で `true`、`[ss_move]` では既定で `false` です。

そのほかの属性は、以下でタグごとに説明します。

タグは失敗してもシナリオを止めません。エンジンのデバッグ設定（`data/system/Config.tjs` の `;debugMenu.visible = true`）が有効なら、原因はエンジン自身のエラーダイアログに、シナリオのファイル名と行番号付きで表示されます。たとえば `[ss_play] next="Wiat" is not in others/ssdata/Ringo/Ringo.ssab.` のように表示されます。リリース時はこの設定をオフにしてください。オフのときは、原因はブラウザのコンソールにだけ出力されます。

## 先読み・表示・非表示 {#preload-show-hide}

`[ss_new visible="false"]` は**表示せずにロードだけ**行います。サイズの大きい `.ssab` を必要な場面より前に準備しておき、その瞬間に即座に出せます:

```
[ss_new name="akane" storage="others/ssdata/Akane/Akane.ssab" visible="false"]
[ss_show name="akane" x="640" y="480" time="800"]   ; ロード済みなので待たされない
[ss_hide name="akane" time="500"]                   ; 画面から消す（ロードは維持）
```

`[ss_hide]` はアニメをロードしたまま（＝ `[ss_show]` が即時）画面外にし、GPU 消費も止めます。実際に解放するのは `[ss_free]` です。`[ss_fadeout]` / `[ss_fadein]` はシーン切替向けに全プレイヤーを一括でフェードし、フェードイン時には**元々表示されていたものだけ**が戻ります。

## アニメの連鎖 {#chaining-animations}

`next=` は連鎖をプレイヤー側に予約するので、「登場 → 待機ループ」に `[ss_wait]` は不要で、シナリオも止まりません:

```
[ss_play name="akane" anime="appear" next="wait"]                ; 1回再生 → 待機ループ
[ss_play name="akane" anime="attack" next="wait" atframe="20"]   ; 20フレーム目で切替
```

`next=` を指定して `loop=` を省略すると 1 回再生になります（無限ループには終わりが来ないため）。
`nextloop=` は連鎖先のループ回数です。`atframe=` のフレームに届く前に終わるアニメは、終わった時点で切り替わります。予約された連鎖は次の `[ss_play]` か `[ss_show anime=]` で取り消されます。

## クロスフェードとトラック {#crossfades-and-tracks}

`[ss_play]` / `[ss_show]` に `transition=`（ms）を指定すると、`anime=` への切り替えを即座に行う代わりに、いま表示中の絵からその時間をかけてクロスフェードします。`0` または省略時はこれまでどおり即座に切り替えます。`[ss_show]` の `time=` は従来どおり画面に現れるときのフェードです。`[ss_chara]` に指定すると、トークアニメと待機アニメの間をクロスフェードします。`next=` の続きは即座に切り替わります。

```
[ss_play name="akane" anime="smile" transition="300"]   ; 0.3 秒かけて smile へ
```

クロスフェードではパーツ上書きもトラックも残ります。別のアニメへ即座に切り替えると `permanent` 以外のパーツ上書きが解除され、トラックも空になります。再生中と同じアニメへの切り替えでは何も変わりません。

トラックは、キャラ自身のアニメ（`[ss_play]` が設定するトラック 0）の**上に**別のアニメを重ねます。歩きの上に手振り、ポーズの上に表情、といった使い方です:

```
[ss_track name="akane" track="1" anime="wave" blend="add" loop="false"]  ; 歩きの上に手振り
[ss_track_fade name="akane" track="1" alpha="0" time="500"]               ; フェードアウト
[ss_track_clear name="akane" track="1"]                                   ; トラックを空に
```

- `track=` は `1` 以上です。トラック 0 はエラーになります。
- `alpha=` はトラックの効き具合（既定 `1`）。`blend=` は `mix`（既定。このアニメへ寄せる）か `add`（セットアップポーズからの差分を加算）です。
- `loop=` はほかのタグと同じ書き方です。再生し終えたトラックは、フェードかクリアするまで最終フレームを保ちます。`transition=` は、そのトラックで再生していたアニメからクロスフェードします。
- `[ss_track_fade]` は `alpha=`（既定 `0`）まで `time=` ms（既定 `500`、`0` で即時）かけてフェードします。`wait="true"`（既定）ならフェードが終わるまでシナリオを止めますが、一時停止中・停止中のプレイヤーでは待ちません。`[ss_track]` で何も重ねていないトラックを指定するとエラーになります。
- `[ss_track_clear]` はトラックを即座に空にします。徐々に消すには、先に `0` までフェードしてください。
- トラックはセーブに含まれます。`[ss_track_fade]` の途中でセーブした場合は、フェードし終えた状態で復元されます。

## 速度・シーク・区間 {#speed-seeking-and-sections}

```
[ss_speed name="akane" speed="0.5"]             ; 半分の速度
[ss_seek name="akane" frame="12"]               ; 12 フレーム目へ
[ss_section name="akane" start="10" end="30"]   ; 10〜30 フレームだけをループ
[ss_direction name="akane" direction="backward" style="pingpong"]
```

フレーム番号は SpriteStudio の表示と同じく 0 から数えます。`[ss_seek]` は、再生中なら再生を続け、一時停止中なら一時停止のままです。`[ss_section]` は再生位置を区間の先頭へ移します。`start=` か `end=` を省略するとその側はアニメの端になり、両方省略するとアニメ全体に戻ります。`end=` が `start=` より前なら受け付けず、区間はそのままで、理由はブラウザのコンソールに出ます。`direction=` は `forward`（順）か `backward`（逆）、`style=` は `normal`（1 回）か `pingpong`（往復）です。

速度と方向はアニメを切り替えても残ります。区間は残りません。フレーム番号は別のアニメでは意味を持たないためで、`[ss_play anime=]` でも `next=` の続きでも解除されます。3 つともセーブに含まれます。

## シグナルを待つ {#waiting-for-a-signal}

シグナルは、アニメーターが SpriteStudio 上でフレームに置く目印で、コマンド ID と任意のパラメータを持ちます。`[ss_wait_signal]` はアニメがシグナルを出すまでシナリオを止めるので、「攻撃が当たった瞬間」をシナリオに書けます:

```
[ss_play name="akane" anime="attack" loop="false"]
[ss_wait_signal name="akane" command="hit"]   ; 攻撃が当たるまで待つ
[quake count="3" time="300" hmax="20"]
```

`command=` は SpriteStudio で設定したコマンド ID です。省略するとどのシグナルでも進みます。`var="f.sig"` を指定すると待ちを終えたシグナルのコマンド ID が入るので、`[if]` でどれだったかを分岐できます。`next=` で予約した続きのアニメも待つ対象に含まれます。シグナルが出ないままアニメが終わるか 1 周ループした場合は待ちを終え、ほかのタグの失敗と同じように原因を表示します。多くはコマンド ID の書き間違いです。シグナルのパラメータは受け渡しません。

## 話者と連動したトークアニメ {#speaker-linked-talk-animations}

`[ss_chara]` は紐づけたキャラの台詞が表示されている間だけトークアニメを再生し、終わると待機へ戻します。TyranoScript のキャラクター用プラグインの `jname` と同じ発想を、口のパラメータではなく
SpriteStudio のアニメ単位で行うものです:

```
[ss_chara name="akane_ss" jname="あかね" talk="talk" idle="wait"]

#あかね
はじめまして。[p]
```

`jname=` はシナリオの `#名前` でも Tyrano のキャラ ID でも一致し、省略するとプレイヤー自身の名前になります。`idle=` を空にすると `[ss_play]` で最後に指定したアニメへ戻るので、表情の切り替えが次の台詞でも残ります。トーク／待機の切替はセーブに含まれないため、台詞の途中でセーブしても通常のアニメで復元されます。`talk=""` で解除できます。スキップや `[nowait]` ではエンジンが台詞を一度に表示するので、トークアニメが一瞬だけ映ることはありません。

## パーツ上書きについて {#part-overrides}

`[ss_part_*]` はアニメのキーフレームより **優先** して、特定パーツの見た目を差し替えます（SS6 の PartsColorChange / CellChangeParts / HideSet に相当）。

```
[ss_part_color name="chr" part="apple" color="#0033FFBF" blend="mul"]
[ss_part_visible name="chr" part="heta" cascade="true"]
[ss_part_cell    name="chr" part="apple" cellmap="Ringo" cell="effect3"]
[ss_part_clear   name="chr"]
```

- `color=` は `#RRGGBB` / `#RRGGBBAA`（α 省略時は不透明）。`#RGB` の短縮形や、TyranoScript の他のタグと同じ `0xRRGGBB` も使えます
- `blend=` は `mix`（既定）/ `mul` / `add` / `sub`、数値 `0`〜`3` でも指定できます
- `priority=` は `keyframe`（次のキーフレームに譲る）/ `anime`（既定・アニメが変わるまで保持）/
  `permanent`（アニメ変更をまたいで維持）、数値 `0`〜`2` でも可
- `cellmap=` に `.ssce` 拡張子は付けません
- **アニメを切り替えると `permanent` 以外の上書きは解除されます。** セーブ内容も同時に整理されるため、ロード時に復活することはありません。表示（`[ss_part_visible]`）に優先度はなく、アニメ切替で必ず解除されます。`transition=` によるクロスフェードでは、どれも解除されません
