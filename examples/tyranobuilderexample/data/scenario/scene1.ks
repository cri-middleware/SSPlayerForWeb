[_tb_system_call storage=system/_scene1.ks]

[cm  ]
[bg  storage="room.jpg"  time="1000"  ]
[tb_show_message_window  ]
[ss_new  name="ringo"  storage="others/ssdata/Ringo/Ringo.ssab"  anime="wait1"  layer="0"  x="640"  y="410"  scale="0.6"  loop="true"  visible="true"  ]
[tb_start_text mode=1 ]
「SpriteStudio 表示」で、アニメーションを表示しました。[p]
[_tb_end_text]

[ss_play  name="ringo"  anime="jump"  loop="false"  next="wait1"  ]
[tb_start_text mode=1 ]
「SpriteStudio アニメ変更」で jump を 1 回再生し、wait1 に戻ります。[p]
[_tb_end_text]

[ss_play  name="ringo"  anime="attack1"  loop="false"  next="wait1"  ]
[ss_wait  name="ringo"  ]
[tb_start_text mode=1 ]
「SpriteStudio 待機」で、attack1 が終わるまで次へ進みませんでした。[p]
[_tb_end_text]

[ss_move  name="ringo"  x="960"  y="410"  scale="0.6"  time="700"  ]
[tb_start_text mode=1 ]
「SpriteStudio 移動」で動かしました。[p]
[_tb_end_text]

[s  ]
