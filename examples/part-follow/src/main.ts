// Part-following demo.
//
// A fish (a plain Pixi Graphics — no extra asset) is attached to a part of the
// "Ringo" character with attachToPart(), so it tracks that part's position /
// rotation / scale every frame while the character moves. The player never
// creates the fish: the host owns it and attachToPart just drives it.
//
// Ringo is a rig with SKINNED (bone-bound) mesh parts — its hands, legs, ears
// and tail. A skinned part's own transform stays near the character root while
// its art is drawn by bone skinning, so following one snaps the fish to the root
// rather than onto the visible mesh. In the follow-target picker, skinned parts
// are shown but disabled ("dimmed") so they can't be picked by accident — yet a
// name typed by hand is still accepted (and flagged with a non-blocking warning)
// as a deliberate override. The default target, `bone_14`, is a bone in the
// right-hand chain — a bone / joint part is the recommended kind of follow target.
//
// API used (all on the pixi SSPlayer; the RMMZ player has the same, and the core
// player has getPartTransform / isPartHidden / isPartSkinnedMesh / onFrame):
//   attachToPart(part, target, { position, rotation, scale, onHide, addAsChild })
//   detachFromPart(target)   /   handle.detach()
//   getPartTransform(part, out?) -> [m00, m01, m10, m11, tx, ty] | null
//   getPartNames() -> string[]                  // every part in the current animation
//   isPartSkinnedMesh(part) -> boolean | null   // true for a bone-bound mesh part
//   onFrame(cb)   // fires each advanced frame, after world matrices are final

import { Application, Container, Graphics } from 'pixi.js';
import { SSPlayer, type SSPartAttachment } from '@spritestudio/ssplayer-pixi';

/** Ringo assets and how the demo places the character. */
const RINGO = {
    dir: 'Ringo',
    file: 'Ringo',      // one .ssab holding every animation
    scale: 1.0,
    x: 640,
    y: 720,
    // hand_r / hand_l / legs / ears / tail are skinned mesh parts (the picker
    // dims them). bone_14 is a bone in the right-hand chain — a bone / joint is
    // the recommended kind of follow target (its node moves with the art).
    defaultPart: 'bone_14',
} as const;

/** Animations inside Ringo.ssab, offered as motion buttons. */
const MOTIONS = ['wait1', 'run', 'attack1', 'dance', 'walk', 'jump'] as const;

/**
 * Clockwise rotation of the fish relative to the part it follows. The attachment
 * overwrites the holder's transform each frame, so this offset lives on the inner
 * Graphics instead. Pixi is Y-down, so a positive angle is clockwise: +90°.
 */
const FISH_ANGLE_OFFSET = Math.PI / 2;

const stepEl = document.getElementById('step') as HTMLDivElement;
const callEl = document.getElementById('call') as HTMLDivElement;
const controlsEl = document.getElementById('controls') as HTMLDivElement;
const selectEl = document.getElementById('part-select') as HTMLSelectElement;
const inputEl = document.getElementById('part-input') as HTMLInputElement;
const warnEl = document.getElementById('warn') as HTMLDivElement;

/** Demo state, reflected in the status readout and re-applied on any change. */
const state = {
    motion: 0,             // index into MOTIONS
    followPart: RINGO.defaultPart as string,
    attached: true,
    driveScale: true,      // follow the part's scale too (else position + rotation only)
    onHide: 'follow' as 'follow' | 'hide',
};

/**
 * Build the fish: a plain little fish whose body centre sits at the origin
 * (0, 0) — the point attachToPart pins to the part. The outer holder is what the
 * attachment drives; the inner Graphics carries the artwork, so the attachment
 * can overwrite the holder's transform every frame without disturbing the fish's
 * own shape.
 */
function makeFish(): Container {
    const g = new Graphics();
    g.moveTo(-46, 0).lineTo(-84, -26).lineTo(-84, 26).fill(0xff8a3d);   // tail
    g.ellipse(0, 0, 54, 32).fill(0xffab5c);                             // body
    g.ellipse(4, 7, 34, 15).fill(0xffd6a1);                            // belly
    g.moveTo(2, -28).lineTo(22, -46).lineTo(30, -24).fill(0xff8a3d);   // dorsal fin
    g.circle(32, -8, 7).fill(0xffffff);                                // eye white
    g.circle(34, -8, 3.4).fill(0x2b2b2b);                             // pupil
    g.rotation = FISH_ANGLE_OFFSET;                                    // 90° CW around the anchor

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
    await player.load(ssabUrl(RINGO.dir, RINGO.file));
    await player.setAnimation(MOTIONS[state.motion]);
    player.scale.set(RINGO.scale);
    player.position.set(RINGO.x, RINGO.y);
    app.stage.addChild(player);
    player.play();

    const fish = makeFish();
    let attachment: SSPartAttachment | null = null;

    /** (Re)build the attachment from the current state. */
    function applyAttachment() {
        if (attachment) { attachment.detach(); attachment = null; }
        if (state.attached) {
            attachment = player.attachToPart(state.followPart, fish, {
                position: true,
                rotation: true,
                scale: state.driveScale,
                onHide: state.onHide,
                // addAsChild (default) parents the fish under the player, so it
                // inherits the player's own transform and lands exactly on the part.
            });
        } else if (!fish.parent) {
            // Detached: keep the fish on screen (frozen) where it last was.
            app.stage.addChild(fish);
        }
        updateStatus();
    }

    /**
     * Rebuild the follow-target dropdown from the parts of the current animation.
     * Skinned mesh parts are listed but disabled, so they can't be chosen by
     * accident. The text box beside it still accepts any name (including a skinned one).
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
        const known = player.findPartIndex(state.followPart) >= 0;
        const skinned = player.isPartSkinnedMesh(state.followPart) === true;

        stepEl.textContent = state.attached
            ? `Fish follows "${state.followPart}" — Ringo / "${MOTIONS[state.motion]}"`
            : `Detached — fish frozen (Ringo / "${MOTIONS[state.motion]}")`;

        const axes = state.driveScale ? 'position + rotation + scale' : 'position + rotation';
        callEl.textContent = state.attached
            ? `player.attachToPart('${state.followPart}', fish, {\n  scale: ${state.driveScale}, onHide: '${state.onHide}'\n})   // drives ${axes}`
            : `attachment.detach()`;

        if (!known) {
            warnEl.textContent = `⚠ "${state.followPart}" is not a part of this animation — the fish is hidden until it is.`;
            warnEl.hidden = false;
        } else if (skinned) {
            warnEl.textContent = `⚠ "${state.followPart}" is a skinned (bone-bound) mesh. Its transform stays near the character root, so the fish won't sit on the visible art. Follow a NULL / bone / joint part at that spot instead.`;
            warnEl.hidden = false;
        } else {
            warnEl.hidden = true;
        }
    }

    /** Point the fish at a new part (from the dropdown or the text box). */
    function setFollowPart(name: string) {
        state.followPart = name;
        applyAttachment();
        selectEl.value = name;
        inputEl.value = name;
    }

    selectEl.addEventListener('change', () => setFollowPart(selectEl.value));
    inputEl.addEventListener('change', () => setFollowPart(inputEl.value.trim()));

    // --- Controls ---
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
    async function setMotion(i: number) {
        if (switching) return;
        switching = true;
        try {
            state.motion = i;
            await player.setAnimation(MOTIONS[i]);
            player.play();
            applyAttachment(); // re-resolve the part and keep following after the swap
        } finally {
            switching = false;
            refreshButtons();
        }
    }

    button('Attach / Detach', () => { state.attached = !state.attached; applyAttachment(); }, () => state.attached);
    button('Scale follow', () => { state.driveScale = !state.driveScale; applyAttachment(); }, () => state.driveScale);
    button('onHide: hide', () => { state.onHide = state.onHide === 'follow' ? 'hide' : 'follow'; applyAttachment(); }, () => state.onHide === 'hide');
    MOTIONS.forEach((m, i) => button(m, () => { void setMotion(i); }, () => state.motion === i));

    // Demonstrate the pull API too: read the followed part's transform each frame.
    player.onFrame(() => {
        const t = player.getPartTransform(state.followPart);
        if (t) console.debug(`[part-follow] ${state.followPart} @ (${t[4].toFixed(1)}, ${t[5].toFixed(1)})`);
    });

    rebuildPicker();
    applyAttachment();
    refreshButtons();
}

main().catch((e) => {
    stepEl.textContent = 'Failed to start — see console.';
    callEl.textContent = String(e);
    console.error(e);
});
