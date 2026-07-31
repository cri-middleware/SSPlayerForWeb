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
import { armLiveChain, clearLiveChain, getLivePlayer } from './rmmz/liveRegistry.js';
import { installInterpreterWait, beginSSWait } from './rmmz/interpreterWait.js';
import { installMessageTalk, setSSTalk, clearSSTalk } from './rmmz/messageTalk.js';
import type { SSPictureData } from './rmmz/gamePictureBridge.js';
import {
  applyPartOverrides,
  mergePartOverride,
  parsePartOverrideColor,
  prunePartOverridesForNewAnimation,
  removePartOverrides,
  type SSBlendOp,
  type SSOverridePriority,
  type SSPartOverride,
} from '@spritestudio/ssplayer-webgl';

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
  installMessageTalk();

  // 4. Plugin commands.
  const reg = g.PluginManager.registerCommand.bind(g.PluginManager);

  // Read the SS model off a picture, warning once when there is none. Shared by
  // every command that edits an existing SS picture rather than creating one.
  const ssPicture = (pictureId: number, label: string): { pic: any; cur: SSPictureData } | null => {
    const pic = g.$gameScreen.picture(pictureId);
    const cur = pic && pic.ssData ? pic.ssData() : null;
    if (!cur) {
      console.warn(`[ssplayer-rmmz] ${label}: ピクチャ ${pictureId} に SS がありません。`);
      return null;
    }
    return { pic, cur };
  };

  // Record a part override on the picture (authoritative, saved) and apply it to
  // the live player so it shows immediately — the same two-step `setSSSpeed`
  // uses. When no player is mounted yet (the .ssab is still loading) only the
  // persisted copy is written; the bridge applies it as the player mounts.
  const setOverride = (pictureId: number, label: string, entry: SSPartOverride): void => {
    const target = ssPicture(pictureId, label);
    if (!target) return;
    target.pic.setSSData({ ...target.cur, overrides: mergePartOverride(target.cur.overrides, entry) });
    const player = getLivePlayer(pictureId);
    if (player) applyPartOverrides(player, [entry]);
  };

  // Setting up a new animation makes the runtime drop every override but the
  // Permanent ones. Keep the saved copy in step so a later load cannot resurrect
  // what the runtime already discarded.
  const pruneOverrides = (pictureId: number): void => {
    const pic = g.$gameScreen.picture(pictureId);
    const cur = pic && pic.ssData ? pic.ssData() : null;
    if (!cur || !cur.overrides || cur.overrides.length === 0) return;
    pic.setSSData({ ...cur, overrides: prunePartOverridesForNewAnimation(cur.overrides) });
  };

  const buildSSData = (args: Record<string, string>): SSPictureData => ({
    ssabUrl: String(args.ssab || ''),
    animation: String(args.animation || ''),
    loop: num(args.loop, -1),
    signalSwitch: num(args.signalSwitch, 0) || undefined,
  });

  // showSS: convenience "create + play". Shows a (bitmap-less) anchor picture
  // AND attaches the SS in one step. Because it creates the picture itself, do
  // NOT drive the same picture id with a standalone "Show Picture" command.
  reg(PLUGIN_NAME, 'showSS', function (this: any, args: Record<string, string>) {
    const pictureId = num(args.pictureId, 1);
    const scale = num(args.scale, 100);
    clearLiveChain(pictureId); // this picture is being redefined
    // Show a (bitmap-less) anchor picture carrying the transform; the bridge
    // keeps it visible and mounts the SS child.
    g.$gameScreen.showPicture(pictureId, '', 0, num(args.x, 408), num(args.y, 312), scale, scale, 255, 0);
    const pic = g.$gameScreen.picture(pictureId);
    if (pic) pic.setSSData(buildSSData(args));
    // Optional: hold the event until this (non-looping) animation finishes.
    if (args.wait === 'true') beginSSWait(this as any, pictureId);
  });

  // setSSAsPicture: attach an SS animation to a picture that is ALREADY shown by
  // the native "Show Picture" command (the Picture*.js / ss6player convention).
  // It does NOT create the picture, so the picture's image, position, Move
  // Picture and Erase Picture stay under the standard event commands.
  reg(PLUGIN_NAME, 'setSSAsPicture', function (this: any, args: Record<string, string>) {
    const pictureId = num(args.pictureId, 1);
    clearLiveChain(pictureId); // this picture is being redefined
    const pic = g.$gameScreen.picture(pictureId);
    if (!pic || !pic.setSSData) {
      console.warn(
        `[ssplayer-rmmz] setSSAsPicture: ピクチャ ${pictureId} が未表示です。先に「ピクチャの表示」で枠を作ってください。`,
      );
      return;
    }
    pic.setSSData(buildSSData(args));
    // Optional: hold the event until this (non-looping) animation finishes.
    if (args.wait === 'true') beginSSWait(this as any, pictureId);
  });

  // Wait until the picture's SS animation finishes (non-looping playback).
  reg(PLUGIN_NAME, 'waitForSS', function (this: any, args: Record<string, string>) {
    beginSSWait(this, num(args.pictureId, 1));
  });

  // Switch the animation on an existing SS picture WITHOUT reloading the .ssab.
  // Updates the model (_ssData) so the view switches in place next frame and the
  // change survives save/load.
  reg(PLUGIN_NAME, 'changeSSAnimation', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    // The author asked for THIS animation; a one-shot's pending return-to-base
    // (or a queued sequence step) must not overwrite it a moment later.
    clearLiveChain(pictureId);
    const pic = g.$gameScreen.picture(pictureId);
    const cur = pic && pic.ssData ? pic.ssData() : null;
    if (!cur) {
      console.warn(`[ssplayer-rmmz] changeSSAnimation: ピクチャ ${pictureId} に SS がありません。`);
      return;
    }
    pic.setSSData({
      ...cur,
      animation: String(args.animation || cur.animation),
      loop: args.loop !== undefined ? num(args.loop, cur.loop) : cur.loop,
      // The runtime clears all but the Permanent overrides on the new setup.
      overrides: prunePartOverridesForNewAnimation(cur.overrides),
    });
  });

  // Set playback speed (1 = normal, 0.5 = half, 2 = double). Subframe
  // interpolation keeps slow speeds smooth. Applied live and persisted.
  reg(PLUGIN_NAME, 'setSSSpeed', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    const speed = num(args.speed, 1);
    getLivePlayer(pictureId) && (getLivePlayer(pictureId)!.speedScale = speed);
    const pic = g.$gameScreen.picture(pictureId);
    const cur = pic && pic.ssData ? pic.ssData() : null;
    if (cur) pic.setSSData({ ...cur, speed });
  });

  // Play a one-shot animation `loop` time(s) (default 1), then AUTOMATICALLY
  // return to the base loop (the looping animation currently on the picture).
  // The idiomatic portrait pattern: idle-loop → expression/emote → back to
  // idle-loop. The base loop stays in _ssData, so a save/load mid-emote simply
  // resumes the loop.
  reg(PLUGIN_NAME, 'playSSOnce', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    clearLiveChain(pictureId); // supersede an earlier one-shot / sequence
    const oneShot = String(args.animation || '');
    // Play count for the one-shot: >=1 finite (0 is coerced to 1; -1 would never
    // end and never revert, so it's clamped to 1 too).
    const count = Math.max(1, num(args.loop, 1));
    const player = getLivePlayer(pictureId);
    const pic = g.$gameScreen.picture(pictureId);
    const cur = pic && pic.ssData ? pic.ssData() : null;
    if (!player || !cur || !oneShot) {
      console.warn(`[ssplayer-rmmz] playSSOnce: ピクチャ ${pictureId} に SS がありません。`);
      return;
    }
    // Both the one-shot and the return-to-base set up an animation, so the
    // runtime drops every non-Permanent override; keep the saved copy in step.
    pruneOverrides(pictureId);
    const base = cur.animation;
    const baseLoop = cur.loop;
    const revert = () => {
      player.setAnimation(base, baseLoop).then(() => player.play()).catch((e: unknown) => {
        console.error('[ssplayer-rmmz] playSSOnce: failed to return to base loop:', e);
      });
    };
    // Owned by the registry, so a later command (changeSSAnimation, another
    // playSSOnce, stopSS, removeSS) can cancel the pending revert instead of
    // having it fire afterwards and clobber whatever is playing by then.
    armLiveChain(
      pictureId,
      player.onAnimationEnd(() => {
        clearLiveChain(pictureId);
        revert();
      }),
    );
    player.setAnimation(oneShot, count).then(() => player.play()).catch((e: unknown) => {
      clearLiveChain(pictureId);
      console.error('[ssplayer-rmmz] playSSOnce: failed to play one-shot:', e);
    });
  });

  // Play a comma-separated SEQUENCE of animations: every entry but the LAST
  // plays once, the last plays with `loop` (default -1 = loop forever). The
  // RenPy portrait idiom: "attack1,attack2,wait1" -> attack1 once, attack2 once,
  // then wait1 loops. Make the last entry your idle/base loop so the resting
  // state matches _ssData (save/load resumes the base).
  reg(PLUGIN_NAME, 'playSSSequence', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    clearLiveChain(pictureId); // supersede an earlier one-shot / sequence
    const seq = String(args.animations || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const lastLoop = num(args.loop, -1);
    const player = getLivePlayer(pictureId);
    if (!player || seq.length === 0) {
      console.warn(`[ssplayer-rmmz] playSSSequence: ピクチャ ${pictureId} に SS が無い、または列が空です。`);
      return;
    }
    // Every entry sets up an animation, so the runtime drops each non-Permanent
    // override; keep the saved copy in step.
    pruneOverrides(pictureId);
    let i = 0;
    const step = () => {
      const name = seq[i];
      const isLast = i === seq.length - 1;
      const loop = isLast ? lastLoop : 1;
      // Arm BEFORE starting playback so a failed setAnimation can drop the
      // pending step rather than leaving the sequence stalled on a listener
      // for an animation that never began.
      if (!isLast) {
        armLiveChain(
          pictureId,
          player.onAnimationEnd(() => {
            clearLiveChain(pictureId);
            i += 1;
            step();
          }),
        );
      }
      player.setAnimation(name, loop).then(() => player.play()).catch((e: unknown) => {
        clearLiveChain(pictureId);
        console.error('[ssplayer-rmmz] playSSSequence: failed to play:', e);
      });
    };
    step();
  });

  // Lip-sync: bind this picture as a talking portrait — plays `talk` while a
  // message is printing text and `idle` when it finishes (see messageTalk.ts).
  reg(PLUGIN_NAME, 'setSSTalk', (args: Record<string, string>) => {
    setSSTalk(num(args.pictureId, 1), String(args.name || ''), String(args.talk || ''), String(args.idle || ''));
  });
  reg(PLUGIN_NAME, 'clearSSTalk', (args: Record<string, string>) => {
    clearSSTalk(num(args.pictureId, 1));
  });

  // --- Part overrides (SDK docs: 40_components/65_override_layer) ---
  //
  // "Make this part this colour / this cell / hidden NOW", winning over the
  // keyframed animation. Each command writes the picture (saved) and applies it
  // live; see setOverride. Part names come from the SpriteStudio project.

  // Tint one part. Colour is typed as hex (#RRGGBB or #RRGGBBAA) because MZ has
  // no colour parameter type; alpha defaults to opaque. Normal parts only.
  reg(PLUGIN_NAME, 'setSSPartColor', (args: Record<string, string>) => {
    const rgba = parsePartOverrideColor(String(args.color || ''));
    if (rgba === null) {
      console.warn(`[ssplayer-rmmz] setSSPartColor: 色 "${args.color}" を解釈できません（例: #FF0000 / #FF0000BF）。`);
      return;
    }
    setOverride(num(args.pictureId, 1), 'setSSPartColor', {
      kind: 'color',
      part: String(args.part || ''),
      blendOp: num(args.blendOp, 0) as SSBlendOp,
      rgba,
      priority: num(args.priority, 1) as SSOverridePriority,
    });
  });

  // Force-hide a part (or revert it). `cascade` takes the descendants with it —
  // note that a keyframed hide never cascades, so this is the only way to hide a
  // whole sub-tree. Visibility has no priority mode.
  reg(PLUGIN_NAME, 'setSSPartVisibility', (args: Record<string, string>) => {
    setOverride(num(args.pictureId, 1), 'setSSPartVisibility', {
      kind: 'visibility',
      part: String(args.part || ''),
      hide: args.hide !== 'false',
      cascade: args.cascade === 'true',
    });
  });

  // Swap the cell a part draws. The cell map name carries no .ssce extension.
  // Normal and mask parts only.
  reg(PLUGIN_NAME, 'setSSPartCell', (args: Record<string, string>) => {
    setOverride(num(args.pictureId, 1), 'setSSPartCell', {
      kind: 'cell',
      part: String(args.part || ''),
      cellmap: String(args.cellmap || ''),
      cell: String(args.cell || ''),
      priority: num(args.priority, 1) as SSOverridePriority,
    });
  });

  // Clear the overrides on one part, or on every part when `part` is blank.
  reg(PLUGIN_NAME, 'clearSSPartOverrides', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    const part = String(args.part || '');
    const target = ssPicture(pictureId, 'clearSSPartOverrides');
    if (!target) return;
    target.pic.setSSData({ ...target.cur, overrides: removePartOverrides(target.cur.overrides, part || undefined) });
    const player = getLivePlayer(pictureId);
    if (!player) return;
    if (part) {
      player.clearPartColorOverride(part);
      player.clearPartCellOverride(part);
      player.clearPartVisibilityOverride(part);
    } else {
      player.clearAllPartOverrides();
    }
  });

  // playSS / stopSS restart or end playback outright, so a queued follow-up is
  // no longer wanted. pauseSS deliberately keeps it: resuming should carry on.
  reg(PLUGIN_NAME, 'playSS', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    clearLiveChain(pictureId);
    getLivePlayer(pictureId)?.play();
  });
  reg(PLUGIN_NAME, 'pauseSS', (args: Record<string, string>) => {
    getLivePlayer(num(args.pictureId, 1))?.pause();
  });
  reg(PLUGIN_NAME, 'stopSS', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    clearLiveChain(pictureId);
    getLivePlayer(pictureId)?.stop();
  });
  reg(PLUGIN_NAME, 'removeSS', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    clearLiveChain(pictureId);
    const pic = g.$gameScreen.picture(pictureId);
    if (pic && pic.setSSData) pic.setSSData(null);
    g.$gameScreen.erasePicture(pictureId);
  });

  console.log('[ssplayer-rmmz] plugin registered.');
}

boot();
