import { Application, Ticker, Assets } from 'pixi.js';
import { SSPlayer } from '@spritestudio/ssplayer-pixi';
import * as flatbuffers from 'flatbuffers';
import { SsAnimeBinary } from './format/ss-anime-binary.js';
import { SsSequenceBinary } from './format/ss-sequence-binary.js';

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

                // Get the directory containing this SSAB file
                const pathParts = ssabObj.path.split('/');
                const baseDir = pathParts.slice(0, -1).join('/');

                const requiredPaths = extractTexturePaths(buffer);
                
                // 2. Texture Dependency Validation (using proper hierarchy)
                const missingTextures: string[] = [];
                for (const { path } of requiredPaths) {
                    const expectedPath = resolveRelativePath(baseDir, path);
                    const texFile = loadedFiles.find(f => f.path === expectedPath);
                    if (!texFile) {
                        missingTextures.push(expectedPath);
                    }
                }

                if (missingTextures.length > 0) {
                    showToast(`Validation Failed: Missing required textures:<br>${missingTextures.join('<br>')}`, 'error');
                    return; // Abort loading
                }

                const promises = requiredPaths.map(async ({ hash, path }) => {
                    const expectedPath = resolveRelativePath(baseDir, path);
                    const texFileObj = loadedFiles.find(f => f.path === expectedPath)!;
                    const dataUrl = await fileToDataUrl(texFileObj.file);
                    const alias = hash.toString();
                    if (!Assets.resolver.hasKey(alias)) {
                        Assets.add({ alias: alias, src: dataUrl });
                    }
                    await Assets.load(alias);
                });
                await Promise.all(promises);

                const ssabBlobUrl = URL.createObjectURL(ssabObj.file);
                await player.load(ssabBlobUrl, "");

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

            if (ssabFiles.length > 1) {
                showToast(`Found ${ssabFiles.length} SSAB files. Playing the first one. Use the dropdown to switch.`, 'warning');
            }

            ssabSelect.innerHTML = '';
            ssabFiles.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.path; // Use relative path instead of basename to avoid collisions
                opt.textContent = f.path;
                ssabSelect.appendChild(opt);
            });
            ssabSelect.style.display = 'block';
            ssabSelect.value = ssabFiles[0].path;

            await loadSsabFile(ssabFiles[0]);
        });
    }
}

main().catch(console.error);
