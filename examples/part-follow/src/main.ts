// Part-following demo — the Web counterpart of SSPlayerForGodot's
// SpriteStudioPartAttachment2D and SSPlayerForUnity's SpriteStudioPartTracker.
//
// A weapon (a plain Pixi Graphics — no extra asset) is attached to a character
// part with attachToPart(), so it tracks that part's position / rotation / scale
// every frame while the character moves. The player never creates the weapon:
// the host owns it and attachToPart just drives it.
//
// Two characters show the two sides of part following:
//   • ComiPo — every part is a normal image part, so any part tracks its art
//     cleanly. Good for reading the weapon-follows-hand behaviour.
//   • Ringo  — a rig with SKINNED (bone-bound) mesh parts (hands, legs, ears,
//     tail). A skinned part's own transform stays near the character root while
//     its art is drawn by bone skinning, so following one snaps the weapon to
//     the root rather than onto the visible mesh. The follow-target picker mirrors
//     the Unity / Godot inspectors: skinned parts are shown but disabled ("dimmed")
//     so they can't be picked by accident — yet a name typed by hand is still
//     accepted (and flagged with a non-blocking warning), exactly as those editors
//     allow a deliberate override.
//
// API used (all on the pixi SSPlayer; equivalents exist on the WebGL and RMMZ
// players, and getPartTransform / isPartHidden / isPartSkinnedMesh / onFrame on
// the core player):
//   attachToPart(part, target, { position, rotation, scale, onHide, addAsChild })
//   detachFromPart(target)   /   handle.detach()
//   getPartTransform(part, out?) -> [m00, m01, m10, m11, tx, ty] | null
//   getPartNames() -> string[]           // every part in the current animation
//   isPartSkinnedMesh(part) -> boolean | null   // true for a bone-bound mesh part
//   onFrame(cb)   // fires each advanced frame, after world matrices are final

import { Application, Container, Graphics } from 'pixi.js';
import { SSPlayer, type SSPartAttachment } from '@spritestudio/ssplayer-pixi';

/**
 * Fixed rotation of the blade relative to the part. The attachment drives the
 * holder each frame (overwriting its transform), so this offset lives on the
 * inner Graphics instead. Pixi is Y-down, so a negative angle rotates
 * counter-clockwise on screen: -90°.
 */
const SWORD_ANGLE_OFFSET = -Math.PI / 2;

interface Motion {
    /** Animation name inside the .ssab. */
    anim: string;
    /**
     * .ssab basename for this motion. ComiPo ships one .ssab per motion; Ringo is
     * a single .ssab holding every animation, so its motions omit this and fall
     * back to the character's own `file`.
     */
    file?: string;
}

interface CharacterDef {
    key: string;
    /** Label for the character-switch button. */
    label: string;
    /** public/ subfolder holding the assets. */
    dir: string;
    /** Single .ssab basename, when every motion shares one file (Ringo). */
    file?: string;
    motions: readonly Motion[];
    scale: number;
    x: number;
    y: number;
    /** Part the weapon follows by default — a normal (non-skinned) part. */
    defaultPart: string;
}

const CHARACTERS: readonly CharacterDef[] = [
    {
        // Each motion is its own .ssab (ssconverter emits one per .ssae), all
        // sharing the same rig, so a followed part name survives a motion swap.
        key: 'Comipo',
        label: 'ComiPo (no skinned parts)',
        dir: 'Comipo',
        motions: [
            { anim: 'Dash', file: 'Dash' },
            { anim: 'Run', file: 'Run' },
            { anim: 'Attack', file: 'Attack' },
            { anim: 'Walk', file: 'Walk' },
            { anim: 'Jump', file: 'Jump' },
            { anim: 'Stand', file: 'Stand' },
        ],
        scale: 0.62,
        x: 640,
        y: 900,
        defaultPart: 'FrontHand',
    },
    {
        // One .ssab, many animations. hand_r / hand_l / legs / ears / tail are
        // skinned mesh parts — the picker dims them. hand_r2 is the visible right
        // paw as a normal part, a good default target sitting near the hand.
        key: 'Ringo',
        label: 'Ringo (has skinned parts)',
        dir: 'Ringo',
        file: 'Ringo',
        motions: [
            { anim: 'wait1' },
            { anim: 'run' },
            { anim: 'attack1' },
            { anim: 'dance' },
            { anim: 'walk' },
            { anim: 'jump' },
        ],
        scale: 1.0,
        x: 640,
        y: 720,
        defaultPart: 'hand_r2',
    },
] as const;

const stepEl = document.getElementById('step') as HTMLDivElement;
const callEl = document.getElementById('call') as HTMLDivElement;
const controlsEl = document.getElementById('controls') as HTMLDivElement;
const selectEl = document.getElementById('part-select') as HTMLSelectElement;
const inputEl = document.getElementById('part-input') as HTMLInputElement;
const warnEl = document.getElementById('warn') as HTMLDivElement;

/** Demo state, reflected in the status readout and re-applied on any change. */
const state = {
    char: 0,               // index into CHARACTERS
    motion: 0,             // index into the current character's motions
    followPart: CHARACTERS[0].defaultPart,
    attached: true,
    driveScale: true,      // follow the part's scale too (else position + rotation only)
    onHide: 'follow' as 'follow' | 'hide',
};

const character = () => CHARACTERS[state.char];
const motion = () => character().motions[state.motion];
const fileFor = (c: CharacterDef, m: Motion) => m.file ?? c.file!;

/**
 * Build the weapon: a little sword whose grip sits at the origin (0, 0) — the
 * point attachToPart pins to the part. The blade is drawn extending up (−Y) from
 * the grip; the outer holder is what the attachment drives, and the inner
 * Graphics carries {@link SWORD_ANGLE_OFFSET} so the blade is rotated relative to
 * the part (the attachment overwrites the holder's transform every frame, so the
 * offset can't live there).
 */
function makeWeapon(): Container {
    const g = new Graphics();
    g.rect(-6, -150, 12, 138).fill(0xdfe7f2);            // blade
    g.moveTo(0, -150).lineTo(-6, -138).lineTo(6, -138).fill(0xf2f6ff); // tip
    g.rect(-30, -20, 60, 13).fill(0xffcf47);             // crossguard
    g.rect(-7, -7, 14, 38).fill(0x8a5a2b);               // grip (origin at its top)
    g.circle(0, 31, 8).fill(0xffcf47);                   // pommel
    g.rotation = SWORD_ANGLE_OFFSET;                     // 90° CCW around the grip

    const holder = new Container();
    holder.addChild(g);
    return holder;
}

function ssabUrl(dir: string, file: string): string {
    // Assets live under public/<dir>/. Resolve against the page so it works at
    // the dev root and any deploy subpath.
    return new URL(`${dir}/${file}.ssab`, document.baseURI).href;
}

async function main() {
    await SSPlayer.initialize();

    const app = new Application();
    await app.init({ width: 1280, height: 960, backgroundColor: 0x12233b, preference: 'webgpu' });
    const container = document.getElementById('canvas-container');
    if (container) container.insertBefore(app.canvas, container.firstChild);
    else document.body.appendChild(app.canvas);

    const player = new SSPlayer();
    app.stage.addChild(player);

    const sword = makeWeapon();
    let attachment: SSPartAttachment | null = null;

    /** Load the current (character, motion) and place the player. */
    async function loadCurrent() {
        const c = character();
        await player.load(ssabUrl(c.dir, fileFor(c, motion())));
        await player.setAnimation(motion().anim);
        player.scale.set(c.scale);
        player.position.set(c.x, c.y);
        player.play();
    }

    /** (Re)build the attachment from the current state. */
    function applyAttachment() {
        if (attachment) { attachment.detach(); attachment = null; }
        if (state.attached) {
            attachment = player.attachToPart(state.followPart, sword, {
                position: true,
                rotation: true,
                scale: state.driveScale,
                onHide: state.onHide,
                // addAsChild (default) parents the sword under the player, so it
                // inherits the player's own transform and lands exactly on the part.
            });
        } else if (!sword.parent) {
            // Detached: keep the sword on screen (frozen) where it last was.
            app.stage.addChild(sword);
        }
        updateStatus();
    }

    /**
     * Rebuild the follow-target dropdown from the parts of the current animation.
     * Skinned mesh parts are listed but disabled — the same soft filter the Unity
     * and Godot inspectors apply, so they can't be chosen by accident. The text
     * box beside it still accepts any name (including a skinned one), matching
     * those editors' "type it to override" escape hatch.
     */
    function rebuildPicker() {
        selectEl.textContent = '';
        for (const name of player.getPartNames()) {
            if (!name) continue;
            const opt = document.createElement('option');
            opt.value = name;
            const skinned = player.isPartSkinnedMesh(name) === true;
            opt.disabled = skinned;
            opt.textContent = skinned ? `${name}  (skinned mesh — poor target)` : name;
            selectEl.appendChild(opt);
        }
        // Reflect the current target; a hand-typed skinned target won't match any
        // enabled option, so the <select> simply shows no selection for it.
        selectEl.value = state.followPart;
        inputEl.value = state.followPart;
    }

    function updateStatus() {
        const c = character();
        const known = player.findPartIndex(state.followPart) >= 0;
        const skinned = player.isPartSkinnedMesh(state.followPart) === true;

        stepEl.textContent = state.attached
            ? `Sword follows "${state.followPart}" — ${c.key} / "${motion().anim}"`
            : `Detached — sword frozen (${c.key} / "${motion().anim}")`;

        const axes = state.driveScale ? 'position + rotation + scale' : 'position + rotation';
        callEl.textContent = state.attached
            ? `player.attachToPart('${state.followPart}', sword, {\n  scale: ${state.driveScale}, onHide: '${state.onHide}'\n})   // drives ${axes}`
            : `attachment.detach()`;

        // Non-blocking warning, mirroring Godot's configuration warning and
        // Unity's "(skinned mesh)" annotation on a stored value.
        if (!known) {
            warnEl.textContent = `⚠ "${state.followPart}" is not a part of this animation — the sword is hidden until it is.`;
            warnEl.hidden = false;
        } else if (skinned) {
            warnEl.textContent = `⚠ "${state.followPart}" is a skinned (bone-bound) mesh. Its transform stays near the character root, so the sword won't sit on the visible art. Follow a NULL / bone / joint part at that spot instead.`;
            warnEl.hidden = false;
        } else {
            warnEl.hidden = true;
        }
    }

    /** Point the sword at a new part (from the dropdown or the text box). */
    function setFollowPart(name: string) {
        state.followPart = name;
        applyAttachment();
        selectEl.value = name;
        inputEl.value = name;
    }

    selectEl.addEventListener('change', () => setFollowPart(selectEl.value));
    inputEl.addEventListener('change', () => setFollowPart(inputEl.value.trim()));

    // --- Controls (rebuilt on character switch, since motions differ) ---
    let buttons: { el: HTMLButtonElement; isActive?: () => boolean }[] = [];
    function button(label: string, onClick: () => void, isActive?: () => boolean) {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', () => { onClick(); refreshButtons(); });
        controlsEl.appendChild(b);
        buttons.push({ el: b, isActive });
    }
    function refreshButtons() {
        for (const b of buttons) if (b.isActive) b.el.classList.toggle('active', b.isActive());
        updateStatus();
    }

    let switching = false;
    async function switchTo(charIdx: number, motionIdx: number) {
        if (switching) return;
        switching = true;
        try {
            const charChanged = charIdx !== state.char;
            state.char = charIdx;
            state.motion = motionIdx;
            if (charChanged) state.followPart = character().defaultPart;
            await loadCurrent();
            rebuildPicker();
            applyAttachment(); // re-parent the sword under the reloaded player
            if (charChanged) buildControls();
        } finally {
            switching = false;
            refreshButtons();
        }
    }

    function buildControls() {
        controlsEl.textContent = '';
        buttons = [];
        // Character row.
        CHARACTERS.forEach((c, i) =>
            button(c.label, () => { void switchTo(i, 0); }, () => state.char === i));
        // Follow options.
        button('Attach / Detach', () => { state.attached = !state.attached; applyAttachment(); }, () => state.attached);
        button('Scale follow', () => { state.driveScale = !state.driveScale; applyAttachment(); }, () => state.driveScale);
        button('onHide: hide', () => { state.onHide = state.onHide === 'follow' ? 'hide' : 'follow'; applyAttachment(); }, () => state.onHide === 'hide');
        // Motion row for the current character.
        character().motions.forEach((m, i) =>
            button(m.anim, () => { void switchTo(state.char, i); }, () => state.motion === i));
    }

    // Demonstrate the pull API too: read the followed part's transform each frame.
    player.onFrame(() => {
        const t = player.getPartTransform(state.followPart);
        if (t) console.debug(`[part-follow] ${state.followPart} @ (${t[4].toFixed(1)}, ${t[5].toFixed(1)})`);
    });

    // Initial load.
    await loadCurrent();
    rebuildPicker();
    applyAttachment();
    buildControls();
    refreshButtons();
}

main().catch((e) => {
    stepEl.textContent = 'Failed to start — see console.';
    callEl.textContent = String(e);
    console.error(e);
});
