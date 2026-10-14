import { SSPlayer } from '@spritestudio/ssplayer-pixi';
import { UIManager, showToast } from '../ui/UIManager.js';
import {
    extractAnimationNames,
    extractInstancePackRefs,
    extractPackInfo,
    extractTexturePaths,
    isSsab
} from '../utils/ssabExtractor.js';
import { LoadSequence } from './LoadSequence.js';

export function resolveRelativePath(baseDir: string, relativePath: string): string {
    const parts = baseDir ? baseDir.split('/') : [];
    const relParts = relativePath.split('/');
    for (const p of relParts) {
        if (p === '..') {
            parts.pop();
        } else if (p !== '.' && p !== '') {
            parts.push(p);
        }
    }
    return parts.join('/');
}

export async function getFilesFromDirHandle(dirHandle: any, currentPath = '', currentDepth = 0, maxDepth = 4): Promise<{file: File, path: string}[]> {
    if (currentDepth > maxDepth) {
        console.warn(`Depth limit exceeded at ${currentPath || dirHandle.name}`);
        return [];
    }
    
    const files: {file: File, path: string}[] = [];
    for await (const entry of dirHandle.values()) {
        if (entry.name.startsWith('.')) continue;

        const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        
        if (entry.kind === 'file') {
            files.push({ file: await entry.getFile(), path: entryPath });
        } else if (entry.kind === 'directory') {
            files.push(...await getFilesFromDirHandle(entry, entryPath, currentDepth + 1, maxDepth));
        }
    }
    return files;
}

export class DropLoader {
    private player: SSPlayer;
    private ui: UIManager;
    private loads: LoadSequence;
    private loadedFiles: {file: File, path: string}[] = [];
    private ssabFiles: {file: File, path: string}[] = [];

    constructor(player: SSPlayer, ui: UIManager, loads: LoadSequence) {
        this.player = player;
        this.ui = ui;
        this.loads = loads;
        this.setupDragAndDrop();
        
        this.ui.ssabSelect.addEventListener('change', async (e) => {
            const selectedPath = (e.target as HTMLSelectElement).value;
            const fileObj = this.ssabFiles.find(f => f.path === selectedPath);
            if (fileObj) {
                await this.loadSsabFile(fileObj, this.loads.begin());
            }
        });
    }

    private setupDragAndDrop() {
        window.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.ui.dropZone?.classList.add('active');
        });

        window.addEventListener('dragleave', (e) => {
            e.preventDefault();
            // The drop zone is `pointer-events: none`, so it is never a drag
            // event's target. relatedTarget is where the drag went; null once it
            // has left the page or been cancelled — without this the dark
            // overlay stayed up until the next drop.
            if (!e.relatedTarget) {
                this.ui.dropZone?.classList.remove('active');
            }
        });

        window.addEventListener('drop', async (e) => {
            e.preventDefault();
            this.ui.dropZone?.classList.remove('active');

            const items = e.dataTransfer?.items;
            if (!items || items.length === 0) return;

            let dirHandle: any = null;
            let ssabFileHandle: any = null;

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind !== 'file') continue;

                if (typeof (item as any).getAsFileSystemHandle === 'function') {
                    const handle = await (item as any).getAsFileSystemHandle();
                    if (!handle) continue;

                    if (handle.kind === 'directory') {
                        dirHandle = handle;
                        break;
                    } else if (handle.kind === 'file' && handle.name.endsWith('.ssab')) {
                        ssabFileHandle = handle;
                    }
                }
            }

            let allFiles: {file: File, path: string}[] = [];

            if (dirHandle) {
                allFiles = await getFilesFromDirHandle(dirHandle);
            } else if (ssabFileHandle) {
                for (let i = 0; i < items.length; i++) {
                    const f = items[i].getAsFile();
                    if (f) allFiles.push({ file: f, path: f.name });
                }
            } else {
                for (let i = 0; i < items.length; i++) {
                    const f = items[i].getAsFile();
                    if (f) allFiles.push({ file: f, path: f.name });
                }
            }

            const ssabFiles = allFiles.filter(f => f.path.endsWith('.ssab'));

            ssabFiles.sort((a, b) => {
                const partsA = a.path.split('/');
                const partsB = b.path.split('/');
                const len = Math.min(partsA.length, partsB.length);
                for (let i = 0; i < len; i++) {
                    if (partsA[i] !== partsB[i]) {
                        return partsA[i].localeCompare(partsB[i]);
                    }
                }
                return partsA.length - partsB.length;
            });

            if (ssabFiles.length === 0) {
                showToast('Validation Error: No .ssab file found in dropped items.', 'error');
                return;
            }
            // From here this drop replaces whatever is still loading — but not
            // before: a drop with nothing to play leaves the current load alone.
            const seq = this.loads.begin();

            let primary = ssabFiles[0];
            if (ssabFiles.length > 1) {
                try {
                    const referenced = new Set<number>();
                    const infos: { f: { file: File, path: string }, hash: number }[] = [];
                    for (const f of ssabFiles) {
                        const b = await f.file.arrayBuffer();
                        infos.push({ f, hash: extractPackInfo(b).hash });
                        for (const r of extractInstancePackRefs(b)) referenced.add(r.hash);
                    }
                    primary = (infos.find(i => i.hash && !referenced.has(i.hash)) ?? infos[0]).f;
                } catch { /* fall back */ }
            }
            if (!this.loads.isCurrent(seq)) return;
            if (ssabFiles.length > 1) {
                showToast(`Found ${ssabFiles.length} SSAB files. Playing "${primary.path}". Use the dropdown to switch.`, 'warning');
            }

            this.loadedFiles = allFiles;
            this.ssabFiles = ssabFiles;
            this.ui.updateSsabSelect(ssabFiles.map(f => f.path), primary.path);
            await this.loadSsabFile(primary, seq);
        });
    }

    public async loadSsabFile(ssabObj: {file: File, path: string}, seq: number) {
        // The drop this file came from. A newer drop replaces the fields, and this
        // load, now stale, must not go looking for its textures in that one.
        const loadedFiles = this.loadedFiles;
        const ssabFiles = this.ssabFiles;
        try {
            showToast(`Loading SSAB: ${ssabObj.file.name}`, 'info');
            const buffer = await ssabObj.file.arrayBuffer();
            if (!this.loads.isCurrent(seq)) return;

            if (!isSsab(buffer)) {
                showToast(`Invalid format: ${ssabObj.file.name} does not have the SSAB identifier.`, 'error');
                return;
            }

            const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');
            const involved: { buffer: ArrayBuffer, baseDir: string }[] = [{ buffer, baseDir: dirOf(ssabObj.path) }];
            const mainRefs = extractInstancePackRefs(buffer);

            if (mainRefs.length > 0) {
                const packByHash = new Map<number, { buffer: ArrayBuffer, baseDir: string }>();
                const packByName = new Map<string, { buffer: ArrayBuffer, baseDir: string }>();
                for (const sf of ssabFiles) {
                    try {
                        const b = (sf === ssabObj) ? buffer : await sf.file.arrayBuffer();
                        const info = extractPackInfo(b);
                        const entry = { buffer: b, baseDir: dirOf(sf.path) };
                        if (info.hash) packByHash.set(info.hash, entry);
                        if (info.name) packByName.set(info.name, entry);
                    } catch { /* skip unreadable */ }
                }
                if (!this.loads.isCurrent(seq)) return;

                const visited = new Set<number>([extractPackInfo(buffer).hash]);
                const missingPacks: string[] = [];
                const refQueue = [...mainRefs];
                while (refQueue.length > 0) {
                    const ref = refQueue.shift()!;
                    if (visited.has(ref.hash)) continue;
                    visited.add(ref.hash);
                    const entry = packByHash.get(ref.hash) ?? packByName.get(ref.name);
                    if (!entry) { missingPacks.push(`${ref.name}.ssab`); continue; }
                    involved.push(entry);
                    for (const nested of extractInstancePackRefs(entry.buffer)) {
                        if (!visited.has(nested.hash)) refQueue.push(nested);
                    }
                }
                if (missingPacks.length > 0) {
                    showToast(`Missing referenced pack(s) — include them in the dropped folder:<br>${[...new Set(missingPacks)].join('<br>')}`, 'warning');
                }

                this.player.internalPlayer.setInstancePackProvider((name: string, hash: number) => {
                    const entry = packByHash.get(hash) ?? packByName.get(name);
                    return entry ? new Uint8Array(entry.buffer) : null;
                });
            } else {
                this.player.internalPlayer.setInstancePackProvider(null);
            }

            const texRefs = involved.flatMap(({ buffer: b, baseDir }) =>
                extractTexturePaths(b).map(({ hash, path }) => ({ hash, expectedPath: resolveRelativePath(baseDir, path) }))
            );
            const missingTextures = [...new Set(
                texRefs.filter(t => !loadedFiles.find(f => f.path === t.expectedPath)).map(t => t.expectedPath)
            )];
            if (missingTextures.length > 0) {
                showToast(`Validation Failed: Missing required textures:<br>${missingTextures.join('<br>')}`, 'error');
                return;
            }

            const textures = new Map<number, Uint8Array>();
            for (const { hash, expectedPath } of texRefs) {
                if (textures.has(hash)) continue;
                const texFileObj = loadedFiles.find(f => f.path === expectedPath)!;
                textures.set(hash, new Uint8Array(await texFileObj.file.arrayBuffer()));
            }
            if (!this.loads.isCurrent(seq)) return;

            await this.loads.inTurn(seq, () => this.player.loadBuffer(buffer, textures));
            if (!this.loads.isCurrent(seq)) return;

            const anims = extractAnimationNames(buffer);
            this.ui.updateAnimationSelect(anims);

            if (anims.length > 0) {
                this.player.setAnimation(anims[0]);
                this.ui.syncAfterLoad();
            }

            showToast(`Successfully loaded ${ssabObj.file.name}`, 'success');
        } catch (err) {
            console.error('Error loading SSAB:', err);
            showToast(`Error loading SSAB: ${(err as Error).message || err}`, 'error');
        }
    }
}
