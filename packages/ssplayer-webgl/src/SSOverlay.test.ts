import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./SSSurface.js', () => ({
  SSSurface: class {
    resize = vi.fn();
    draw = vi.fn();
    destroy = vi.fn();
  },
}));

import { SSOverlay } from './SSOverlay.js';

describe('SSOverlay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not play the time a hidden tab was away', () => {
    let frame: FrameRequestCallback = () => {};
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const overlay = SSOverlay.getOrCreate('hidden-tab');
    const player = { visible: true, update: vi.fn(), setBox: vi.fn() };
    (overlay as unknown as { entries: Map<unknown, HTMLElement> }).entries.set(player, document.createElement('div'));

    now = 1016;
    frame(1016);
    expect(player.update).toHaveBeenLastCalledWith(16);

    // A minute in the background: no animation frames, then the tab comes back.
    now = 61016;
    document.dispatchEvent(new Event('visibilitychange'));
    now = 61032;
    frame(61032);
    expect(player.update).toHaveBeenLastCalledWith(16);

    overlay.destroy();
  });

  it('marks its surface as the shared overlay, so several elements draw there without a warning', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const overlay = SSOverlay.getOrCreate('shared-overlay');
    expect(overlay.surface.sharedOverlay).toBe(true);
    overlay.destroy();
  });
});
