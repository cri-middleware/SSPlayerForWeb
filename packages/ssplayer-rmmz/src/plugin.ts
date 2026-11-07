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
import { installAutoImport } from './rmmz/autoImport.js';
import { installWasmBootGate } from './rmmz/boot.js';
import { defineSpriteSpriteStudio } from './rmmz/Sprite_SpriteStudio.js';
import { installGamePictureBridge } from './rmmz/gamePictureBridge.js';
import { adoptLivePlayer, armLiveChain, clearLiveChain, clearLivePlayerEnded, deferLiveCommand, getLivePlayer } from './rmmz/liveRegistry.js';
import { installInterpreterWait, beginSSWait, beginSSTrackFadeWait } from './rmmz/interpreterWait.js';
import { installMessageTalk, setSSTalk, clearSSTalk } from './rmmz/messageTalk.js';
import { playAnimation } from './rmmz/playAnimation.js';
import type { SSPictureData } from './rmmz/gamePictureBridge.js';
import {
  parsePartOverrideColor,
  prunePartOverridesForNewAnimation,
  SSPartOverrideStore,
  type SSBlendOp,
  type SSOverridePriority,
  type SSPartOverride,
  applySavedTrack,
  withSavedTrack,
  withoutSavedTrack,
  type SSSavedTrack,
  type SSTrackBlend,
} from '@spritestudio/ssplayer-webgl';

const PLUGIN_NAME = 'ssplayer-rpgmakermz';

// Seeded from the clock so an id never repeats one a loaded save carries.
let lastShowId = Date.now();

function num(v: unknown, dflt = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** A command's `transition` in ms: 0 (a cut) when blank or not above 0. */
function transitionMs(v: unknown): number {
  return Math.max(0, num(v, 0));
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

  //    On a test play, convert what changed under SpriteStudio_Source/ before
  //    the title — when ssconverter_bg.wasm sits beside this plugin.
  installAutoImport();

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

  // The override list for one picture: the saved copy lives on Game_Picture
  // (authoritative — the player may not be mounted yet, and is rebuilt on every
  // scene change), the live copy on the runtime. The store keeps the two in step
  // so no command has to remember the dance. Cheap enough to build per call.
  const overridesOf = (pictureId: number): SSPartOverrideStore =>
    new SSPartOverrideStore({
      read: () => g.$gameScreen.picture(pictureId)?.ssData?.()?.overrides,
      write: (list) => {
        const pic = g.$gameScreen.picture(pictureId);
        const cur = pic && pic.ssData ? pic.ssData() : null;
        if (cur) pic.setSSData({ ...cur, overrides: list });
      },
      // One still loading has no parts to resolve; the mount applies the saved list.
      player: () => {
        const player = getLivePlayer(pictureId);
        return player && player.currentAnimation ? player : null;
      },
    });

  /**
   * After a cut on the live player (playSSOnce, playSSSequence): the runtime
   * dropped every non-Permanent override and folded its stack back to track 0,
   * so the saved copy follows suit and a load cannot bring either back.
   */
  const afterCut = (pictureId: number): void => {
    overridesOf(pictureId).pruneForNewAnimation();
    const pic = g.$gameScreen.picture(pictureId);
    const cur = pic && pic.ssData ? pic.ssData() : null;
    if (cur?.tracks) pic.setSSData({ ...cur, tracks: undefined });
  };

  /** Make what the live player has reached the picture's own animation, so a scene change or a load keeps it. */
  const settle = (pictureId: number): void => {
    const player = getLivePlayer(pictureId);
    const pic = g.$gameScreen.picture(pictureId);
    const cur = pic && pic.ssData ? pic.ssData() : null;
    if (!player || !cur) return;
    pic.setSSData({ ...cur, animation: player.currentAnimation, loop: player.loopCount });
    adoptLivePlayer(pictureId);
  };

  /** The track number a track command was given, or null (warned) for track 0 and below. */
  const trackArg = (args: Record<string, string>, label: string): number | null => {
    const track = Math.floor(num(args.track, 1));
    if (track >= 1) return track;
    console.warn(`[ssplayer-rmmz] ${label}: トラック 0 はピクチャのアニメです。「SSアニメ切替」を使ってください。`);
    return null;
  };

  /** Set one override, after checking the picture actually carries an SS. */
  const setPartOverride = (pictureId: number, label: string, entry: SSPartOverride): void => {
    if (!ssPicture(pictureId, label)) return;
    overridesOf(pictureId).set(entry);
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
    if (pic) pic.setSSData({ ...buildSSData(args), showId: ++lastShowId });
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
    const transition = transitionMs(args.transition);
    const animation = String(args.animation || cur.animation);
    // Only a cut to another animation sets one up: the runtime clears all but
    // the Permanent overrides and folds its stack back to track 0. A crossfade,
    // or a change of loop alone, keeps both.
    const cut = animation !== cur.animation && transition <= 0;
    pic.setSSData({
      ...cur,
      animation,
      loop: args.loop === undefined || String(args.loop).trim() === '' ? cur.loop : num(args.loop, cur.loop),
      transition,
      overrides: cut ? prunePartOverridesForNewAnimation(cur.overrides) : cur.overrides,
      tracks: cut ? undefined : cur.tracks,
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
    clearLivePlayerEnded(pictureId);
    const oneShot = String(args.animation || '');
    // Play count for the one-shot: >=1 finite (0 is coerced to 1; -1 would never
    // end and never revert, so it's clamped to 1 too).
    const count = Math.max(1, num(args.loop, 1));
    const transition = transitionMs(args.transition);
    const player = getLivePlayer(pictureId);
    const pic = g.$gameScreen.picture(pictureId);
    const cur = pic && pic.ssData ? pic.ssData() : null;
    if (!player || !cur || !oneShot) {
      console.warn(`[ssplayer-rmmz] playSSOnce: ピクチャ ${pictureId} に SS がありません。`);
      return;
    }
    // Both the one-shot and the return-to-base switch animation.
    const play = (name: string, loop: number): void => {
      if (playAnimation(player, name, loop, transition)) afterCut(pictureId);
    };
    const start = (): void => {
      // Read now: a blank animation name is settled when the pack has loaded.
      const base = (pic.ssData() ?? cur).animation;
      const baseLoop = cur.loop;
      const revert = () => {
        try {
          play(base, baseLoop);
        } catch (e: unknown) {
          console.error('[ssplayer-rmmz] playSSOnce: failed to return to base loop:', e);
        }
      };
      // Owned by the registry, so a later command (changeSSAnimation, another
      // playSSOnce, stopSS, removeSS) can cancel the pending revert instead of
      // having it fire afterwards and clobber whatever is playing by then.
      armLiveChain(
        pictureId,
        player.onAnimationFinished(() => {
          clearLiveChain(pictureId);
          revert();
        }),
      );
      try {
        play(oneShot, count);
      } catch (e: unknown) {
        clearLiveChain(pictureId);
        console.error('[ssplayer-rmmz] playSSOnce: failed to play one-shot:', e);
      }
    };
    if (player.currentAnimation) start();
    else deferLiveCommand(pictureId, start);
  });

  // Play a comma-separated SEQUENCE of animations: every entry but the LAST
  // plays once, the last plays with `loop` (default -1 = loop forever):
  // "attack1,attack2,wait1" -> attack1 once, attack2 once,
  // then wait1 loops. The last entry becomes the picture's animation once it
  // starts.
  reg(PLUGIN_NAME, 'playSSSequence', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    clearLiveChain(pictureId); // supersede an earlier one-shot / sequence
    clearLivePlayerEnded(pictureId);
    const seq = String(args.animations || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const lastLoop = num(args.loop, -1);
    const transition = transitionMs(args.transition);
    const player = getLivePlayer(pictureId);
    if (!player || seq.length === 0) {
      console.warn(`[ssplayer-rmmz] playSSSequence: ピクチャ ${pictureId} に SS が無い、または列が空です。`);
      return;
    }
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
          player.onAnimationFinished(() => {
            clearLiveChain(pictureId);
            i += 1;
            step();
          }),
          true,
        );
      }
      try {
        if (playAnimation(player, name, loop, transition)) afterCut(pictureId);
        if (isLast) settle(pictureId);
      } catch (e: unknown) {
        clearLiveChain(pictureId);
        console.error('[ssplayer-rmmz] playSSSequence: failed to play:', e);
      }
    };
    if (player.currentAnimation) step();
    else deferLiveCommand(pictureId, step);
  });

  // --- Tracks above track 0 ---
  //
  // Each command applies its change to the live player at once, when there is
  // one set up, and records it on the picture, so save/load and a scene change
  // lay the tracks again (SSPictureData.tracks). Track 0 is the picture's own
  // animation, so these refuse it. A player that has no animation set up yet
  // (still loading) is left to the mount, which lays the saved list.

  // Lay an animation on a track, mixed over (or added to) what is below.
  reg(PLUGIN_NAME, 'setSSTrack', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    const found = ssPicture(pictureId, 'setSSTrack');
    const track = trackArg(args, 'setSSTrack');
    if (!found || track === null) return;
    const entry: SSSavedTrack = {
      track,
      animation: String(args.animation || ''),
      alpha: num(args.alpha, 1),
      blend: num(args.blend, 0) as SSTrackBlend,
      loop: num(args.loop, -1),
    };
    if (!entry.animation) {
      console.warn('[ssplayer-rmmz] setSSTrack: アニメーション名が空です。');
      return;
    }
    const player = getLivePlayer(pictureId);
    if (player && player.currentAnimation) {
      try {
        if (!applySavedTrack(player, entry, transitionMs(args.transition))) return;
      } catch (e: unknown) {
        console.error('[ssplayer-rmmz] setSSTrack: failed to lay the track:', e);
        return;
      }
    }
    found.pic.setSSData({ ...found.cur, tracks: withSavedTrack(found.cur.tracks, entry) });
  });

  // Fade a track's alpha to a target over a time; the save keeps the target.
  reg(PLUGIN_NAME, 'fadeSSTrack', function (this: any, args: Record<string, string>) {
    const pictureId = num(args.pictureId, 1);
    const found = ssPicture(pictureId, 'fadeSSTrack');
    const track = trackArg(args, 'fadeSSTrack');
    if (!found || track === null) return;
    const entry = found.cur.tracks?.find((e) => e.track === track);
    if (!entry) {
      console.warn(`[ssplayer-rmmz] fadeSSTrack: ピクチャ ${pictureId} のトラック ${track} には何も置かれていません。`);
      return;
    }
    const alpha = num(args.alpha, 0);
    const duration = Math.max(0, num(args.duration, 500));
    const player = getLivePlayer(pictureId);
    const live = !!player && !!player.currentAnimation;
    if (live) {
      try {
        if (duration > 0) player!.fadeTrack(track, alpha, duration);
        else player!.setTrackAlpha(track, alpha);
      } catch (e: unknown) {
        console.error('[ssplayer-rmmz] fadeSSTrack: failed to fade:', e);
        return;
      }
    }
    found.pic.setSSData({ ...found.cur, tracks: withSavedTrack(found.cur.tracks, { ...entry, alpha }) });
    if (args.wait === 'true' && live && duration > 0) beginSSTrackFadeWait(this as any, pictureId, track);
  });

  // Empty a track.
  reg(PLUGIN_NAME, 'clearSSTrack', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    const found = ssPicture(pictureId, 'clearSSTrack');
    const track = trackArg(args, 'clearSSTrack');
    if (!found || track === null) return;
    const player = getLivePlayer(pictureId);
    if (player && track < player.trackCount) {
      try {
        player.clearTrack(track);
      } catch (e: unknown) {
        console.error('[ssplayer-rmmz] clearSSTrack: failed to clear:', e);
      }
    }
    found.pic.setSSData({ ...found.cur, tracks: withoutSavedTrack(found.cur.tracks, track) });
  });

  // Lip-sync: bind this picture as a talking portrait — plays `talk` while a
  // message is printing text and `idle` when it finishes (see messageTalk.ts).
  reg(PLUGIN_NAME, 'setSSTalk', (args: Record<string, string>) => {
    setSSTalk(
      num(args.pictureId, 1),
      String(args.name || ''),
      String(args.talk || ''),
      String(args.idle || ''),
      transitionMs(args.transition),
    );
  });
  reg(PLUGIN_NAME, 'clearSSTalk', (args: Record<string, string>) => {
    clearSSTalk(num(args.pictureId, 1));
  });

  // --- Part overrides ---
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
    setPartOverride(num(args.pictureId, 1), 'setSSPartColor', {
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
    setPartOverride(num(args.pictureId, 1), 'setSSPartVisibility', {
      kind: 'visibility',
      part: String(args.part || ''),
      hide: args.hide !== 'false',
      cascade: args.cascade === 'true',
    });
  });

  // Swap the cell a part draws. The cell map name carries no .ssce extension.
  // Normal and mask parts only.
  reg(PLUGIN_NAME, 'setSSPartCell', (args: Record<string, string>) => {
    setPartOverride(num(args.pictureId, 1), 'setSSPartCell', {
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
    if (!ssPicture(pictureId, 'clearSSPartOverrides')) return;
    overridesOf(pictureId).clear(String(args.part || '') || undefined);
  });

  // playSS / stopSS restart or end playback outright, so a queued follow-up is
  // no longer wanted. pauseSS deliberately keeps it: resuming should carry on.
  reg(PLUGIN_NAME, 'playSS', (args: Record<string, string>) => {
    const pictureId = num(args.pictureId, 1);
    clearLiveChain(pictureId);
    clearLivePlayerEnded(pictureId);
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
