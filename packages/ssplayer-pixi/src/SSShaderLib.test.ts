import { describe, expect, it } from 'vitest';
import { SS_SHADER_SOURCES } from './SSShaderLib.js';

/**
 * PixiJS compiles the ss-* GLSL as GLSL ES 1.00, on WebGL2 as well, since the
 * sources carry no `#version 300 es`. ES 1.00 accepts a `for` loop only when
 * it compares its index against a constant, and a program that breaks the rule
 * fails to link: the parts using that shader draw nothing, with nothing but a
 * console error to say why.
 *
 * A source assertion, since no GL context runs here.
 */
describe('ss-* GLSL programs', () => {
    const programs = [...SS_SHADER_SOURCES.values()].map(p => p.gl.fragment);

    it('are all here', () => {
        expect(programs).toHaveLength(13);
    });

    it('bound every loop by a constant', () => {
        for (const fragment of programs) {
            for (const [, condition] of fragment.matchAll(/for\s*\([^;]*;([^;]*);/g)) {
                expect(condition.trim()).toMatch(/^\w+\s*<=?\s*\d+$/);
            }
        }
    });
});
