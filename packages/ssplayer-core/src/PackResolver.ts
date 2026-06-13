import { SSRuntimeManager, SSABResource } from './SSRuntimeManager.js';
import { IResourceManager } from './IResourceManager.js';

/**
 * Host-supplied resolver for instance-referenced animation packs. Given the
 * referenced pack's name and name-hash, returns the pack's raw SSAB bytes, or
 * null/undefined to fall back to fetching `<base>/<name>.ssab`. Use this when
 * packs are not URL-addressable (e.g. drag-and-drop / in-memory bundles); the
 * host is then also responsible for loading those packs' textures (by cell-map
 * hash) into the shared ResourceManager before `setAnimation`.
 */
export type InstancePackProvider = (name: string, hash: number) => Uint8Array | null | undefined | Promise<Uint8Array | null | undefined>;

export interface ResolveInstancePacksOptions {
    /**
     * Zero-copy SSAB view of the root pack. It is read (into plain JS) before
     * any allocation below, so a subsequent WASM grow that detaches it is
     * harmless — see the snapshot note inside `resolveInstancePacks`.
     */
    rootSsab: Uint8Array;
    /** Base URL siblings are fetched from (`<base>/<name>.ssab`). */
    textureBaseUrl: string;
    /** Host byte provider, tried before the fetch fallback. */
    provider: InstancePackProvider | null;
    /** Shared, hash-keyed texture cache (and the gate for fetching textures). */
    resourceManager: IResourceManager | null;
    /** Destination pack registry (hash → resource); also used for dedup. */
    into: Map<number, SSABResource>;
}

/**
 * Resolve and load every animation pack referenced by `PartType::Instance`
 * parts of `rootSsab`, transitively. Referenced packs are served by `provider`
 * or fetched as sibling `.ssab` files (`<textureBaseUrl>/<packName>.ssab`), and
 * fetched packs' textures are loaded into the shared (hash-keyed) ResourceManager
 * cache so instanced sub-animations resolve their cells. Resolved resources are
 * stored in `into`, keyed by pack hash, so same-pack references reuse one
 * resource; the caller hands `into` to the runtime, which creates the child
 * contexts on `setupAnimation`.
 */
export async function resolveInstancePacks(opts: ResolveInstancePacksOptions): Promise<void> {
    const { rootSsab, textureBaseUrl, provider, resourceManager, into } = opts;

    // Snapshot the root pack's refs into plain JS FIRST: `rootSsab` is a view
    // over WASM memory, and creating an SSABResource below grows WASM memory,
    // which detaches that view. Reading it up front (allocation-free) keeps the
    // traversal correct. See the wasm-buffer-detach-on-grow project note.
    const parentInfo = SSRuntimeManager.extractPackInfo(rootSsab);
    const queue = SSRuntimeManager.extractInstancePackRefs(rootSsab);
    const seen = new Set<number>([parentInfo.hash]);

    const prefix = textureBaseUrl && !textureBaseUrl.endsWith('/') ? textureBaseUrl + '/' : textureBaseUrl;

    while (queue.length > 0) {
        const ref = queue.shift()!;
        if (into.has(ref.hash) || seen.has(ref.hash)) continue;
        seen.add(ref.hash);

        try {
            // Prefer a host-supplied provider (e.g. drag-and-drop bytes);
            // fall back to fetching a sibling `<base>/<name>.ssab`.
            let subBuf: Uint8Array | null = null;
            let fromProvider = false;
            if (provider) {
                const provided = await provider(ref.name, ref.hash);
                if (provided) {
                    subBuf = provided;
                    fromProvider = true;
                }
            }
            if (!subBuf) {
                const url = prefix + ref.name + '.ssab';
                const response = await fetch(url);
                if (!response.ok) {
                    console.warn(`Failed to load instance pack "${ref.name}" from ${url}: ${response.statusText}`);
                    continue;
                }
                subBuf = new Uint8Array(await response.arrayBuffer());
            }

            const resource = new SSABResource(subBuf);
            into.set(ref.hash, resource);

            // Fetch the referenced pack's textures into the shared cache.
            // Provider packs aren't URL-addressable, so their textures are
            // the host's responsibility (registered before setAnimation).
            if (!fromProvider && resourceManager) {
                const texPaths = SSRuntimeManager.extractTexturePaths(subBuf);
                await Promise.all(texPaths.map(info => resourceManager.loadTexture(prefix + info.path, info.hash)));
            }

            // Enqueue packs referenced by this pack (nested instances).
            if (resourceManager) {
                for (const nested of SSRuntimeManager.extractInstancePackRefs(subBuf)) {
                    if (!into.has(nested.hash)) {
                        queue.push(nested);
                    }
                }
            }
        } catch (e) {
            console.error(`Error loading instance pack "${ref.name}"`, e);
        }
    }
}
