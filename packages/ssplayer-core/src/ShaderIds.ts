/**
 * FNV-1a 32-bit over a string's bytes — the hash the SDK identifies things by.
 *
 * Identical to the converter and the runtime (`ssconverter/src/utils.rs`
 * `fnv1a_hash_str`, `ssruntime/src/lib.rs`). The ids it is used on here are
 * ASCII, so `charCodeAt` is the byte value.
 */
export function ssFnv1a(s: string): number {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        hash ^= s.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
}

/**
 * The built-in `ss-*` integration shaders, in the SDK's order.
 *
 * The id is what an artist selects in the Editor; what reaches a player is its
 * hash, on the `SHDR` attribute as `PartAttributeShader.idHash()` (the converter
 * writes `value.id_hash = fnv1a_hash_str(&id)` in `model_t/animedata.rs`). Every
 * renderer needs the same pairing to know which of its programs a part is asking
 * for, and the pairing has nothing to do with how the program is written — the
 * GLSL and WGSL bodies stay with each renderer.
 */
export const SS_SHADER_IDS: readonly string[] = [
    'ss-sepia',
    'ss-hsb',
    'ss-step',
    'ss-pix',
    'ss-noise',
    'ss-bmask',
    'ss-outline',
    'ss-blur',
    'ss-wave',
    'ss-move',
    'ss-scatter',
    'ss-circle',
    'ss-spot',
];

/**
 * `ss-*` id → its `idHash`, resolved once at module load.
 *
 * Thirteen short hashes, which is why this is computed rather than written out:
 * a table of literals is a table that can be typed wrong, and a wrong one shows
 * up as a shader that silently never matches. `ss_shader_id_hashes_are_stable`
 * pins the values, so the SDK-side pairing is still asserted rather than assumed.
 */
export const SS_SHADER_ID_HASHES: ReadonlyMap<string, number> = new Map(
    SS_SHADER_IDS.map((id) => [id, ssFnv1a(id)] as const)
);

/** The `idHash` for a built-in `ss-*` id, or its FNV-1a for anything else. */
export function ssShaderIdHash(id: string): number {
    return SS_SHADER_ID_HASHES.get(id) ?? ssFnv1a(id);
}
