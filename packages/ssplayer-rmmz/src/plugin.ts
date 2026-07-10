// Runtime plugin entry (IIFE). Dropped into js/plugins/ as
// ssplayer-rpgmakermz.js, it self-registers on load: it wires the SS
// ObjectRenderer, starts WASM init + gates Scene_Boot, installs the
// Game_Picture <-> Sprite_Picture bridge, and registers the plugin commands.
//
// The MZ annotation banner (/*: and /*:ja) is prepended at build time (see
// tsdown.config.ts). This file must run AFTER the MZ core scripts, which is
// guaranteed for anything under js/plugins/.

import { registerSSPlayerRenderer } from './SSPlayerRenderer.js';
import { getSelfScriptDir } from './rmmzGlobals.js';
import { installWasmBootGate } from './rmmz/boot.js';
import { defineSpriteSpriteStudio } from './rmmz/Sprite_SpriteStudio.js';
import { installGamePictureBridge } from './rmmz/gamePictureBridge.js';
import { getLivePlayer } from './rmmz/liveRegistry.js';
import { installInterpreterWait, beginSSWait } from './rmmz/interpreterWait.js';
import type { SSPictureData } from './rmmz/gamePictureBridge.js';

const PLUGIN_NAME = 'ssplayer-rpgmakermz';

function num(v: unknown, dflt = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function boot(): void {
  const g = globalThis as any;
  if (!g.PIXI || !g.PluginManager) {
    console.warn('[ssplayer-rmmz] RPG Maker MZ runtime not found; plugin idle.');
    return;
  }

  // 1. Register the ObjectRenderer plugin BEFORE MZ creates its Renderer.
  registerSSPlayerRenderer();

  // 2. Start WASM init + boot gate. The WASM sits next to this plugin .js
  //    (derived from document.currentScript) — no configuration needed.
  installWasmBootGate(`${getSelfScriptDir()}ssruntime_bg.wasm`);

  // 3. Build the view class against MZ's global Sprite and install the bridges.
  const SpriteSpriteStudio = defineSpriteSpriteStudio(g.Sprite);
  installGamePictureBridge(SpriteSpriteStudio as unknown as new () => any);
  installInterpreterWait();

  // 4. Plugin commands.
  const reg = g.PluginManager.registerCommand.bind(g.PluginManager);

  reg(PLUGIN_NAME, 'showSS', function (this: any, args: Record<string, string>) {
    const pictureId = num(args.pictureId, 1);
    const scale = num(args.scale, 100);
    const data: SSPictureData = {
      ssabUrl: String(args.ssab || ''),
      animation: String(args.animation || ''),
      loop: num(args.loop, -1),
      signalSwitch: num(args.signalSwitch, 0) || undefined,
    };
    // Show a (bitmap-less) anchor picture carrying the transform; the bridge
    // keeps it visible and mounts the SS child.
    g.$gameScreen.showPicture(pictureId, '', 0, num(args.x, 408), num(args.y, 312), scale, scale, 255, 0);
    const pic = g.$gameScreen.picture(pictureId);
    if (pic) pic.setSSData(data);
    // Optional: hold the event until this (non-looping) animation finishes.
    if (args.wait === 'true') beginSSWait(this as any, pictureId);
  });

  // Wait until the picture's SS animation finishes (non-looping playback).
  reg(PLUGIN_NAME, 'waitForSS', function (this: any, args: Record<string, string>) {
    beginSSWait(this, num(args.pictureId, 1));
  });

  reg(PLUGIN_NAME, 'playSS', (args: Record<string, string>) => {
    getLivePlayer(num(args.pictureId, 1))?.play();
  });
  reg(PLUGIN_NAME, 'pauseSS', (args: Record<string, string>) => {
    getLivePlayer(num(args.pictureId, 1))?.pause();
  });
  reg(PLUGIN_NAME, 'stopSS', (args: Record<string, string>) => {
    getLivePlayer(num(args.pictureId, 1))?.stop();
  });
  reg(PLUGIN_NAME, 'removeSS', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    const pic = g.$gameScreen.picture(pictureId);
    if (pic && pic.setSSData) pic.setSSData(null);
    g.$gameScreen.erasePicture(pictureId);
  });

  console.log('[ssplayer-rmmz] plugin registered.');
}

boot();
