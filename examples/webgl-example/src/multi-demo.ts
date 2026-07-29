import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';

/**
 * Many animations, one WebGL context.
 *
 * There is deliberately almost nothing here. Every animation on the page is a
 * plain `<ss-player>` element in the markup; registering the tag is the entire
 * setup. The elements own no canvases — the shared `SSOverlay` created on first
 * use holds one, reads their rects every frame, and draws each animation where
 * its element is.
 *
 * The HUD exists only to make the invisible part visible: the animation count
 * climbs as you scroll, the context count stays at one. A page built from a
 * canvas per animation would have started blanking them around a dozen in.
 */

defineSSPlayerElement();

const countEl = document.getElementById('count');
const wouldBeEl = document.getElementById('wouldbe');

const players = document.querySelectorAll('ss-player');
if (countEl) countEl.textContent = String(players.length);
if (wouldBeEl) {
  wouldBeEl.textContent =
    `one context per animation would be ${players.length}` +
    (players.length > 8 ? ' — past the browser cap' : '');
}
