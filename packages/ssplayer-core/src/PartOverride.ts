/**
 * Blend operation applied by a part-colour override. The same four operations
 * the authored PartColor keyframe uses, so an override reads as "the PartColor
 * this part would have had". Values above `Sub` are rejected by the runtime
 * (unlike the keyframe path, which defensively clamps to Mix).
 */
export enum SSBlendOp {
    Mix = 0,
    Mul = 1,
    Add = 2,
    Sub = 3,
}

/**
 * Keyframe-vs-override precedence for the attributes that conflict with the
 * animation (colour and cell). Visibility has no priority mode: it is a plain
 * force-hide flag that always wins and is always cleared by a new setup.
 * Mirrors SS6's KindIgnoreAttribute.
 */
export enum SSOverridePriority {
    /**
     * SS6 NON: the keyframe reclaims the attribute on any frame the animation
     * drives it, so the override only shows on frames the animation leaves that
     * attribute alone. Cleared when a new animation is set up.
     */
    OverwriteOnNextKeyframe = 0,

    /**
     * SS6 NOW_ANIMATION: the override wins for the current animation and is
     * cleared when a new animation is set up. The usual choice.
     */
    HoldUntilNextAnimation = 1,

    /**
     * SS6 PERMANENT: the override wins and survives animation changes
     * (re-validated against the new part count within the same SSAB).
     */
    Permanent = 2,
}

// --- Host-side override store -------------------------------------------
//
// The runtime keeps its override table on the WASM context, and that context is
// discarded whenever a player is rebuilt — on a host's save/load, a scene
// change, or an SSAB swap. Hosts that must survive those (RPG Maker MZ's
// pictures, TyranoScript's save state) therefore keep their own list and
// re-apply it ONCE per rebuild. These helpers are that list's policy, kept here
// rather than in each host so the two cannot drift apart.
//
// This is NOT per-frame re-application: the runtime owns an override for the
// whole life of a context and must never be re-fed every frame.

/**
 * One override as a host stores it. Plain data (no class instances) so it
 * round-trips through a save file, and the part is kept as a NAME rather than an
 * index — names are what the author typed, and they stay meaningful across an
 * SSAB whose parts table changed.
 */
export type SSPartOverride =
    | { kind: 'color'; part: string; blendOp: SSBlendOp; rgba: number; priority: SSOverridePriority }
    | { kind: 'cell'; part: string; cellmap: string; cell: string; priority: SSOverridePriority }
    | { kind: 'visibility'; part: string; hide: boolean; cascade: boolean };

/**
 * The part of a player these helpers drive. Structural on purpose: both
 * {@link InternalPlayerBase} and every renderer facade satisfy it, so the store
 * stays engine-agnostic.
 */
export interface SSPartOverrideTarget {
    setPartColorOverride(part: number | string, rgba: number, blendOp: SSBlendOp, priority: SSOverridePriority): boolean;
    setPartCellOverride(part: number | string, cellmapName: string, cellName: string, priority: SSOverridePriority): boolean;
    setPartVisibilityOverride(part: number | string, hide: boolean, cascade: boolean): boolean;
}

/** A target that can also drop overrides — what {@link SSPartOverrideStore} drives. */
export interface SSPartOverrideOwner extends SSPartOverrideTarget {
    clearPartColorOverride(part: number | string): boolean;
    clearPartCellOverride(part: number | string): boolean;
    clearPartVisibilityOverride(part: number | string): boolean;
    clearAllPartOverrides(): boolean;
}

/**
 * Add `entry`, replacing any override of the same kind already set on that part —
 * setting a part's colour twice means the second call wins, exactly as it does
 * in the runtime.
 */
export function mergePartOverride(list: SSPartOverride[] | undefined, entry: SSPartOverride): SSPartOverride[] {
    const out = (list ?? []).filter(o => !(o.kind === entry.kind && o.part === entry.part));
    out.push(entry);
    return out;
}

/** Drop every override on `part`, or all of them when `part` is omitted. */
export function removePartOverrides(list: SSPartOverride[] | undefined, part?: string): SSPartOverride[] {
    if (!list || !part) return [];
    return list.filter(o => o.part !== part);
}

/**
 * What the stored list must look like after a new animation is set up: the
 * runtime discards every override except `Permanent` colour / cell ones, and
 * clears visibility unconditionally. Mirroring that here keeps a later restore
 * from resurrecting an override the runtime already discarded.
 */
export function prunePartOverridesForNewAnimation(list: SSPartOverride[] | undefined): SSPartOverride[] {
    if (!list) return [];
    return list.filter(o => o.kind !== 'visibility' && o.priority === SSOverridePriority.Permanent);
}

/**
 * Re-apply stored overrides to a freshly built player. Call once, after its
 * animation is set up — before that the part names cannot resolve. Entries the
 * player rejects are reported and skipped, so one stale part name cannot stop
 * the rest from being restored.
 */
export function applyPartOverrides(target: SSPartOverrideTarget, list: SSPartOverride[] | undefined): void {
    if (!list || list.length === 0) return;
    for (const o of list) {
        let applied = false;
        switch (o.kind) {
            case 'color':
                applied = target.setPartColorOverride(o.part, o.rgba, o.blendOp, o.priority);
                break;
            case 'cell':
                applied = target.setPartCellOverride(o.part, o.cellmap, o.cell, o.priority);
                break;
            case 'visibility':
                applied = target.setPartVisibilityOverride(o.part, o.hide, o.cascade);
                break;
        }
        if (!applied) {
            console.warn(
                `[ssplayer] part override skipped: part "${o.part}" is unknown in this animation, or the runtime rejected it.`,
                o,
            );
        }
    }
}

/**
 * Parse an author-entered colour into the runtime's packed `0xRRGGBBAA`. Hosts
 * whose authoring surface only carries text (RPG Maker MZ plugin commands,
 * TyranoScript tag attributes) need this; accepts `#RGB`, `#RRGGBB`,
 * `#RRGGBBAA` and the `0x`-prefixed / bare forms of the latter two, defaulting
 * alpha to opaque. Returns null when it cannot be parsed, so the caller can warn
 * instead of silently drawing the wrong colour.
 */
export function parsePartOverrideColor(raw: string): number | null {
    const hex = String(raw ?? '').trim().replace(/^#/, '').replace(/^0x/i, '');
    if (!/^[0-9a-f]+$/i.test(hex)) return null;
    let rgb: string;
    let alpha = 'ff';
    if (hex.length === 3) {
        rgb = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    } else if (hex.length === 6) {
        rgb = hex;
    } else if (hex.length === 8) {
        rgb = hex.slice(0, 6);
        alpha = hex.slice(6, 8);
    } else {
        return null;
    }
    return parseInt(rgb + alpha, 16) >>> 0;
}

/**
 * Where a host keeps its override list, and how to reach its live player.
 *
 * Both are host-shaped: RPG Maker MZ's list is a field on `Game_Picture` (which
 * the save system serialises) and its player may not be mounted yet;
 * TyranoScript's is a field on its registry entry that has to be mirrored into
 * `stat.f` after every change.
 */
export interface SSPartOverrideStoreAccess {
    /** The list as it stands. */
    read(): SSPartOverride[] | undefined;
    /** Replace the list. Hosts that mirror it into a save target do that here. */
    write(list: SSPartOverride[]): void;
    /** The live player, or null when none is mounted yet. */
    player(): SSPartOverrideOwner | null;
}

/**
 * Keeps the stored override list and the live runtime in step: both change
 * together, including when an animation change makes the runtime drop overrides.
 * Out of step, an override survives in a save but not on screen, or the reverse.
 * The methods here are named for the *intent* so the choice that actually
 * matters is explicit:
 *
 * - the author asked for a different animation → {@link pruneForNewAnimation},
 *   because the runtime discarded all but the Permanent overrides and the stored
 *   list must not resurrect them;
 * - something swapped the animation transiently, without the author asking (a
 *   lip-sync talk/idle swap) → {@link reapply}, because the author's overrides
 *   were collateral damage and should go straight back.
 *
 * The wrong one either resurrects overrides the runtime dropped or loses ones
 * the author set.
 */
export class SSPartOverrideStore {
    constructor(private readonly access: SSPartOverrideStoreAccess) {}

    /** The stored list (never null, so callers can serialise it directly). */
    public list(): SSPartOverride[] {
        return this.access.read() ?? [];
    }

    /**
     * Set one override: store it and apply it now. A player that is not mounted
     * yet is not an error — the stored copy is what a mount replays.
     */
    public set(entry: SSPartOverride): void {
        this.access.write(mergePartOverride(this.access.read(), entry));
        const player = this.access.player();
        if (player) applyPartOverrides(player, [entry]);
    }

    /** Drop the overrides on `part`, or all of them when `part` is omitted. */
    public clear(part?: string): void {
        this.access.write(removePartOverrides(this.access.read(), part || undefined));
        const player = this.access.player();
        if (!player) return;
        if (part) {
            player.clearPartColorOverride(part);
            player.clearPartCellOverride(part);
            player.clearPartVisibilityOverride(part);
        } else {
            player.clearAllPartOverrides();
        }
    }

    /**
     * Bring the stored list in line with what the runtime keeps across an
     * animation setup the author asked for. The runtime has already done its
     * half; this stops a later restore from resurrecting the rest.
     */
    public pruneForNewAnimation(): void {
        const list = this.access.read();
        if (!list || list.length === 0) return;
        this.access.write(prunePartOverridesForNewAnimation(list));
    }

    /**
     * Put the whole stored list back onto the player — after a rebuild (a fresh
     * WASM context starts with an empty override table), or after an animation
     * swap the author never asked for. Call once the animation is set up: before
     * that, part names cannot resolve.
     */
    public reapply(): void {
        const player = this.access.player();
        if (player) applyPartOverrides(player, this.access.read());
    }
}
