import { ButtonContainer } from '@pixi/ui';
import { FederatedMouseEvent, Point, Rectangle, Ticker, UPDATE_PRIORITY, type ContainerOptions, type DestroyOptions, type FederatedEvent, type IHitArea } from 'pixi.js';
import { SSPlayer } from '@spritestudio/ssplayer-pixi';
import { SSUiStateDriver, uiStateOf, type SSUiClips, type SSUiState } from './uiState.js';

export interface SSButtonOptions extends ContainerOptions {
    /**
     * The player that draws the button. Omitted, the button makes one, which
     * it destroys with itself; load it through {@link SSButton.player}.
     */
    player?: SSPlayer;
    /** See {@link SSUiStateDriver.animation}. */
    animation?: string;
    /** See {@link SSUiStateDriver.clips}. */
    clips?: SSUiClips;
    /** See {@link SSButton.hitParts}. */
    hitParts?: ReadonlyArray<number | string> | null;
    /** See {@link SSButton.hitOnArtwork}. */
    hitOnArtwork?: boolean;
    /** See {@link SSButton.reducedMotion}. */
    reducedMotion?: boolean;
}

/**
 * A `ButtonContainer` from `@pixi/ui` whose look is a SpriteStudio animation:
 * one animation shows the button's states.
 *
 * A pointer over the button shows `hover`, a press `pressed`, keyboard focus
 * `focused`, and `enabled = false` `disabled` — one at a time, disabled over
 * pressed over hover over focused, and none of them `normal`. Each plays from
 * the label of its own name to the frame before the next label, looping, with
 * the fallbacks and the `clips` that {@link SSUiStateDriver} describes. The
 * signals (`onPress`, `onDown`, `onUp`, `onUpOut`, `onOut`, `onHover`) are
 * `ButtonContainer`'s own.
 *
 * ```ts
 * const button = new SSButton({ hitParts: ['face'], accessibleTitle: 'Start' });
 * await button.player.load('/ui/start.ssab');
 * button.position.set(640, 480);
 * button.onPress.connect(start);
 * app.stage.addChild(button);
 * ```
 *
 * It takes its player's playback over: the states select the animations and
 * sections and play or hold them. Move, scale and turn the button rather
 * than its player. Like the player, it needs `SSPlayer.initialize()` first.
 */
export class SSButton extends ButtonContainer {
    /** The player that draws the button, a child of it. */
    public readonly player: SSPlayer;

    /**
     * The parts a pointer counts on, by name or index, tested by their
     * outlines as drawn (`SSPlayer.hitTestPart`), so a pointer around an
     * irregular button's artwork misses it. Null leaves it the animation's
     * whole canvas, unless {@link hitOnArtwork} is set. Keyboard focus and a
     * screen reader reach the button however it is set.
     */
    public hitParts: ReadonlyArray<number | string> | null;

    /** With no {@link hitParts}, whether a pointer counts on any part the player draws rather than on the whole canvas. */
    public hitOnArtwork: boolean;

    private readonly _driver: SSUiStateDriver;
    private readonly _ownsPlayer: boolean;
    private _reducedMotion: boolean | undefined;
    private readonly _media: MediaQueryList | null;
    private _pressed = false;
    private _hovered = false;
    private readonly _point = new Point();
    private readonly _bounds = new Rectangle();
    private readonly _quad = new Float32Array(8);

    constructor(options: SSButtonOptions = {}) {
        const { player, animation, clips, hitParts, hitOnArtwork, reducedMotion, ...container } = options;
        super(undefined, container);
        this._ownsPlayer = !player;
        this.player = player ?? new SSPlayer();
        this.addChild(this.player);
        this.hitParts = hitParts ?? null;
        this.hitOnArtwork = hitOnArtwork ?? false;
        this._reducedMotion = reducedMotion;
        this._media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
        this._driver = new SSUiStateDriver(this.player, { animation, clips });
        if ((container.accessibleTitle || container.accessibleHint) && container.accessible === undefined) {
            this.accessible = true;
        }

        // Pixi's accessibility layer places the button's element by the hit
        // area's box, so the area carries one as well as `contains`.
        const button = this;
        const hitArea: IHitArea & { x: number; y: number; width: number; height: number } = {
            contains: (x, y) => this.hits(x, y),
            get x() { return button.hitBounds().x; },
            get y() { return button.hitBounds().y; },
            get width() { return button.hitBounds().width; },
            get height() { return button.hitBounds().height; },
        };
        this.hitArea = hitArea;

        this.onDown.connect(() => {
            this._pressed = true;
            this.refresh();
        });
        this.onUp.connect(() => {
            this._pressed = false;
            this.refresh();
        });
        // Not onHover / onOut: those share one flag between the pointer and
        // focus, which the accessibility layer sends as a plain FederatedEvent
        // where a pointer's is a FederatedMouseEvent.
        this.on('mouseover', this.over, this);
        this.on('mouseout', this.out, this);
        // Picks up a pack loaded into the player, the platform setting, and a
        // focus that went without a word (see hasFocus).
        Ticker.shared.add(this.refresh, this, UPDATE_PRIORITY.HIGH);
        this.refresh();
    }

    public override get enabled(): boolean {
        return super.enabled;
    }

    /** Whether the button takes pointers. False also shows `disabled`. */
    public override set enabled(value: boolean) {
        super.enabled = value;
        // A disabled button hears no pointer leave.
        this._hovered = false;
        this.refresh();
    }

    /**
     * Whether to hold still: each state holds the first frame of its section,
     * except where the animation has a `reduced_motion` label for `normal`.
     * Undefined follows the platform's `prefers-reduced-motion`.
     */
    public get reducedMotion(): boolean | undefined {
        return this._reducedMotion;
    }

    public set reducedMotion(value: boolean | undefined) {
        this._reducedMotion = value;
        this.refresh();
    }

    /** The state the button shows. */
    public get uiState(): SSUiState {
        return uiStateOf({ disabled: !this.enabled, pressed: this._pressed, hovered: this._hovered, focused: this.hasFocus() });
    }

    public override destroy(options?: DestroyOptions): void {
        Ticker.shared.remove(this.refresh, this);
        this.off('mouseover', this.over, this);
        this.off('mouseout', this.out, this);
        if (this._ownsPlayer && !this.player.destroyed) this.player.destroy();
        super.destroy(options);
    }

    private refresh(): void {
        this._driver.show(this.uiState, this._reducedMotion ?? this._media?.matches ?? false);
    }

    private over(e: FederatedEvent): void {
        if (e instanceof FederatedMouseEvent) this._hovered = true;
        this.refresh();
    }

    private out(e: FederatedEvent): void {
        if (e instanceof FederatedMouseEvent) this._hovered = false;
        this.refresh();
    }

    // Read from the page rather than kept from the focus events: a disabled
    // button hears none, and the accessibility layer can take its element
    // away, on a mouse move, without one.
    private hasFocus(): boolean {
        const element = this._accessibleDiv;
        return !!element && typeof document !== 'undefined' && document.activeElement === element;
    }

    private hits(x: number, y: number): boolean {
        const player = this.player;
        player.updateLocalTransform();
        const p = player.localTransform.applyInverse(this._point.set(x, y), this._point);
        if (this.hitParts || this.hitOnArtwork) return player.hitTestPart(p.x, p.y, this.hitParts ?? undefined) >= 0;
        const box = this.canvasBox();
        return box !== null && p.x >= box[0] && p.x < box[2] && p.y >= box[1] && p.y < box[3];
    }

    /** The animation's canvas in the player's space, flip and offset included, as `[l, t, r, b]`. */
    private canvasBox(): [number, number, number, number] | null {
        const ip = this.player.internalPlayer;
        const rect = ip.getCanvasRect();
        if (!rect) return null;
        const q = this._quad;
        q[0] = rect.x; q[1] = rect.y;
        q[2] = rect.x + rect.width; q[3] = rect.y;
        q[4] = rect.x; q[5] = rect.y + rect.height;
        q[6] = rect.x + rect.width; q[7] = rect.y + rect.height;
        const root = ip.getRootAffine();
        if (root) {
            for (let c = 0; c < 8; c += 2) {
                const x = q[c], y = q[c + 1];
                q[c] = root[0] * x + root[1] * y + root[4];
                q[c + 1] = root[2] * x + root[3] * y + root[5];
            }
        }
        return [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]), Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])];
    }

    /** The box around what {@link hits} answers for, in the button's space. */
    private hitBounds(): Rectangle {
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        if (this.hitParts || this.hitOnArtwork) {
            const player = this.player;
            const parts = this.hitParts ?? player.getPartNames().map((_, i) => i);
            for (const part of parts) {
                const q = player.getPartQuad(part, this._quad);
                if (!q) continue;
                for (let c = 0; c < 8; c += 2) {
                    if (q[c] < l) l = q[c];
                    if (q[c] > r) r = q[c];
                    if (q[c + 1] < t) t = q[c + 1];
                    if (q[c + 1] > b) b = q[c + 1];
                }
            }
        }
        if (!(l < r && t < b)) {
            const box = this.canvasBox();
            if (!box) return this._bounds.copyFrom(Rectangle.EMPTY);
            [l, t, r, b] = box;
        }
        // Into the button's space, through the player's own transform.
        const player = this.player;
        player.updateLocalTransform();
        const m = player.localTransform;
        const xs = [m.a * l + m.c * t, m.a * r + m.c * t, m.a * l + m.c * b, m.a * r + m.c * b];
        const ys = [m.b * l + m.d * t, m.b * r + m.d * t, m.b * l + m.d * b, m.b * r + m.d * b];
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        return this._bounds.set(x0 + m.tx, y0 + m.ty, Math.max(...xs) - x0, Math.max(...ys) - y0);
    }
}
