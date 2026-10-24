/**
 * Labels: the frames an animation names, read out of the pack.
 *
 * The runtime resolves an Instance part's labels internally and exports no
 * lookup, so a section named by labels is resolved here, against the label
 * table the `.ssab` carries for each animation.
 */
import type { AnimationData } from './ss/format/animation-data.js';
import { Label } from './ss/format/label.js';

/** A label of one animation: its name and the frame it marks. */
export interface SSLabel {
    readonly name: string;
    readonly frame: number;
}

/**
 * The labels of one animation in frame order, and the frame range it was
 * authored with — what a section named by labels resolves against.
 */
export interface SSLabelTable {
    /** In frame order. The pack keeps them sorted by name hash instead. */
    readonly labels: readonly SSLabel[];
    /** The animation's own first frame — never a section's. */
    readonly startFrame: number;
    /** The animation's own last frame — never a section's. */
    readonly endFrame: number;
}

/** The label table of `animation`, read out of the pack's bytes. */
export function labelTableOf(animation: AnimationData): SSLabelTable {
    const labels: SSLabel[] = [];
    const label = new Label();
    for (let i = 0; i < animation.labelsLength(); i++) {
        const l = animation.labels(i, label);
        const name = l?.name();
        if (l && name !== null && name !== undefined) labels.push({ name, frame: l.time() });
    }
    labels.sort((a, b) => a.frame - b.frame);
    return { labels, startFrame: animation.startFrame(), endFrame: animation.endFrame() };
}

/**
 * The frame `label` marks in `table`, or null when the animation has no such
 * label. Names match exactly.
 *
 * `_start` and `_end` are the animation's first and last frame, as they are in
 * SpriteStudio, where they are never in the label table; a real label of the
 * same name wins.
 */
export function labelFrameOf(table: SSLabelTable, label: string): number | null {
    for (const l of table.labels) {
        if (l.name === label) return l.frame;
    }
    if (label === '_start') return table.startFrame;
    if (label === '_end') return table.endFrame;
    return null;
}
