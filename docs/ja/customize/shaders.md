# シェーダーとブレンドモード

## ブレンドモード

SpriteStudio の「背景を読み取る」ブレンドモード（**Screen / Exclusion / Invert**
など）は、実際のフレームバッファを読む**固定機能 GPU ブレンド**として実装されて
います。合成対象の背景は PixiJS `Application` の `backgroundColor` です。エディタと
見え方を合わせたい場合は、まず背景色が編集環境と一致しているかを確認してください。

（実装は `ssplayer-pixi` の `SSBlendModes.ts`。）

## SS 統合シェーダー

SpriteStudio の統合シェーダー（`ss-*`）を移植し、パーツごとにプールして適用します。
セル矩形は UV コーナーから算出されます。

（実装は `ssplayer-pixi` の `SSShaderLib.ts` / `PartsColorShader.ts` /
`EffectShader.ts` ほか。）

::: tip 見え方の検証
仕様値よりも **SpriteStudio エディタでの見え方に合わせる**ことを優先し、
`examples/pixi-example` でサンプル（`BlendMode.ssab` / `Shader.ssab` /
`PartsColor.ssab` など）を並べて確認するのが確実です。
:::
