# WebGL で使う

`@spritestudio/ssplayer-webgl` は、外部のレンダリングエンジン（PixiJSなど）に依存しない軽量な単体 WebGL 1/2 レンダラーです。広告用バナーやシンプルなWebページなど、ファイルサイズや依存関係を極力抑えたい用途に向いています。

## インストール

```bash
pnpm add @spritestudio/ssplayer-webgl
```

## ポイント

- **依存なし**: PixiJS や Three.js などの外部ライブラリを必要とせず、単体で動作します。
- **Web Components 対応**: JavaScript を書かずに、HTML に `<ss-player>` を記述するだけで利用できる Custom Element を内包しています。
- 描画や更新を自動で行う `SSCanvasPlayer` と、独自のレンダリングループに組み込める `SSWebGLRenderer` を提供します。

## Web Components (`<ss-player>`) の使い方

もっとも手軽な利用方法は Custom Element です。

```html
<script type="module">
  import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
  // <ss-player> タグをブラウザに登録します
  defineSSPlayerElement();
</script>

<!-- src に ssab ファイル、animation に再生するアニメーション名を指定 -->
<ss-player 
  src="/assets/Ringo.ssab" 
  animation="run" 
  autoplay 
  speed="1.0" 
  style="width: 640px; height: 480px;">
</ss-player>
```

JavaScript から制御する場合は、対象の DOM 要素を取得して `play()` や `stop()` を呼び出します。詳細な API は [基本的な再生](/usage/basic) を参照してください。

## SSCanvasPlayer を直接使う場合

TypeScript / JavaScript から直接 Canvas を指定して初期化することもできます。

```ts
import { SSCanvasPlayer } from '@spritestudio/ssplayer-webgl';

async function main() {
  await SSCanvasPlayer.initialize();

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  document.body.appendChild(canvas);

  // オプションで自動再生や WebGL コンテキストの設定が可能です
  const player = new SSCanvasPlayer(canvas, { autoStart: true });
  await player.load('/assets/Ringo.ssab');
  await player.setAnimation('run');
  player.play();
}

main().catch(console.error);
```
