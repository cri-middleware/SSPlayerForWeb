import { Application, Ticker, Assets } from 'pixi.js';
import { SSPlayer } from '@spritestudio/ssplayer-pixi';
import * as flatbuffers from 'flatbuffers';
import { SsAnimeBinary } from './format/ss-anime-binary.js';
import { SsSequenceBinary } from './format/ss-sequence-binary.js';
import { PartType } from './format/part-type.js';
import { PartTypeInstance } from './format/part-type-instance.js';

function extractTexturePaths(buffer: ArrayBuffer): { hash: number, path: string }[] {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
    
    const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
    const results: { hash: number, path: string }[] = [];
    for (let i = 0; i < ssab.cellmapsLength(); i++) {
        const cellmap = ssab.cellmaps(i);
        if (cellmap) {
            const path = cellmap.imagePath();
            const hash = cellmap.nameHash();
            if (path) results.push({ hash, path });
        }
    }
    return results;
}

function extractAnimationNames(buffer: ArrayBuffer): string[] {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
    
    const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
    const results: string[] = [];
    for (let i = 0; i < ssab.animationsLength(); i++) {
        const anim = ssab.animations(i);
        if (anim) {
            const name = anim.name();
            if (name) results.push(name);
        }
    }
    return results;
}

function extractPackInfo(buffer: ArrayBuffer): { hash: number, name: string | null } {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    if (!SsAnimeBinary.bufferHasIdentifier(bb)) return { hash: 0, name: null };
    const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
    return { hash: ssab.nameHash() >>> 0, name: ssab.name() };
}

// Animation packs referenced by this pack's instance parts (the referenced
// animation may live in a separate .ssab pack that must be supplied too).
function extractInstancePackRefs(buffer: ArrayBuffer): { hash: number, name: string }[] {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
    const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
    const seen = new Set<number>();
    const out: { hash: number, name: string }[] = [];
    for (let i = 0; i < ssab.partsLength(); i++) {
        const part = ssab.parts(i);
        if (!part || part.partTypeType() !== PartType.PartTypeInstance) continue;
        const inst = part.partType(new PartTypeInstance()) as PartTypeInstance | null;
        if (!inst) continue;
        const hash = inst.refAnimePackHash() >>> 0;
        const name = inst.refAnimePack();
        if (name && !seen.has(hash)) { seen.add(hash); out.push({ hash, name }); }
    }
    return out;
}

function extractSequenceNames(buffer: ArrayBuffer): string[] {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    if (!SsSequenceBinary.bufferHasIdentifier(bb)) return [];
    
    const ssqb = SsSequenceBinary.getRootAsSsSequenceBinary(bb);
    const results: string[] = [];
    for (let i = 0; i < ssqb.sequenceListLength(); i++) {
        const seq = ssqb.sequenceList(i);
        if (seq) {
            const name = seq.name();
            if (name) results.push(name);
        }
    }
    return results;
}

function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function showToast(message: string, type: 'info' | 'error' | 'warning' | 'success' = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Add icon based on type
    let icon = 'ℹ️';
    if (type === 'error') icon = '❌';
    else if (type === 'warning') icon = '⚠️';
    else if (type === 'success') icon = '✅';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Remove after 5 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 300); // match CSS transition duration
    }, 5000);
}

function resolveRelativePath(baseDir: string, relativePath: string): string {
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

async function main() {
    await SSPlayer.initialize();

    // 2. Setup PixiJS Application
    const app = new Application();
    await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e, preference: 'webgpu' });
    
    const container = document.getElementById('canvas-container');
    if (container) {
        container.insertBefore(app.canvas, container.firstChild);
    } else {
        document.body.appendChild(app.canvas);
    }
    
    // 3. Setup Player
    const player = new SSPlayer();
    
    console.log("Loading animation...");
    await player.load('/Ringo.ssab');
    await player.setAnimation("run");

    // Set initial subframe state (it will be overridden by the checkbox shortly)
    player.subframe = true;
    player.position.set(640, 480);
    app.stage.addChild(player);
    
    console.log("SSPlayer initialized successfully.");
    
    player.play();

    // 4. Setup UI Controls
    const btnPlayPause = document.getElementById('btn-play-pause') as HTMLButtonElement;
    const seekBar = document.getElementById('seek-bar') as HTMLInputElement;
    const frameDisplay = document.getElementById('frame-display') as HTMLDivElement;
    const speedBar = document.getElementById('speed-bar') as HTMLInputElement;
    const speedDisplay = document.getElementById('speed-display') as HTMLSpanElement;
    const animationSelect = document.getElementById('animation-select') as HTMLSelectElement;
    const ssabSelect = document.getElementById('ssab-select') as HTMLSelectElement;
    const dropZone = document.getElementById('drop-zone');
    const subframeCheck = document.getElementById('subframe-check') as HTMLInputElement;

    let isDraggingSeekBar = false;

    if (btnPlayPause && seekBar && frameDisplay && speedBar && speedDisplay) {
        // Initialize seek bar max
        seekBar.max = player.endFrame.toString();

        btnPlayPause.addEventListener('click', () => {
            if (player.isPausing) {
                player.resume();
                btnPlayPause.textContent = 'Pause';
            } else {
                player.pause();
                btnPlayPause.textContent = 'Play';
            }
        });

        seekBar.addEventListener('mousedown', () => { isDraggingSeekBar = true; });
        seekBar.addEventListener('mouseup', () => { isDraggingSeekBar = false; });
        seekBar.addEventListener('input', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            player.frame = val;
            frameDisplay.textContent = `${val.toFixed(1)} / ${player.endFrame}`;
        });

        speedBar.addEventListener('input', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            player.speedScale = val;
            speedDisplay.textContent = val.toFixed(1);
        });

        if (subframeCheck) {
            subframeCheck.addEventListener('change', (e) => {
                player.subframe = (e.target as HTMLInputElement).checked;
            });
            player.subframe = subframeCheck.checked;
        }

        // Update UI every frame
        Ticker.shared.add(() => {
            if (!isDraggingSeekBar && player.isPlaying && !player.isPausing) {
                seekBar.value = player.frame.toString();
                frameDisplay.textContent = `${player.frame.toFixed(1)} / ${player.endFrame}`;
            }
        });

        // 5. Setup Animation Select for default Ringo
        try {
            const response = await fetch('/Ringo.ssab');
            const buffer = await response.arrayBuffer();
            const anims = extractAnimationNames(buffer);
            animationSelect.innerHTML = '';
            anims.forEach(animName => {
                const opt = document.createElement('option');
                opt.value = animName;
                opt.textContent = animName;
                animationSelect.appendChild(opt);
            });
            if (anims.length > 0) {
                animationSelect.value = "run"; // or anims[0] if run isn't present
            }
        } catch (e) {
            console.warn("Failed to fetch default Ringo.ssab animations", e);
        }

        animationSelect.addEventListener('change', async (e) => {
            const animName = (e.target as HTMLSelectElement).value;
            if (animName) {
                await player.setAnimation(animName);
                seekBar.max = player.endFrame.toString();
                player.play();
                btnPlayPause.textContent = 'Pause';
            }
        });

        // 6. Setup Drag and Drop
        async function getFilesFromDirHandle(dirHandle: any, currentPath = '', currentDepth = 0, maxDepth = 4): Promise<{file: File, path: string}[]> {
            if (currentDepth > maxDepth) {
                console.warn(`Depth limit exceeded at ${currentPath || dirHandle.name}`);
                return [];
            }
            
            const files: {file: File, path: string}[] = [];
            for await (const entry of dirHandle.values()) {
                if (entry.name.startsWith('.')) continue; // Ignore hidden files like .DS_Store for security

                const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                
                if (entry.kind === 'file') {
                    files.push({ file: await entry.getFile(), path: entryPath });
                } else if (entry.kind === 'directory') {
                    files.push(...await getFilesFromDirHandle(entry, entryPath, currentDepth + 1, maxDepth));
                }
            }
            return files;
        }

        window.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone?.classList.add('active');
        });

        window.addEventListener('dragleave', (e) => {
            e.preventDefault();
            if (e.target === dropZone) {
                dropZone?.classList.remove('active');
            }
        });

        let loadedFiles: {file: File, path: string}[] = [];
        let ssabFiles: {file: File, path: string}[] = [];

        async function loadSsabFile(ssabObj: {file: File, path: string}) {
            try {
                showToast(`Loading SSAB: ${ssabObj.file.name}`, 'info');
                const buffer = await ssabObj.file.arrayBuffer();

                // 1. Format Validation
                const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
                if (!SsAnimeBinary.bufferHasIdentifier(bb)) {
                    showToast(`Invalid format: ${ssabObj.file.name} does not have the SSAB identifier.`, 'error');
                    return;
                }

                // Directory of an SSAB within the dropped tree (textures resolve
                // relative to their own pack's directory).
                const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');

                // All packs whose textures must be registered. Starts with the
                // dropped pack; instance-referenced packs are appended below.
                const involved: { buffer: ArrayBuffer, baseDir: string }[] = [{ buffer, baseDir: dirOf(ssabObj.path) }];
                const mainRefs = extractInstancePackRefs(buffer);

                if (mainRefs.length > 0) {
                    // Index every dropped .ssab by pack name/hash (buffer + directory)
                    // so external instance references can be resolved and supplied.
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

                    // Walk the transitive instance-referenced packs.
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

                    // Supply these packs to the core from the dropped bytes — they
                    // aren't URL-addressable, so the fetch fallback can't find them.
                    player.internalPlayer.setInstancePackProvider((name, hash) => {
                        const entry = packByHash.get(hash) ?? packByName.get(name);
                        return entry ? new Uint8Array(entry.buffer) : null;
                    });
                } else {
                    player.internalPlayer.setInstancePackProvider(null);
                }

                // 2. Texture Dependency Validation across all involved packs.
                const texRefs = involved.flatMap(({ buffer: b, baseDir }) =>
                    extractTexturePaths(b).map(({ hash, path }) => ({ hash, expectedPath: resolveRelativePath(baseDir, path) }))
                );
                const missingTextures = [...new Set(
                    texRefs.filter(t => !loadedFiles.find(f => f.path === t.expectedPath)).map(t => t.expectedPath)
                )];
                if (missingTextures.length > 0) {
                    showToast(`Validation Failed: Missing required textures:<br>${missingTextures.join('<br>')}`, 'error');
                    return; // Abort loading
                }

                // Register textures (by cell-map hash) from all involved packs.
                const registered = new Set<string>();
                await Promise.all(texRefs.map(async ({ hash, expectedPath }) => {
                    const alias = hash.toString();
                    if (registered.has(alias)) return;
                    registered.add(alias);
                    const texFileObj = loadedFiles.find(f => f.path === expectedPath)!;
                    const dataUrl = await fileToDataUrl(texFileObj.file);
                    if (!Assets.resolver.hasKey(alias)) {
                        Assets.add({ alias, src: dataUrl });
                    }
                    await Assets.load(alias);
                }));

                const ssabBlobUrl = URL.createObjectURL(ssabObj.file);
                await player.load(ssabBlobUrl, "");
                URL.revokeObjectURL(ssabBlobUrl);

                const anims = extractAnimationNames(buffer);

                animationSelect.innerHTML = '';
                anims.forEach(animName => {
                    const opt = document.createElement('option');
                    opt.value = animName;
                    opt.textContent = animName;
                    animationSelect.appendChild(opt);
                });

                if (anims.length > 0) {
                    await player.setAnimation(anims[0]);
                    seekBar.max = player.endFrame.toString();
                    player.play();
                    btnPlayPause.textContent = 'Pause';
                }

                showToast(`Successfully loaded ${ssabObj.file.name}`, 'success');
            } catch (err) {
                console.error('Error loading SSAB:', err);
                showToast(`Error loading SSAB: ${(err as Error).message || err}`, 'error');
            }
        }

        ssabSelect.addEventListener('change', async (e) => {
            const selectedPath = (e.target as HTMLSelectElement).value;
            const fileObj = ssabFiles.find(f => f.path === selectedPath);
            if (fileObj) {
                await loadSsabFile(fileObj);
            }
        });

        window.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone?.classList.remove('active');

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

            loadedFiles = allFiles;
            ssabFiles = allFiles.filter(f => f.path.endsWith('.ssab'));

            if (ssabFiles.length === 0) {
                showToast('Validation Error: No .ssab file found in dropped items.', 'error');
                return;
            }

            // Pick the entry-point pack: prefer one NOT referenced by any other
            // dropped pack (e.g. an instance composition over its source packs).
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
                } catch { /* fall back to first */ }
                showToast(`Found ${ssabFiles.length} SSAB files. Playing "${primary.path}". Use the dropdown to switch.`, 'warning');
            }

            ssabSelect.innerHTML = '';
            ssabFiles.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.path; // Use relative path instead of basename to avoid collisions
                opt.textContent = f.path;
                ssabSelect.appendChild(opt);
            });
            ssabSelect.style.display = 'block';
            ssabSelect.value = primary.path;

            await loadSsabFile(primary);
        });
    }
}

main().catch(console.error);
