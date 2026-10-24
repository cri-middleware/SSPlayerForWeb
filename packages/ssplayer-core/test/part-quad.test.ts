import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { initializeWasm } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { partQuadContains } from '../src/PartQuad.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// A part's outline as drawn, and the hit test built on it. The geometry of the
// quad is tested on its own; the read against the SDK's Ringo, whose `apple`
// is a plain cell part, `head` a mesh and `root` a Null part, and the overall
// project's Shape. The strongest check is that what the renderer builds for
// every part lies inside the outline reported for it.

describe('partQuadContains', () => {
    // A 20x20 square turned 45°, centred on the origin: lt, rt, lb, rb.
    const diamond = [0, -14.14, 14.14, 0, -14.14, 0, 0, 14.14];

    it('follows the turned outline, not its bounds', () => {
        expect(partQuadContains(diamond, 0, 0)).toBe(true);
        expect(partQuadContains(diamond, 6, 6)).toBe(true);
        expect(partQuadContains(diamond, 10, 10)).toBe(false);
    });

    it('answers a quad folded over itself by the even-odd rule', () => {
        // The right corners swapped: a bow tie crossing at x = 5.
        const bowTie = [0, 0, 10, 10, 0, 10, 10, 0];
        expect(partQuadContains(bowTie, 1, 5)).toBe(true);
        expect(partQuadContains(bowTie, 5, 1)).toBe(false);
    });
});

const RINGO = sdkProject('Ringo');
const OVERALL = sdkProject('overall');

type Box = [number, number, number, number];

function boundsOf(xy: ArrayLike<number>, count = xy.length / 2): Box {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (let i = 0; i < count; i++) {
        const x = xy[i * 2], y = xy[i * 2 + 1];
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
    }
    return [l, t, r, b];
}

/** The positions the renderer builds for `part` on the frame drawn, in the player's space. */
function builtPositions(player: DirectInternalPlayer, part: number): Float32Array {
    const rm = player.runtimeManager;
    const frameData = rm.getFrameData(player.getDrawFrame())!;
    const gb = player.geometryBuilder;
    gb.parentMatrix = player.getRootAffine();
    gb.updateWorldPositions();
    const scratch = (n: number) => new Float32Array(n);
    const meshAt = rm.getMeshVertexOffsets();
    const shapeVerts = rm.getShapeVertexCounts()[part] ?? 0;
    if (meshAt[part + 1] > meshAt[part]) {
        const n = meshAt[part + 1] - meshAt[part];
        const iAt = rm.getMeshIndexOffsets();
        const ni = iAt[part + 1] - iAt[part];
        const out = scratch(n * 2);
        gb.buildMesh(part, frameData, n, ni, 1, 1, out, scratch(n * 2), scratch(n * 4), scratch(n * 4), new Uint32Array(ni));
        return out;
    }
    if (shapeVerts > 0) {
        const out = scratch(shapeVerts * 2);
        gb.buildShape(part, frameData, shapeVerts, 1, 1, out, scratch(shapeVerts * 2), scratch(shapeVerts * 4), scratch(shapeVerts * 4), new Uint32Array(shapeVerts * 3));
        return out;
    }
    const out = scratch(10);
    gb.buildNormal(part, frameData, 1, 1, out, scratch(10), scratch(20), scratch(20));
    return out.subarray(0, 8);
}

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(RINGO) || !existsSync(OVERALL))(
    'getPartQuad and hitTestPart',
    () => {
        async function ringo(): Promise<DirectInternalPlayer> {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const player = new DirectInternalPlayer(textures);
            player.setCoordinateSystem(1);
            player.bindResource((await convert(RINGO)).get('Ringo.ssab')!);
            await player.prepareResources();
            player.setAnimation('attack1');
            player.play();
            player.update(16);
            player.evaluateDrawFrame();
            return player;
        }

        it('reports a cell part as the corners the renderer draws, flip and offset included', async () => {
            const player = await ringo();
            player.flipX = true;
            player.offsetX = 7;
            player.offsetY = -3;
            player.evaluateDrawFrame();
            const apple = player.findPartIndex('apple');
            const quad = player.getPartQuad('apple')!;
            const drawn = builtPositions(player, apple);
            for (let i = 0; i < 8; i++) expect(quad[i]).toBeCloseTo(drawn[i], 3);
            // Flipped, the cell's left edge is drawn on the right.
            expect(quad[0]).toBeGreaterThan(quad[2]);
            const out = new Float32Array(8);
            expect(player.getPartQuad(apple, out)).toBe(out);
            expect(Array.from(out)).toEqual(Array.from(quad));
            player.destroy();
        }, 60_000);

        it('reports a mesh part as the box around its vertices', async () => {
            const player = await ringo();
            const head = player.findPartIndex('head');
            const meshAt = player.runtimeManager.getMeshVertexOffsets();
            expect(meshAt[head + 1]).toBeGreaterThan(meshAt[head]);
            expect(boundsOf(player.getPartQuad(head)!)).toEqual(boundsOf(builtPositions(player, head)));
            player.destroy();
        }, 60_000);

        it('has no outline for a hidden, a Null or an unknown part', async () => {
            const player = await ringo();
            expect(player.isPartHidden('leg_r_1')).toBe(true);
            expect(player.getPartQuad('leg_r_1')).toBeNull();
            expect(player.getPartQuad('root')).toBeNull();
            expect(player.getPartQuad('nope')).toBeNull();
            expect(player.getPartQuad(-1)).toBeNull();
            expect(player.getPartQuad(9999)).toBeNull();
            player.destroy();
        }, 60_000);

        it('holds everything the renderer builds, on every part and frame', async () => {
            const player = await ringo();
            player.flipY = true;
            player.offsetX = 12;
            const names = player.getPartNames();
            const slack = 1e-3;
            for (let frame = 0; frame < player.getTotalFrames(); frame += 3) {
                player.setFrameNo(frame);
                player.evaluateDrawFrame();
                for (let part = 0; part < names.length; part++) {
                    const quad = player.getPartQuad(part);
                    if (!quad) continue;
                    const [l, t, r, b] = boundsOf(quad);
                    const [dl, dt, dr, db] = boundsOf(builtPositions(player, part));
                    expect(dl, `${names[part]} @${frame}`).toBeGreaterThanOrEqual(l - slack);
                    expect(dt, `${names[part]} @${frame}`).toBeGreaterThanOrEqual(t - slack);
                    expect(dr, `${names[part]} @${frame}`).toBeLessThanOrEqual(r + slack);
                    expect(db, `${names[part]} @${frame}`).toBeLessThanOrEqual(b + slack);
                }
            }
            player.destroy();
        }, 60_000);

        it('reports a Shape as the box around its vertices, deformed past its size or not', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const packs = await convert(OVERALL);
            const player = new DirectInternalPlayer(textures);
            player.setCoordinateSystem(1);
            player.setInstancePackProvider(name => packs.get(`${name}.ssab`));
            player.bindResource(packs.get('Shape.ssab')!);
            await player.prepareResources();
            player.setAnimation(player.animationNames[0]);
            const counts = () => player.runtimeManager.getShapeVertexCounts();
            let checked = 0;
            let deformed = 0;
            for (let frame = 0; frame < player.getTotalFrames(); frame++) {
                player.setFrameNo(frame);
                player.evaluateDrawFrame();
                for (let part = 0; part < player.getPartNames().length; part++) {
                    if (!(counts()[part] > 0)) continue;
                    const quad = player.getPartQuad(part);
                    if (!quad) continue;
                    const [l, t, r, b] = boundsOf(quad);
                    const drawn = builtPositions(player, part);
                    const [dl, dt, dr, db] = boundsOf(drawn);
                    expect(dl).toBeGreaterThanOrEqual(l - 1e-3);
                    expect(dt).toBeGreaterThanOrEqual(t - 1e-3);
                    expect(dr).toBeLessThanOrEqual(r + 1e-3);
                    expect(db).toBeLessThanOrEqual(b + 1e-3);
                    // Shape's pose neither turns nor skews, so the box is tight.
                    expect([dl, dt, dr, db].map(v => Math.round(v * 1000))).toEqual([l, t, r, b].map(v => Math.round(v * 1000)));
                    if (l < -48 || t < -48) deformed++;
                    checked++;
                }
            }
            expect(checked).toBeGreaterThan(0);
            // Shape keys its top-left vertex out past the 96x96 box.
            expect(deformed).toBeGreaterThan(0);
            player.destroy();
        }, 60_000);

        it('answers the front-most part, or the front-most among those named', async () => {
            const player = await ringo();
            const [hl, ht, hr, hb] = boundsOf(player.getPartQuad('head')!);
            const [bl, bt, br, bb] = boundsOf(player.getPartQuad('body')!);
            const l = Math.max(hl, bl), t = Math.max(ht, bt), r = Math.min(hr, br), b = Math.min(hb, bb);
            expect(l < r && t < b).toBe(true);
            const x = (l + r) / 2, y = (t + b) / 2;
            const head = player.findPartIndex('head'), body = player.findPartIndex('body');
            // The head is drawn over the body.
            expect(player.hitTestPart(x, y)).toBe(head);
            expect(player.hitTestPart(x, y, ['body'])).toBe(body);
            expect(player.hitTestPart(x, y, [body])).toBe(body);
            expect(player.hitTestPart(x, y, ['nope'])).toBe(-1);
            expect(player.hitTestPart(x, y, [])).toBe(-1);
            expect(player.hitTestPart(5000, 5000)).toBe(-1);
            player.destroy();
        }, 60_000);

        it('answers nothing before a pack is bound', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const player = new DirectInternalPlayer(textures);
            expect(player.hitTestPart(0, 0)).toBe(-1);
            expect(player.getPartQuad(0)).toBeNull();
            player.destroy();
        }, 60_000);
    },
);
