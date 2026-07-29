import { defineSSPlayerElement, type SSPlayerElement } from '@spritestudio/ssplayer-webgl/element';

/**
 * Many animations, one WebGL context.
 *
 * The page itself is just `<ss-player>` elements in markup; registering the tag
 * is the entire setup. The elements own no canvases — the shared `SSOverlay`
 * created on first use holds one, reads their rects every frame, and draws each
 * animation where its element is.
 *
 * Everything below only exists to make the invisible parts checkable. Two claims
 * need evidence, and neither is visible by just looking at the page:
 *
 *   1. "one context, however many animations" — the HUD prints both counts.
 *   2. "off-screen animations stop" — every animation prints its current frame,
 *      which freezes when its element scrolls away. Without that you would have
 *      to take it on faith: a looping animation looks the same whether it kept
 *      running off-screen or resumed from where it stopped.
 */

defineSSPlayerElement();

const countEl = document.getElementById('count');
const activeEl = document.getElementById('active');
const wouldBeEl = document.getElementById('wouldbe');

const elements = Array.from(document.querySelectorAll<SSPlayerElement>('ss-player'));

if (countEl) countEl.textContent = String(elements.length);
if (wouldBeEl) {
  wouldBeEl.textContent =
    `one context per animation would be ${elements.length}` +
    (elements.length > 8 ? ' — past the browser cap' : '');
}

for (const el of elements) {
  const badge = document.createElement('span');
  badge.className = 'frame-badge';
  badge.textContent = 'frame —';
  el.after(badge);

  void el.ready.then(() => {
    const player = el.player;
    if (!player) return;

    // onFrame fires only when the timeline actually advanced, so it stops firing
    // the moment the overlay skips this player — which is exactly the signal we
    // want to show.
    player.onFrame((frame) => {
      badge.textContent = `frame ${frame}`;
      badge.classList.remove('stopped');
    });

    // `visible` is what the overlay's IntersectionObserver sets. Poll it for the
    // labels rather than adding an observer of our own, so the HUD reports the
    // overlay's real state instead of a second opinion about it.
    setInterval(() => {
      if (!player.visible) badge.classList.add('stopped');
    }, 250);
  }).catch(() => { badge.textContent = 'failed to load'; });
}

setInterval(() => {
  if (!activeEl) return;
  activeEl.textContent = String(elements.filter((el) => el.player?.visible).length);
}, 250);
