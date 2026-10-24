import { labelFrameOf, type SSLabelTable, type SSPlayer } from '@spritestudio/ssplayer-pixi';

/**
 * A state a SpriteStudio button shows. By default each plays from the label of
 * the same name in one animation, up to the frame before the next label.
 */
export type SSUiState = 'normal' | 'hover' | 'pressed' | 'disabled' | 'focused';

/**
 * The one state to show when several hold at once: `disabled` over `pressed`
 * over `hover` over `focused`, and `normal` when none does.
 */
export function uiStateOf(flags: { disabled?: boolean; pressed?: boolean; hovered?: boolean; focused?: boolean }): SSUiState {
    if (flags.disabled) return 'disabled';
    if (flags.pressed) return 'pressed';
    if (flags.hovered) return 'hover';
    if (flags.focused) return 'focused';
    return 'normal';
}

/** The state, then the states it falls back to when the animation has no label for it. */
const CHAINS: Readonly<Record<SSUiState, readonly SSUiState[]>> = {
    normal: ['normal'],
    hover: ['hover', 'normal'],
    pressed: ['pressed', 'hover', 'normal'],
    disabled: ['disabled', 'normal'],
    focused: ['focused', 'normal'],
};

/**
 * What a state plays instead of the label named after it: the section of
 * `animation` that starts at `label`.
 *
 * With only `animation`, the whole of it. With only `label`, that label in the
 * animation the states are read from. A section runs to the frame before the
 * next label, or to the end of the animation.
 */
export type SSUiClip = { animation: string; label?: string } | { animation?: string; label: string };

/** Per-state replacements for the labels named after the states. */
export type SSUiClips = Partial<Record<SSUiState, SSUiClip>>;

/** The label a calm loop plays from under reduced motion, in place of `normal`. */
export const REDUCED_MOTION_LABEL = 'reduced_motion';

/** A section a state plays, and whether to hold its first frame rather than play it. */
export interface SSUiSection {
    animation: string;
    startFrame: number;
    endFrame: number;
    hold: boolean;
}

/**
 * The section starting at `label` in `table`: to the frame before the next
 * label — any label, the state names or not — or to the end of the animation.
 * Null when the table has no `label`.
 */
export function labelSectionOf(table: SSLabelTable, label: string): { startFrame: number; endFrame: number } | null {
    const start = labelFrameOf(table, label);
    if (start === null) return null;
    for (const l of table.labels) {
        if (l.frame > start) return { startFrame: start, endFrame: l.frame - 1 };
    }
    return { startFrame: start, endFrame: table.endFrame };
}

/**
 * The section `state` plays in `animation`: the first of its chain that has a
 * clip in `clips` or a label of its own name, or else the whole animation.
 * Null when `tableOf` knows no `animation`.
 *
 * Under `reducedMotion` the section is held, except where it came from
 * `normal` and `animation` has a `reduced_motion` label: that label's section
 * plays instead.
 *
 * A clip that names an animation or a label the pack does not have is handed
 * to `onMissingClip`, and the state goes on as if it had none.
 */
export function resolveUiSection(
    state: SSUiState,
    options: {
        animation: string;
        tableOf: (animation: string) => SSLabelTable | null;
        clips?: SSUiClips;
        reducedMotion?: boolean;
        onMissingClip?: (state: SSUiState, clip: SSUiClip) => void;
    },
): SSUiSection | null {
    const { animation, tableOf, clips = {}, reducedMotion = false, onMissingClip } = options;
    const base = tableOf(animation);
    if (!base) return null;
    let name = animation;
    let range: { startFrame: number; endFrame: number } | null = null;
    let source: SSUiState | null = null;
    for (const s of CHAINS[state]) {
        const clip = clips[s];
        if (clip) {
            const clipName = clip.animation ?? animation;
            const table = clipName === animation ? base : tableOf(clipName);
            range = !table
                ? null
                : clip.label === undefined
                  ? { startFrame: table.startFrame, endFrame: table.endFrame }
                  : labelSectionOf(table, clip.label);
            if (range) {
                name = clipName;
                source = s;
                break;
            }
            onMissingClip?.(s, clip);
        }
        range = labelSectionOf(base, s);
        if (range) {
            source = s;
            break;
        }
    }
    range ??= { startFrame: base.startFrame, endFrame: base.endFrame };
    if (reducedMotion && source === 'normal') {
        const calm = labelSectionOf(base, REDUCED_MOTION_LABEL);
        if (calm) return { animation, ...calm, hold: false };
    }
    return { animation: name, ...range, hold: reducedMotion };
}

/**
 * Plays the section an {@link SSUiState} calls for on a `player` the host owns.
 *
 * {@link show} switches at once and plays the new section from its first
 * frame, looping; the section that was playing is dropped. Under reduced
 * motion it holds the section's first frame instead, stopped, so no event
 * fires — except that `normal` plays the `reduced_motion` label's section when
 * the animation has one.
 *
 * It takes the player's playback over: it selects animations, sets sections
 * and the loop count, and plays and stops.
 */
export class SSUiStateDriver {
    /**
     * The animation the states' labels are read from. When omitted, the one
     * the player has selected the first time a state is shown, or else the
     * pack's first.
     */
    public readonly animation: string | undefined;

    /** Per-state replacements for the labels named after the states. */
    public readonly clips: SSUiClips;

    private _base: string | null = null;
    private _names: readonly string[] | null = null;
    private _shown = '';
    private _state: SSUiState | null = null;
    private _reduced = false;
    private readonly _reported = new Set<string>();

    constructor(
        public readonly player: SSPlayer,
        options: { animation?: string; clips?: SSUiClips } = {},
    ) {
        this.animation = options.animation;
        this.clips = options.clips ?? {};
    }

    /** The state last shown, or null before one has been. */
    public get state(): SSUiState | null {
        return this._state;
    }

    /**
     * Shows `state` — or nothing before the player has a pack.
     *
     * Showing the state already shown, with the same `reducedMotion`, does
     * nothing while the player still plays the animation it was given, so it
     * can be called every frame. After the player loads another pack, it shows
     * the state again.
     */
    public show(state: SSUiState, reducedMotion: boolean = false): void {
        const player = this.player;
        const names = player.getAnimationNames();
        if (names.length === 0) return;
        if (
            state === this._state && reducedMotion === this._reduced
            && names === this._names && player.currentAnimation === this._shown
        ) return;
        this._state = state;
        this._reduced = reducedMotion;
        this._names = names;

        const base = this._base !== null && names.includes(this._base)
            ? this._base
            : (this.animation ?? (player.currentAnimation || names[0]));
        if (!names.includes(base)) {
            this.report(`animation|${base}`, `the states are read from animation "${base}", which the loaded pack does not have, so none is shown`);
            return;
        }
        this._base = base;

        const section = resolveUiSection(state, {
            animation: base,
            tableOf: name => player.internalPlayer.getLabelTable(name),
            clips: this.clips,
            reducedMotion,
            onMissingClip: (s, clip) => this.reportMissingClip(s, clip),
        });
        if (!section) return;
        player.setAnimation(section.animation);
        this._shown = section.animation;
        player.setAnimationSection(section.startFrame, section.endFrame);
        if (section.hold) {
            player.stop();
        } else {
            player.loopCount = -1;
            player.play();
        }
    }

    private reportMissingClip(state: SSUiState, clip: SSUiClip): void {
        const what = [
            clip.animation !== undefined ? `animation "${clip.animation}"` : null,
            clip.label !== undefined ? `label "${clip.label}"` : null,
        ].filter(Boolean).join(' with ');
        this.report(`${state}|${clip.animation}|${clip.label}`, `the clip for ${state} names ${what}, which the loaded pack does not have, so it plays as if it had none`);
    }

    private report(key: string, message: string): void {
        if (this._reported.has(key)) return;
        this._reported.add(key);
        console.warn(`[SSUiStateDriver] ${message}.`);
    }
}
