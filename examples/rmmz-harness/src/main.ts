// Browser harness for ssplayer-rmmz Layer 3.
//
// It creates a REAL PixiJS v5 renderer and drives the REAL SSPlayer /
// SSPlayerRenderer — the exact classes RPG Maker MZ runs. The only things faked
// are the two MZ globals the renderer touches: ImageManager.loadBitmap and the
// Bitmap it returns (we load PNGs from public/ into a canvas). If Ringo animates
// here, the MZ Layer-3 renderer works; the MZ plugin (Layer 4) is just glue.

import * as PIXI from 'pixi.js';
import ssruntimeWasmUrl from '@spritestudio/ssplayer-core/wasm/ssruntime_bg.wasm?url';

const statusEl = document.getElementById('status')!;
const animSel = document.getElementById('anim') as HTMLSelectElement;
const setStatus = (s: string) => (statusEl.textContent = s);

// --- Stub the minimal MZ globals the renderer / resource manager need. --------

class StubBitmap {
  private _canvas = document.createElement('canvas');
  private _w = 0;
  private _h = 0;
  private _ready = false;
  private _listeners: Array<(b: StubBitmap) => void> = [];
  constructor(url: string) {
    const img = new Image();
    img.onload = () => {
      this._w = img.width;
      this._h = img.height;
      this._canvas.width = img.width;
      this._canvas.height = img.height;
      this._canvas.getContext('2d')!.drawImage(img, 0, 0);
      this._ready = true;
      this._listeners.forEach((cb) => cb(this));
    };
    img.onerror = () => setStatus(`texture load failed: ${url}`);
    img.src = url;
  }
  get canvas() { return this._canvas; }
  get width() { return this._w; }
  get height() { return this._h; }
  isReady() { return this._ready; }
  addLoadListener(cb: (b: StubBitmap) => void) {
    if (this._ready) cb(this);
    else this._listeners.push(cb);
  }
}

(globalThis as any).PIXI = PIXI;
(globalThis as any).ImageManager = {
  loadBitmap(folder: string, filename: string) {
    return new StubBitmap(`${folder}${filename}.png`);
  },
};

// Real PixiJS v5 app → gives us renderer.gl, exactly like MZ's Graphics._app.
const app = new (PIXI as any).Application({
  width: 816,
  height: 624,
  backgroundColor: 0x1a1a2e,
  antialias: true,
});
app.view.id = 'stage';
document.body.appendChild(app.view);
(globalThis as any).Graphics = { _app: app };

// --- Boot: init WASM, mount the player, drive it from the ticker. -------------

async function boot() {
  // Import the package only AFTER window.PIXI is set (SSPlayer resolves its base
  // Container class from the global at import time).
  const { SSPlayer } = await import('@spritestudio/ssplayer-rmmz');

  setStatus('loading WASM…');
  await SSPlayer.initialize(ssruntimeWasmUrl);

  const player = new SSPlayer(app.renderer.gl);
  player.x = app.screen.width / 2;
  player.y = app.screen.height / 2 + 120; // Ringo's origin sits near the feet
  app.stage.addChild(player as unknown as any);

  setStatus('loading Ringo.ssab…');
  await player.load('/Ringo/Ringo.ssab');

  // Populate the animation dropdown from the .ssab.
  const names = player.getAnimationNames();
  animSel.innerHTML = names.map((n) => `<option>${n}</option>`).join('');
  const first = names.includes('wait1') ? 'wait1' : names[0];
  animSel.value = first;

  const playAnim = async (name: string) => {
    await player.setAnimation(name, -1);
    player.play();
  };
  await playAnim(first);

  animSel.onchange = () => void playAnim(animSel.value);
  document.getElementById('play')!.onclick = () => player.play();
  document.getElementById('pause')!.onclick = () => player.pause();

  // MZ advances animations from the sprite's update(); here we do it from the
  // Pixi ticker with the real frame delta.
  app.ticker.add(() => {
    player.update(app.ticker.deltaMS);
    setStatus(`${animSel.value}  frame ${player.frame}/${player.totalFrames}`);
  });
}

boot().catch((e) => {
  console.error(e);
  setStatus(`error: ${e?.message ?? e}`);
});
