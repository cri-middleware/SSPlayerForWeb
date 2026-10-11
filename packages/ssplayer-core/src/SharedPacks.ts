import { getWasmMemory, SSRuntimeContext, type SSABResource } from './SSRuntimeManager.js';

/**
 * Packs read from a URL — a player's own, or one its instance parts play — so
 * that players reading the same `.ssab` share one runtime resource. Everything the runtime derives from a pack — decoded keys,
 * part caches, setup poses, mesh buffers — lives on the resource, so a player
 * that shares one pays only for its own playback state: about 50 KB for Ringo,
 * against about 290 KB with a copy of the pack.
 *
 * A pack is shared only with bytes identical to it, so a URL whose file has
 * changed since (re-converted, say) is bound as a pack of its own, exactly as
 * it would be without sharing. The table holds a pack only while some player
 * does: weakly, so that a player dropped without destroy() still lets the
 * garbage collector free it.
 */
export interface SharedPack {
    readonly resource: SSABResource;
    readonly texturePaths: { hash: number, path: string }[];
    readonly animationNames: string[];
}

interface Entry {
    readonly resource: WeakRef<SSABResource>;
    // Where the runtime keeps the pack's bytes. A WASM address does not move when
    // the memory grows, so it stays valid for as long as the resource lives.
    readonly ptr: number;
    readonly len: number;
    readonly texturePaths: { hash: number, path: string }[];
    readonly animationNames: string[];
}

const packs = new Map<string, Entry>();

// One key for every spelling of the same address ("a/b.ssab", "./a/b.ssab").
function keyOf(url: string): string {
    try {
        return new URL(url, globalThis.location?.href).href;
    } catch {
        return url;
    }
}

/**
 * The pack bound from `url` whose bytes equal `bytes`, retained for the caller
 * (who releases it with one destroy()), or null when no player holds one.
 */
export function retainSharedPack(url: string, bytes: Uint8Array): SharedPack | null {
    const key = keyOf(url);
    const entry = packs.get(key);
    if (!entry) return null;
    const resource = entry.resource.deref();
    if (!resource || !resource.raw) {
        packs.delete(key);
        return null;
    }
    if (entry.len !== bytes.length) return null;
    const held = new Uint8Array(getWasmMemory().buffer, entry.ptr, entry.len);
    for (let i = 0; i < entry.len; i++) {
        if (held[i] !== bytes[i]) return null;
    }
    return { resource: resource.retain(), texturePaths: entry.texturePaths, animationNames: entry.animationNames };
}

/**
 * Offer the pack just made from `url` to later binds of the same bytes. `at`
 * locates the bytes the runtime holds for it, as a context bound to the pack
 * reports them; without one, a context is bound to the pack just to ask.
 */
export function addSharedPack(
    url: string, resource: SSABResource,
    texturePaths: { hash: number, path: string }[], animationNames: string[],
    at: { ptr: number, len: number } | null = locate(resource),
): void {
    if (!at || at.len === 0) return;
    const key = keyOf(url);
    const entry: Entry = { resource: new WeakRef(resource), ptr: at.ptr, len: at.len, texturePaths, animationNames };
    packs.set(key, entry);
    resource.onFreed = () => {
        if (packs.get(key) === entry) packs.delete(key);
    };
}

// The resource does not say where its bytes are; a context bound to it does.
function locate(resource: SSABResource): { ptr: number, len: number } | null {
    const probe = new SSRuntimeContext();
    try {
        if (!probe.bind_resource(resource.raw)) return null;
        return { ptr: probe.get_ssab_buf(), len: probe.get_ssab_len() };
    } catch {
        return null;
    } finally {
        probe.free();
    }
}
