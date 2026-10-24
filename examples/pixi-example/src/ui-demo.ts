import { Application, Graphics, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import { SSButton, SSPlayer, resolvePlacement, type SSUiClips } from '@spritestudio/ssplayer-pixi-ui';

/**
 * SpriteStudio as @pixi/ui buttons, checked by eye.
 *
 * Ringo stands in for a button's artwork in two SSButtons: the left one takes
 * pointers on the parts picked in the panel, the right one on its whole
 * canvas. Each state plays one of Ringo's animations through a clip, since
 * Ringo has no labels named after the states. The outlines drawn are the ones
 * the hit test uses.
 *
 * What to look for:
 *   1. Left, "apple": the pointer turns into a hand only over the apple, and hover / press play only there.
 *   2. Right: hover anywhere in the dashed box plays walk, a press attack1, and the release walk again.
 *   3. Enabled off: both play dead and take no pointer; on again, both go back to wait1.
 *   4. Reduced motion on: each state stands still on its first frame; off, it moves again.
 *   5. Tab: the focused button plays jump_wait (not walk), Enter fires onPress, and Tab moves on.
 */

const CLIPS: SSUiClips = {
    normal: { animation: 'wait1' },
    hover: { animation: 'walk' },
    pressed: { animation: 'attack1' },
    disabled: { animation: 'dead' },
    focused: { animation: 'jump_wait' },
};

const HITS: Record<string, { hitParts: string[] | null; hitOnArtwork: boolean }> = {
    box: { hitParts: null, hitOnArtwork: false },
    any: { hitParts: null, hitOnArtwork: true },
    apple: { hitParts: ['apple'], hitOnArtwork: false },
    'head+body': { hitParts: ['head', 'body'], hitOnArtwork: false },
};

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hitSelect = document.getElementById('hit') as HTMLSelectElement;
const outlinesBox = document.getElementById('outlines') as HTMLInputElement;
const enabledBox = document.getElementById('enabled') as HTMLInputElement;
const motionSelect = document.getElementById('motion') as HTMLSelectElement;
const stateTable = document.getElementById('state') as HTMLTableElement;
const eventsEl = document.getElementById('events') as HTMLDivElement;

const recent: string[] = [];
function log(line: string): void {
    recent.unshift(line);
    recent.length = Math.min(recent.length, 10);
    eventsEl.textContent = recent.join('\n');
}

async function main(): Promise<void> {
    await SSPlayer.initialize();
    const app = new Application();
    await app.init({ canvas, width: canvas.width, height: canvas.height, backgroundColor: 0x1a1a2e, preference: 'webgpu' });

    const left = new SSButton({ clips: CLIPS, accessibleTitle: 'Left Ringo', ...HITS[hitSelect.value] });
    const right = new SSButton({ clips: CLIPS, accessibleTitle: 'Right Ringo' });
    const buttons = [
        { name: 'Left', button: left, cell: { x: 0, y: 0, width: 360, height: 480 } },
        { name: 'Right', button: right, cell: { x: 360, y: 0, width: 360, height: 480 } },
    ];
    for (const { name, button } of buttons) {
        button.player.attachRenderer(app.renderer);
        await button.player.load('Ringo/Ringo.ssab');
        button.onPress.connect(() => log(`${name}: onPress`));
        button.onDown.connect(() => log(`${name}: onDown`));
        button.onUp.connect(() => log(`${name}: onUp`));
        button.onUpOut.connect(() => log(`${name}: onUpOut`));
        app.stage.addChild(button);
    }

    // Each button fills its half by normal's canvas: the button is placed and
    // scaled, its player left alone. Once, as Ringo's animations each have a
    // canvas of their own, where a real button's states share one. The button
    // shows normal on the tick after the load, which is when its canvas is known.
    const unplaced = new Set(buttons);
    const place = () => {
        for (const entry of unplaced) {
            const box = entry.button.player.internalPlayer.getCanvasRect();
            if (!box) continue;
            const { button, cell } = entry;
            const fit = resolvePlacement(box, cell.width * 0.9, cell.height * 0.9);
            button.position.set(cell.x + fit.x + cell.width * 0.05, cell.y + fit.y + cell.height * 0.05);
            button.scale.set(fit.scale);
            unplaced.delete(entry);
        }
    };

    // The outlines, in the player's own space, read after the player has drawn the frame.
    const outlines = buttons.map(({ button }) => button.addChild(new Graphics()));
    const quad = new Float32Array(8);
    const drawOutlines = () => {
        buttons.forEach(({ button }, i) => {
            const g = outlines[i].clear();
            if (!outlinesBox.checked) return;
            const box = button.player.internalPlayer.getCanvasRect();
            if (box && !button.hitParts && !button.hitOnArtwork) {
                g.rect(box.x, box.y, box.width, box.height).stroke({ width: 2 / button.scale.x, color: 0x7ee787, alpha: 0.8 });
                return;
            }
            const parts = button.hitParts ?? button.player.getPartNames();
            for (const part of parts) {
                const q = button.player.getPartQuad(part, quad);
                if (!q) continue;
                g.poly([q[0], q[1], q[2], q[3], q[6], q[7], q[4], q[5]]).stroke({ width: 2 / button.scale.x, color: 0x7ee787, alpha: 0.8 });
            }
        });
        stateTable.innerHTML = buttons
            .map(({ name, button }) => `<tr><td>${name}</td><td><b>${button.uiState}</b> · ${button.player.currentAnimation}</td></tr>`)
            .join('');
    };
    Ticker.shared.add(() => {
        place();
        drawOutlines();
    }, undefined, UPDATE_PRIORITY.LOW);

    hitSelect.addEventListener('change', () => Object.assign(left, HITS[hitSelect.value]));
    enabledBox.addEventListener('change', () => {
        for (const { button } of buttons) button.enabled = enabledBox.checked;
    });
    motionSelect.addEventListener('change', () => {
        const value = motionSelect.value === 'os' ? undefined : motionSelect.value === 'on';
        for (const { button } of buttons) button.reducedMotion = value;
    });
}

main().catch((e) => log(`error: ${(e as Error).message}`));
