import { SSSurface, SSPlayer, SSRuntimeManager } from '@spritestudio/ssplayer-webgl';

/**
 * Many players, one WebGL context.
 *
 * The point of this page is the thing you cannot see: however many animations
 * are on screen, there is exactly one `<canvas>` and one GL context. Browsers
 * cap live contexts at roughly 8–16 per page, so the old one-context-per-player
 * shape ran out at a dozen or so and then started blanking canvases. Here the
 * cap applies to the *surface*, and there is only ever one.
 *
 * It also exercises the pieces overlay mode will be built from: each player is
 * placed by its `box` (a destination rect) rather than by absolute pixels, and
 * ordering / alpha / tint are per player.
 */

// Same bundled sample set as the main demo (see main.ts).
const BUNDLED_SSABS = [
  '/Ringo/Ringo.ssab',
  '/overall/Basic.ssab',
  '/overall/Shape.ssab',
  '/overall/PartsColor.ssab',
  '/overall/Mesh.ssab',
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('surface');
const ssabSelect = $<HTMLSelectElement>('ssab');
const alphaInput = $<HTMLInputElement>('alpha');
const alphaVal = $<HTMLSpanElement>('alphaVal');
const tintInput = $<HTMLInputElement>('tint');
const countsEl = $<HTMLDivElement>('counts');
const snippetEl = $<HTMLPreElement>('snippet');
const statusEl = $<HTMLDivElement>('status');

const setStatus = (msg: string) => { statusEl.textContent = msg; };

async function main(): Promise<void> {
  await SSSurface.initialize();

  // The one context on this page. Opaque background because several of the
  // samples use framebuffer-reading blend modes (Add / Screen / Mul), which have
  // nothing to composite against on a transparent surface.
  const surface = new SSSurface(canvas, { autoStart: true, backgroundColor: 0x1a1a2e });

  for (const path of BUNDLED_SSABS) {
    const opt = document.createElement('option');
    opt.value = path;
    opt.textContent = path.replace(/^\/|\.ssab$/g, '');
    ssabSelect.append(opt);
  }

  // Players in creation order, so "the newest" is the one the controls act on.
  const players: SSPlayer[] = [];

  /**
   * Lay every player out on a grid by setting its `box` — the rect it is centred
   * in. Nothing here computes a pixel position for the animation itself: the
   * player centres in whatever box it is given, so re-laying out is just handing
   * out new rects. Overlay mode will do exactly this from element rects.
   */
  const layout = (): void => {
    const n = players.length;
    if (n === 0) return;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const w = canvas.width / cols;
    const h = canvas.height / rows;
    players.forEach((player, i) => {
      player.box = { x: (i % cols) * w, y: Math.floor(i / cols) * h, w, h };
      // Scale down as the grid gets denser so the animations keep fitting.
      const s = Math.min(1, 2 / cols);
      player.setTransform({ scaleX: s, scaleY: s });
    });
  };

  const refresh = (): void => {
    countsEl.innerHTML =
      `players: <b>${players.length}</b><br>` +
      `WebGL contexts: <b>1</b><br>` +
      `<span class="warn">one context per player would be ${players.length}` +
      (players.length > 8 ? ' — past the browser cap' : '') +
      `</span>`;
    snippetEl.textContent =
      `const surface = new SSSurface(canvas, { autoStart: true });\n` +
      players.map((_, i) => `const p${i + 1} = surface.createPlayer();`).join('\n');
  };

  const addPlayer = async (url: string): Promise<void> => {
    const player = surface.createPlayer();
    players.push(player);
    try {
      await player.load(url);
      const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const anim = SSRuntimeManager.extractAnimationNames(buf)[0];
      if (!anim) throw new Error(`no animation in ${url}`);
      await player.setAnimation(anim);
      player.play();
      layout();
      refresh();
      setStatus(`Added ${url} (${anim}). Still one context.`);
    } catch (err) {
      // Drop the half-built player rather than leaving it in the draw list.
      player.destroy();
      players.splice(players.indexOf(player), 1);
      layout();
      refresh();
      setStatus(`Failed to add ${url}: ${(err as Error).message}`);
    }
  };

  const newest = (): SSPlayer | undefined => players[players.length - 1];

  $('add').addEventListener('click', () => { void addPlayer(ssabSelect.value); });

  $('remove').addEventListener('click', () => {
    const player = players.pop();
    if (!player) return;
    // destroy() frees this player's own wasm allocation and textures, and takes
    // it out of the surface's draw list. The surface, its context and every
    // other player are untouched.
    player.destroy();
    layout();
    refresh();
    setStatus('Removed one player. The surface and the rest keep drawing.');
  });

  alphaInput.addEventListener('input', () => {
    const a = Number(alphaInput.value);
    alphaVal.textContent = a.toFixed(2);
    const player = newest();
    if (player) player.alpha = a;
  });

  tintInput.addEventListener('input', () => {
    const player = newest();
    if (player) player.tint = parseInt(tintInput.value.slice(1), 16);
  });

  $('front').addEventListener('click', () => {
    const player = newest();
    if (!player) return;
    // Draw order is a per-player key on the surface, not DOM stacking — there is
    // only one canvas to stack.
    player.order = 1;
    surface.invalidateOrder();
    setStatus('Newest player drawn last (in front).');
  });

  $('back').addEventListener('click', () => {
    const player = newest();
    if (!player) return;
    player.order = -1;
    surface.invalidateOrder();
    setStatus('Newest player drawn first (behind the others).');
  });

  // Start with a few so the page shows the point immediately.
  for (const url of BUNDLED_SSABS.slice(0, 4)) await addPlayer(url);
}

main().catch((err) => {
  console.error(err);
  setStatus(`Failed to start: ${(err as Error).message}`);
});
