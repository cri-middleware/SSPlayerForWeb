import { afterEach, describe, it, expect, vi } from 'vitest';
import { Container, EventBoundary, FederatedEvent, FederatedMouseEvent, Ticker } from 'pixi.js';
// What an Application's init loads, for the accessible* properties.
import 'pixi.js/accessibility';
import type { SSLabelTable, SSPlayer } from '@spritestudio/ssplayer-pixi';
import { SSButton } from './SSButton.js';
import { SSUiStateDriver } from './uiState.js';

// The driver and the button against a stand-in for the player: a real Pixi
// Container that records the playback calls made on it, so the tests need no
// WASM. The pack has one animation, `button`, labelled after the states.

const LABELS: SSLabelTable = {
    labels: [
        { name: 'normal', frame: 0 },
        { name: 'hover', frame: 10 },
        { name: 'pressed', frame: 20 },
        { name: 'disabled', frame: 30 },
        { name: 'focused', frame: 40 },
    ],
    startFrame: 0,
    endFrame: 49,
};

class FakePlayer extends Container {
    names: readonly string[] = [];
    currentAnimation = '';
    loopCount = 1;
    calls: string[] = [];
    hit: { x: number; y: number; parts: ReadonlyArray<number | string> | undefined } | null = null;
    hitAnswer = -1;
    quads: Record<string, number[]> = {};
    canvas: { x: number; y: number; width: number; height: number } | null = { x: -50, y: -40, width: 100, height: 80 };
    rootAffine: Float32Array | null = null;
    internalPlayer = {
        getLabelTable: (name: string) => (this.names.includes(name) ? LABELS : null),
        getCanvasRect: () => this.canvas,
        getRootAffine: () => this.rootAffine,
    };

    load(): void {
        this.names = ['button'];
        this.currentAnimation = '';
    }
    getAnimationNames(): readonly string[] {
        return this.names;
    }
    setAnimation(name: string): void {
        this.currentAnimation = name;
    }
    setAnimationSection(start: number, end: number): void {
        this.calls.push(`section ${start}..${end}`);
    }
    play(): void {
        this.calls.push(`play loop ${this.loopCount}`);
    }
    stop(): void {
        this.calls.push('stop');
    }
    hitTestPart(x: number, y: number, parts?: ReadonlyArray<number | string>): number {
        this.hit = { x, y, parts };
        return this.hitAnswer;
    }
    getPartNames(): string[] {
        return Object.keys(this.quads);
    }
    getPartQuad(part: number | string, out?: Float32Array): Float32Array | null {
        const name = typeof part === 'number' ? Object.keys(this.quads)[part] : part;
        const q = this.quads[name];
        if (!q) return null;
        const o = out ?? new Float32Array(8);
        o.set(q);
        return o;
    }
}

function loaded(): FakePlayer {
    const p = new FakePlayer();
    p.load();
    return p;
}

const asPlayer = (p: FakePlayer) => p as unknown as SSPlayer;

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('SSUiStateDriver', () => {
    it('shows nothing before the player has a pack', () => {
        const p = new FakePlayer();
        new SSUiStateDriver(asPlayer(p)).show('hover');
        expect(p.calls).toEqual([]);
    });

    it('plays the section of the state shown, looping, and once per state', () => {
        const p = loaded();
        const driver = new SSUiStateDriver(asPlayer(p));
        driver.show('hover');
        driver.show('hover');
        expect(p.currentAnimation).toBe('button');
        expect(p.calls).toEqual(['section 10..19', 'play loop -1']);
        expect(driver.state).toBe('hover');
        driver.show('pressed');
        expect(p.calls.slice(2)).toEqual(['section 20..29', 'play loop -1']);
    });

    it('holds the first frame under reduced motion', () => {
        const p = loaded();
        new SSUiStateDriver(asPlayer(p)).show('disabled', true);
        expect(p.calls).toEqual(['section 30..39', 'stop']);
    });

    it('shows the state again once the player has loaded another pack', () => {
        const p = loaded();
        const driver = new SSUiStateDriver(asPlayer(p));
        driver.show('normal');
        p.load();
        driver.show('normal');
        expect(p.calls).toEqual(['section 0..9', 'play loop -1', 'section 0..9', 'play loop -1']);
    });

    it('reports an animation the pack lacks once, and shows nothing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const p = loaded();
        const driver = new SSUiStateDriver(asPlayer(p), { animation: 'nope' });
        driver.show('normal');
        driver.show('hover');
        expect(p.calls).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('"nope"');
    });

    it('reports a clip the pack lacks once, and plays the label', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const p = loaded();
        const driver = new SSUiStateDriver(asPlayer(p), { clips: { hover: { animation: 'glow' } } });
        driver.show('hover');
        driver.show('normal');
        driver.show('hover');
        expect(p.calls.slice(0, 2)).toEqual(['section 10..19', 'play loop -1']);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('animation "glow"');
    });
});

describe('SSButton', () => {
    const boundary = new EventBoundary();
    const mouse = () => new FederatedMouseEvent(boundary);
    // What Pixi's accessibility layer sends for focus and blur.
    const focus = () => new FederatedEvent(boundary);

    function button(options: ConstructorParameters<typeof SSButton>[0] = {}) {
        const p = loaded();
        const b = new SSButton({ player: asPlayer(p), ...options });
        return { p, b };
    }

    it('shows normal as it is made, and a pack loaded later on the next tick', () => {
        const { p, b } = button();
        expect(b.uiState).toBe('normal');
        expect(p.calls).toEqual(['section 0..9', 'play loop -1']);
        b.destroy();

        const later = new FakePlayer();
        const b2 = new SSButton({ player: asPlayer(later) });
        expect(later.calls).toEqual([]);
        later.load();
        Ticker.shared.update(Ticker.shared.lastTime + 16);
        expect(later.calls).toEqual(['section 0..9', 'play loop -1']);
        b2.destroy();
    });

    it('shows hover, pressed and back as the pointer moves and presses', () => {
        const { p, b } = button();
        b.emit('mouseover', mouse());
        expect(b.uiState).toBe('hover');
        b.emit('mousedown', mouse());
        expect(b.uiState).toBe('pressed');
        b.emit('mouseup', mouse());
        expect(b.uiState).toBe('hover');
        b.emit('mouseout', mouse());
        expect(b.uiState).toBe('normal');
        expect(p.calls.filter(c => c.startsWith('section'))).toEqual([
            'section 0..9', 'section 10..19', 'section 20..29', 'section 10..19', 'section 0..9',
        ]);
        b.destroy();
    });

    // The element Pixi's accessibility layer lays over the canvas for a button.
    function withElement(b: SSButton): HTMLButtonElement {
        const element = document.body.appendChild(document.createElement('button'));
        b._accessibleDiv = element as unknown as typeof b._accessibleDiv;
        return element;
    }

    it('tells keyboard focus from the pointer', () => {
        const { p, b } = button({ accessibleTitle: 'Start' });
        const element = withElement(b);
        element.focus();
        b.emit('mouseover', focus());
        expect(b.uiState).toBe('focused');
        expect(p.calls.slice(-2)).toEqual(['section 40..49', 'play loop -1']);
        b.emit('mouseover', mouse());
        expect(b.uiState).toBe('hover');
        // The pointer leaves while the focus stays.
        b.emit('mouseout', mouse());
        expect(b.uiState).toBe('focused');
        element.blur();
        b.emit('mouseout', focus());
        expect(b.uiState).toBe('normal');
        element.remove();
        b.destroy();
    });

    it('drops a focus whose element the accessibility layer took away without a blur', () => {
        const { p, b } = button({ accessibleTitle: 'Start' });
        const element = withElement(b);
        element.focus();
        b.emit('mouseover', focus());
        // What turning the layer off on a mouse move does: the element goes, and
        // no mouseout reaches the button.
        element.remove();
        b._accessibleDiv = null;
        Ticker.shared.update(Ticker.shared.lastTime + 16);
        expect(b.uiState).toBe('normal');
        expect(p.calls.slice(-2)).toEqual(['section 0..9', 'play loop -1']);
        b.destroy();
    });

    it('shows disabled while not enabled, and takes no pointer then', () => {
        const { p, b } = button();
        b.emit('mouseover', mouse());
        b.emit('mousedown', mouse());
        b.enabled = false;
        expect(b.uiState).toBe('disabled');
        expect(b.eventMode).toBe('auto');
        expect(p.calls.slice(-2)).toEqual(['section 30..39', 'play loop -1']);
        b.enabled = true;
        expect(b.uiState).toBe('normal');
        b.destroy();
    });

    it('keeps the keyboard focus across a disable, which hears no blur', () => {
        const { b } = button({ accessibleTitle: 'Start' });
        const element = withElement(b);
        element.focus();
        b.emit('mouseover', focus());
        b.enabled = false;
        b.enabled = true;
        expect(b.uiState).toBe('focused');
        element.blur();
        b.enabled = false;
        b.enabled = true;
        expect(b.uiState).toBe('normal');
        element.remove();
        b.destroy();
    });

    it('holds still under reduced motion, from the option or the platform', () => {
        const { p, b } = button({ reducedMotion: true });
        expect(p.calls).toEqual(['section 0..9', 'stop']);
        b.reducedMotion = false;
        expect(p.calls.slice(2)).toEqual(['section 0..9', 'play loop -1']);
        b.destroy();

        const query = { matches: true };
        vi.stubGlobal('matchMedia', vi.fn(() => query));
        const followed = button();
        expect(followed.p.calls).toEqual(['section 0..9', 'stop']);
        query.matches = false;
        Ticker.shared.update(Ticker.shared.lastTime + 16);
        expect(followed.p.calls.slice(2)).toEqual(['section 0..9', 'play loop -1']);
        followed.b.destroy();
    });

    it('takes a pointer on the whole canvas by default, flipped with the drawing', () => {
        const { p, b } = button();
        const area = b.hitArea!;
        expect(area.contains(-49, -39)).toBe(true);
        expect(area.contains(49, 39)).toBe(true);
        expect(area.contains(55, 0)).toBe(false);
        // Flipped with an offset: the canvas spans -40..60 across.
        p.rootAffine = new Float32Array([-1, 0, 0, 1, 10, 0]);
        expect(area.contains(55, 0)).toBe(true);
        expect(area.contains(-45, 0)).toBe(false);
        expect(p.hit).toBeNull();
        b.destroy();
    });

    it('asks the player about the parts named, in its own space', () => {
        const { p, b } = button({ hitParts: ['face'] });
        p.position.set(5, -5);
        p.hitAnswer = 3;
        expect(b.hitArea!.contains(15, 15)).toBe(true);
        expect(p.hit).toEqual({ x: 10, y: 20, parts: ['face'] });
        p.hitAnswer = -1;
        expect(b.hitArea!.contains(15, 15)).toBe(false);

        b.hitParts = null;
        b.hitOnArtwork = true;
        b.hitArea!.contains(0, 0);
        expect(p.hit!.parts).toBeUndefined();
        b.destroy();
    });

    it('gives the accessibility layer the box around what it takes pointers on', () => {
        const { p, b } = button();
        const area = b.hitArea as unknown as { x: number; y: number; width: number; height: number };
        expect([area.x, area.y, area.width, area.height]).toEqual([-50, -40, 100, 80]);
        p.quads = { face: [0, 0, 20, 0, 0, 10, 20, 10], hand: [30, 5, 40, 5, 30, 25, 40, 25] };
        b.hitParts = ['face', 'hand'];
        p.position.set(100, 0);
        expect([area.x, area.y, area.width, area.height]).toEqual([100, 0, 40, 25]);
        b.hitParts = ['nope'];
        expect([area.x, area.y, area.width, area.height]).toEqual([50, -40, 100, 80]);
        b.destroy();
    });

    it('is decoration unless it is given a label', () => {
        expect(button().b.accessible).toBe(false);
        const labelled = button({ accessibleTitle: 'Start' }).b;
        expect(labelled.accessible).toBe(true);
        expect(labelled.accessibleTitle).toBe('Start');
        expect(button({ accessibleHint: 'Start', accessible: false }).b.accessible).toBe(false);
    });

    it('stops following the ticker when destroyed, and leaves a player it was given', () => {
        const { p, b } = button();
        b.destroy();
        p.load();
        Ticker.shared.update(Ticker.shared.lastTime + 16);
        expect(p.calls).toEqual(['section 0..9', 'play loop -1']);
        expect(p.destroyed).toBe(false);
    });
});
