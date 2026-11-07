import { Application } from 'pixi.js';
import { SSPlayer, SSTrackBlend, SSTrackSync, resolvePlacement } from '@spritestudio/ssplayer-pixi';

/**
 * Motion blending, driven from the keyboard.
 *
 * Whether a crossfade reads as a blend or a cut, and whether an additive overlay
 * leaves the motion below it standing, can only be judged by eye — so this page
 * puts every track call on a key and
 * prints the state the calls are meant to change next to the picture.
 *
 * What to look for:
 *   1. `C`, then `↑`: the animation the crossfade left behind comes back.
 *   2. `3` to 2×, then `C`: the incoming animation is still 2×.
 *   3. `T` to once, then `C`: the incoming animation finishes once; the outgoing does not finish the player.
 *   4. `S`, then `4`: track 1 plays once and holds its last frame, finished.
 *   5. `C` pressed quickly over and over: the pose never jumps.
 *   6. UserData.ssab, `C` with `E` off and on: the outgoing side's events stop, or run for the first half.
 */

const CROSSFADE_MS = 400;
const SPEEDS = [1, 2, 0.5];

const canvas = document.getElementById('view') as HTMLCanvasElement;
const packSelect = document.getElementById('pack') as HTMLSelectElement;
const stateTable = document.getElementById('state') as HTMLTableElement;
const eventsEl = document.getElementById('events') as HTMLDivElement;

// What the page laid, which the player has no reads for: the name on track 1,
// and the settings the keys cycle through.
const ui = {
  overlay: -1, // index into animationNames, -1 = nothing on track 1
  additive: false,
  sync: SSTrackSync.Free,
  speed: 0,
  loopOnce: false,
  overlayLoopOnce: false,
  outgoingHalf: false,
  setupPose: false,
};
const recent: string[] = [];

function log(line: string): void {
  recent.unshift(line);
  recent.length = Math.min(recent.length, 12);
  eventsEl.textContent = recent.join('\n');
}

async function main(): Promise<void> {
  await SSPlayer.initialize();
  const app = new Application();
  await app.init({ canvas, width: canvas.width, height: canvas.height, backgroundColor: 0x1a1a2e, preference: 'webgpu' });
  const player = new SSPlayer();
  player.attachRenderer(app.renderer);
  app.stage.addChild(player);

  // Every event names the source that fired it, so the outgoing and incoming
  // sides of a crossfade can be told apart in the log.
  const describe = (source: number) => {
    if (source === player.getTrackMainSource(0)) return 'track 0';
    if (source === player.getTrackMainSource(1)) return 'track 1';
    return `source ${source}`;
  };
  player.onUserData((e) => log(`userData f${e.frameNo} ${e.partName ?? e.partIndex} — ${describe(e.source)}`));
  player.onSignal((e) => log(`signal "${e.commandId}" f${e.frameNo} — ${describe(e.source)}`));
  player.onAudio((e) => log(`audio "${e.soundName ?? e.soundNameHash}" f${e.frameNo} — ${describe(e.source)}`));
  player.onAnimationFinished(() => log('— animationFinished (track 0)'));

  const load = async (url: string) => {
    await player.load(url);
    player.setAnimation(player.getAnimationNames()[0]);
    afterSetAnimation(player);
    player.play();
  };
  packSelect.addEventListener('change', () => void load(packSelect.value).catch((e) => log(`error: ${e}`)));

  window.addEventListener('keydown', (e) => {
    try {
      if (onKey(player, e.key)) e.preventDefault();
    } catch (err) {
      log(`error: ${(err as Error).message}`);
    }
  });

  const draw = () => {
    // Fit the playing animation's canvas into the view. A crossfade changes
    // which animation that is, so the fit is redone every frame.
    const fit = resolvePlacement(player.internalPlayer.getCanvasRect(), app.screen.width, app.screen.height);
    player.position.set(fit.x, fit.y);
    player.scale.set(fit.scale);
    renderState(player);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  await load(packSelect.value);
}

/** setAnimation folds the stack back to track 0, so what the page laid above it is gone. */
function afterSetAnimation(player: SSPlayer): void {
  ui.overlay = -1;
  ui.setupPose = false;
  // Sync goes back to Free on every track; put the page's choice back on.
  applySync(player);
}

function applySync(player: SSPlayer): void {
  player.setTrackSync(0, ui.sync);
  // Setting a track makes it, so track 1 is set only once something is on it
  // (and by `S`, right before laying).
  if (player.trackCount > 1) player.setTrackSync(1, ui.sync);
}

function nextIndex(names: readonly string[], name: string, step: number): number {
  const i = names.indexOf(name);
  return ((i < 0 ? 0 : i) + step + names.length) % names.length;
}

function onKey(player: SSPlayer, key: string): boolean {
  const names = player.getAnimationNames();
  if (names.length === 0) return false;
  switch (key) {
    case 'ArrowUp':
    case 'ArrowDown': {
      player.setAnimation(names[nextIndex(names, player.currentAnimation, key === 'ArrowUp' ? -1 : 1)]);
      afterSetAnimation(player);
      player.play();
      return true;
    }
    case 'c':
    case 'C': {
      const next = names[nextIndex(names, player.currentAnimation, 1)];
      player.crossfade(0, next, CROSSFADE_MS);
      log(`crossfade(0, "${next}") — currentAnimation is now "${player.currentAnimation}"`);
      return true;
    }
    case 's':
    case 'S': {
      ui.overlay = ui.overlay + 1 >= names.length ? -1 : ui.overlay + 1;
      if (ui.overlay < 0) {
        player.clearTrack(1);
      } else {
        // Sync applies to what is laid after it.
        player.setTrackSync(1, ui.sync);
        player.setTrackAnimation(1, names[ui.overlay]);
        player.setTrackBlend(1, ui.additive ? SSTrackBlend.Additive : SSTrackBlend.Mix);
        // A laid animation loops forever; the count goes on after laying.
        if (ui.overlayLoopOnce) player.setTrackLoopCount(1, 1);
      }
      return true;
    }
    case '1':
    case '2': {
      const alpha = player.getTrackAlpha(1);
      if (alpha !== undefined) player.setTrackAlpha(1, Math.min(1, Math.max(0, alpha + (key === '1' ? -0.1 : 0.1))));
      return true;
    }
    case 'a':
    case 'A': {
      ui.additive = !ui.additive;
      if (player.trackCount > 1) player.setTrackBlend(1, ui.additive ? SSTrackBlend.Additive : SSTrackBlend.Mix);
      return true;
    }
    case '0': {
      ui.setupPose = !ui.setupPose;
      player.fadeTrack(0, ui.setupPose ? 0 : 1, 600);
      return true;
    }
    case ',':
    case '.': {
      const frame = player.getTrackFrame(1);
      if (frame === undefined) return true;
      player.setTrackSpeed(1, 0);
      player.setTrackFrame(1, Math.max(0, frame + (key === ',' ? -1 : 1)));
      return true;
    }
    case 'y':
    case 'Y': {
      ui.sync = ui.sync === SSTrackSync.Free ? SSTrackSync.Start : SSTrackSync.Free;
      applySync(player);
      return true;
    }
    case '3': {
      ui.speed = (ui.speed + 1) % SPEEDS.length;
      player.speedScale = SPEEDS[ui.speed];
      return true;
    }
    case 't':
    case 'T': {
      ui.loopOnce = !ui.loopOnce;
      player.loopCount = ui.loopOnce ? 1 : -1;
      return true;
    }
    case '4': {
      ui.overlayLoopOnce = !ui.overlayLoopOnce;
      if (player.getTrackLoopCount(1) !== undefined) player.setTrackLoopCount(1, ui.overlayLoopOnce ? 1 : -1);
      return true;
    }
    case 'e':
    case 'E': {
      ui.outgoingHalf = !ui.outgoingHalf;
      player.setTrackOutgoingEventThreshold(0, ui.outgoingHalf ? 0.5 : Infinity);
      return true;
    }
    case ' ': {
      if (player.isPausing) player.resume();
      else player.pause();
      return true;
    }
    case 'Enter': {
      player.play();
      return true;
    }
  }
  return false;
}

function renderState(player: SSPlayer): void {
  const names = player.getAnimationNames();
  const fmt = (v: number | undefined, digits = 2) => (v === undefined ? '—' : Number.isFinite(v) ? v.toFixed(digits) : String(v));
  const progress = player.getTrackFadeProgress(0);
  const rows: [string, string][] = [
    ['track 0', `"${player.currentAnimation}"  main source ${player.getTrackMainSource(0) ?? '—'}`],
    ['fade', progress === undefined ? '—' : `${(progress * 100).toFixed(0)}%`],
    ['frame', `${fmt(player.frameNo, 1)} / ${player.totalFrames}`],
    ['state', `${player.isPlaying ? 'playing' : 'not playing'}${player.isPausing ? ', paused' : ''}${player.isFinished ? ', finished' : ''}`],
    ['speed / loop', `${fmt(player.speedScale)}× / ${player.loopCount === -1 ? '∞' : player.loopCount}`],
    ['sync', ui.sync === SSTrackSync.Start ? 'start' : 'free'],
    ['outgoing events', ui.outgoingHalf ? 'first half (0.5)' : 'never (∞)'],
    ['tracks', String(player.trackCount)],
  ];
  if (player.getTrackMainSource(1) !== undefined) {
    const loop = player.getTrackLoopCount(1);
    rows.push(
      ['track 1', `"${ui.overlay >= 0 ? names[ui.overlay] : '?'}"  ${player.getTrackBlend(1) === SSTrackBlend.Additive ? 'additive' : 'mix'}  alpha ${fmt(player.getTrackAlpha(1))}`],
      ['track 1 frame', `${fmt(player.getTrackFrame(1), 1)}  speed ${fmt(player.getTrackSpeed(1))}`],
      ['track 1 loop', `${loop === -1 ? '∞' : loop}${player.isTrackFinished(1) ? ', finished' : ''}`],
    );
  }
  stateTable.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td><b>${v.replace(/</g, '&lt;')}</b></td></tr>`).join('');
}

main().catch((e) => log(`error: ${e}`));
