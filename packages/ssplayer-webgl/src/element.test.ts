import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The surface, the overlay and the player are faked: what is pinned here is what
// the element does around them — how a failure is reported, which names it asks
// the player for, and what its shadow stylesheet says — none of which needs a GL
// context or the WASM runtime.

const initialize = vi.fn();

class FakePlayer {
  names = ['idle', 'run'];
  current = '';
  load = vi.fn().mockResolvedValue(undefined);
  loadBuffer = vi.fn().mockResolvedValue(undefined);
  getAnimationNames = () => this.names;
  setAnimation = vi.fn((name: string) => {
    if (!this.names.includes(name)) throw new Error(`no animation "${name}"`);
    this.current = name;
  });
  play = vi.fn();
  destroy = vi.fn();
  speedScale = 1;
  flipX = false;
  flipY = false;
  canvasRect: { x: number; y: number; width: number; height: number } | null = { x: -400, y: -600, width: 800, height: 600 };
  setPlacement = vi.fn();
  onAnimationStarted = () => () => {};
  onAnimationFinished = () => () => {};
  onAnimationLooped = () => () => {};
  onUserData = () => () => {};
  onSignal = () => () => {};
  onAudio = () => () => {};
}

let player: FakePlayer;

vi.mock('./SSSurface.js', () => ({
  SSSurface: class {
    static initialize = (wasm?: string) => initialize(wasm);
    resize = vi.fn();
    destroy = vi.fn();
    createPlayer = () => player;
  },
}));

vi.mock('./SSOverlay.js', () => ({
  SSOverlay: {
    getOrCreate: () => ({
      surface: {},
      createPlayer: () => player,
      detach: vi.fn(),
    }),
  },
}));

// The wasm init is cached at module level, so every test gets a fresh module.
async function freshElement(): Promise<typeof import('./element.js')> {
  vi.resetModules();
  return import('./element.js');
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let tag = 0;
async function mount(attrs: Record<string, string>) {
  const { SSPlayerElement } = await freshElement();
  const name = `ss-player-test-${++tag}`;
  customElements.define(name, class extends SSPlayerElement {});
  const el = document.createElement(name) as InstanceType<typeof SSPlayerElement>;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  const errors: unknown[] = [];
  el.addEventListener('error', (e) => errors.push((e as CustomEvent).detail));
  document.body.append(el);
  await settle();
  return { el, errors };
}

describe('<ss-player>', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    player = new FakePlayer();
    initialize.mockReset().mockResolvedValue(undefined);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // jsdom has no ResizeObserver; the element only needs it to exist.
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    consoleError.mockRestore();
  });

  it('starts on the first animation the player reports, without fetching the pack again', async () => {
    const { errors } = await mount({ src: 'chara.ssab' });
    expect(player.load).toHaveBeenCalledWith('chara.ssab');
    expect(player.setAnimation).toHaveBeenCalledWith('idle');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('logs a pack that fails to load, as well as dispatching `error`', async () => {
    const failure = new Error('404');
    player.load.mockRejectedValue(failure);
    const { errors } = await mount({ src: 'missing.ssab' });
    expect(errors).toEqual([failure]);
    expect(consoleError).toHaveBeenCalledWith('[ss-player]', failure);
  });

  it('logs an animation name the pack does not have', async () => {
    const { errors } = await mount({ src: 'chara.ssab', animation: 'nope' });
    expect(errors).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('logs a bad `animation` attribute set after load', async () => {
    const { el, errors } = await mount({ src: 'chara.ssab' });
    el.setAttribute('animation', 'nope');
    expect(errors).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
    el.setAttribute('animation', 'run');
    expect(player.current).toBe('run');
  });

  it('reports a failed wasm init once, and rejects `ready`', async () => {
    const failure = new Error('wasm 404');
    initialize.mockRejectedValue(failure);
    const { el, errors } = await mount({ src: 'chara.ssab' });
    await expect(el.ready).rejects.toBe(failure);
    expect(errors).toEqual([failure]);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  describe('placement', () => {
    it('fits the authored canvas, contain and centre, without being asked', async () => {
      await mount({ src: 'chara.ssab' });
      expect(player.setPlacement).toHaveBeenLastCalledWith({
        fit: 'contain',
        align: 'center',
        frame: { x: -400, y: -600, width: 800, height: 600 },
      });
    });

    it('reads fit, align and the flips from its attributes, and follows them when they change', async () => {
      const { el } = await mount({ src: 'chara.ssab', fit: 'cover', align: 'bottom', 'flip-x': '' });
      expect(player.setPlacement).toHaveBeenLastCalledWith(expect.objectContaining({ fit: 'cover', align: 'bottom' }));
      expect(player.flipX).toBe(true);
      expect(player.flipY).toBe(false);

      el.setAttribute('align', 'top-left');
      el.removeAttribute('flip-x');
      el.setAttribute('flip-y', '');
      expect(player.setPlacement).toHaveBeenLastCalledWith(expect.objectContaining({ align: 'top-left' }));
      expect(player.flipX).toBe(false);
      expect(player.flipY).toBe(true);
    });

    it('keeps the box of the animation the pack loaded on when the animation changes', async () => {
      const { el } = await mount({ src: 'chara.ssab', animation: 'idle' });
      player.canvasRect = { x: -650, y: -600, width: 1300, height: 600 }; // another animation's canvas
      el.setAttribute('animation', 'run');
      el.setAttribute('fit', 'cover');
      expect(player.setPlacement).toHaveBeenLastCalledWith({
        fit: 'cover',
        align: 'center',
        frame: { x: -400, y: -600, width: 800, height: 600 },
      });
    });

    it('reports an unknown fit or align, naming what is accepted, and leaves the placement alone', async () => {
      const { el, errors } = await mount({ src: 'chara.ssab' });
      player.setPlacement.mockClear();
      el.setAttribute('fit', 'stretch');
      el.setAttribute('fit', 'contain');
      el.setAttribute('align', 'middle');
      expect(errors).toHaveLength(2);
      expect(String(errors[0])).toContain('contain, cover, none');
      expect(String(errors[1])).toContain('top-left');
      expect(player.setPlacement).toHaveBeenCalledTimes(1);
    });

    it('sizes itself by the authored canvas when the page gives it no size', async () => {
      const { el } = await mount({ src: 'chara.ssab' });
      const sizer = el.shadowRoot!.querySelector('svg')!;
      expect(sizer.getAttribute('width')).toBe('800');
      expect(sizer.getAttribute('height')).toBe('600');
    });
  });

  it.each([
    ['on the shared overlay', {}],
    ['standalone', { standalone: '' }],
  ])('plays again when it is taken out of the page and put back, %s', async (_mode, attrs) => {
    const { el, errors } = await mount({ src: 'chara.ssab', ...attrs });
    el.remove();
    expect(el.player).toBeNull();
    document.body.append(el);
    await settle();
    await expect(el.ready).resolves.toBeUndefined();
    expect(el.player).toBe(player);
    expect(player.load).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelectorAll('style')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('is not displayed while it carries the `hidden` attribute', async () => {
    const { el } = await mount({ src: 'chara.ssab', hidden: '' });
    const css = el.shadowRoot!.querySelector('style')!.textContent!;
    expect(css).toContain(':host([hidden]){display:none}');
  });

  it('sizes the drawing buffer from the canvas layout box, not the transformed bounding rect', async () => {
    const { el } = await mount({ src: 'chara.ssab', standalone: '' });
    const canvas = el.shadowRoot!.querySelector('canvas')!;
    Object.defineProperty(canvas, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 100, configurable: true });
    // A 45-degree rotation makes the bounding rect square.
    el.getBoundingClientRect = () => ({ width: 212, height: 212 }) as DOMRect;
    const surface = el.surface as unknown as { resize: ReturnType<typeof vi.fn> };
    surface.resize.mockClear();
    (el as unknown as { applyResize(): void }).applyResize();
    expect(surface.resize).toHaveBeenCalledWith(200, 100);
  });
});
