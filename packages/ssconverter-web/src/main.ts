import wasmUrl from '@spritestudio/ssconverter-core/wasm/ssconverter_bg.wasm?url';
import {
  init,
  convertProject,
  locateProject,
  version,
  ssabSchemaVersion,
} from '@spritestudio/ssconverter-core';
import * as fflate from 'fflate';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="header">
    <h1>SSConverter Web</h1>
    <p>Convert SpriteStudio project (.sspj) to binaries (.ssab)</p>
  </div>
  
  <div class="panel">
    <div class="form-group drop-zone" id="dropZoneIn">
      <label style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
        <span style="font-size: 1.1rem; color: #818cf8;">📥 Drop Project Folder Here</span>
        <button class="btn" id="btnClear" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; background: rgba(239, 68, 68, 0.2); color: #f87171;">Clear Input</button>
      </label>
      <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem; margin-bottom: 0.25rem;">
        * Must contain exactly one .sspj file
      </div>
      <div class="input-row" style="margin-top: 0.5rem;">
        <input type="text" id="inDirDisplay" readonly placeholder="Drag & Drop a folder, or click Browse...">
        <button class="btn" id="btnSelectIn">Browse...</button>
      </div>
    </div>
    
    <div class="form-group" id="outGroup">
      <label>Output ZIP File</label>
      <div class="input-row">
        <input type="text" id="outDirDisplay" readonly placeholder="Automatically generated as .zip">
      </div>
    </div>

    <div class="options-group">
      <label class="checkbox-label">
        <input type="checkbox" id="chkEmbedded">
        Embedded Assets
      </label>
    </div>

    <div class="status-area">
      <div class="status-item">
        <span class="status-title">WASM</span>
        <span class="status-badge badge-pending" id="wasmStatus">Initializing...</span>
      </div>
      <div class="status-item">
        <span class="status-title">Status</span>
        <span class="status-badge badge-pending" id="convertStatus">Waiting</span>
      </div>
    </div>
    
    <button class="btn btn-success btn-full" id="btnConvert" disabled>
      ⚡ Convert & Download
    </button>
    
    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2rem; margin-bottom: -1rem;">
      <span style="color: var(--text-muted); font-weight: 600;">Logs</span>
      <div style="display: flex; gap: 0.5rem;">
        <button class="btn" id="btnCopyLog" style="padding: 0.25rem 0.75rem; font-size: 0.8rem;">Copy Logs</button>
        <button class="btn" id="btnClearLog" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; background: rgba(239, 68, 68, 0.2); color: #f87171;">Clear Logs</button>
      </div>
    </div>
    <div class="log-area" id="logArea"></div>
  </div>

  <div style="text-align: center; margin-top: 2rem; color: var(--text-muted); font-size: 0.85rem; display: flex; flex-direction: column; align-items: center; gap: 0.25rem;">
    <span id="versionDisplay">Converter Version: Loading...</span>
    <button class="btn" id="btnCopyVersion" style="margin-top: 0.25rem; padding: 0.1rem 0.4rem; font-size: 0.75rem; background: rgba(255,255,255,0.1); border: 1px solid var(--glass-border); display: none;" title="Copy Version">Copy Version</button>
  </div>
`;

const dropZoneIn = document.getElementById('dropZoneIn')!;
const btnClear = document.getElementById('btnClear') as HTMLButtonElement;
const outDirDisplay = document.getElementById('outDirDisplay') as HTMLInputElement;
const btnSelectIn = document.getElementById('btnSelectIn') as HTMLButtonElement;
const btnConvert = document.getElementById('btnConvert') as HTMLButtonElement;
const btnCopyLog = document.getElementById('btnCopyLog') as HTMLButtonElement;
const btnClearLog = document.getElementById('btnClearLog') as HTMLButtonElement;
const btnCopyVersion = document.getElementById('btnCopyVersion') as HTMLButtonElement;
const inDirDisplay = document.getElementById('inDirDisplay') as HTMLInputElement;
const wasmStatus = document.getElementById('wasmStatus')!;
const convertStatus = document.getElementById('convertStatus')!;
const logArea = document.getElementById('logArea')!;
const versionDisplay = document.getElementById('versionDisplay')!;

const chkEmbedded = document.getElementById('chkEmbedded') as HTMLInputElement;

// Reading the input folder is the one thing here that needs the File System
// Access API, and that API is secure-context only: over plain http it exists
// on localhost / 127.0.0.1 / [::1] and nowhere else. A local preview served as
// http://[::]:8080 or http://<lan-ip>:8080 -- the URL `python -m http.server`
// prints, among others -- is NOT a secure context, and the two entry points
// fail there in different ways:
//
//   showDirectoryPicker            absent, so calling it throws TypeError
//   DataTransferItem.getAsFileSystemHandle
//                                  PRESENT, and calling it takes the tab down
//                                  with it -- the browser process rejects the
//                                  IPC and kills the renderer
//                                  (RESULT_CODE_KILLED_BAD_MESSAGE)
//
// So the guard has to be the context, not the presence of the method: a
// `typeof handle.getAsFileSystemHandle === 'function'` check passes and then
// crashes the tab. Checked once here and consulted by both entry points.
const canPickFolders =
    window.isSecureContext &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

function logNoFolderAccess() {
    if (!window.isSecureContext) {
        log(
            `Error: opening a folder needs a secure context, and this page is ${location.origin}. ` +
            'Serve it over https, or open it as localhost / 127.0.0.1 / [::1].',
        );
    } else {
        log(
            'Error: this browser has no File System Access API, which this tool needs to read a ' +
            'project folder. Chrome or Edge can do it.',
        );
    }
}

let isWasmReady = false;
let inDirHandle: FileSystemDirectoryHandle | null = null;
let sourceFiles: Map<string, File> = new Map();
let currentSspjStem = '';
let currentSspjDir: string[] = [];

function getTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function log(msg: string, type: 'info' | 'error' | 'warning' | 'success' = 'info') {
    console.log(msg);
    if (type === 'info') {
        if (msg.startsWith('Error') || msg.startsWith('Failed to') || msg.includes('Error:')) {
            type = 'error';
        } else if (msg.includes('successfully') || msg.startsWith('Success')) {
            type = 'success';
        } else if (msg.startsWith('WARNING')) {
            type = 'warning';
        }
    }
    const div = document.createElement('div');
    div.textContent = msg;
    if (type !== 'info') {
        div.className = `log-${type}`;
    }
    logArea.appendChild(div);
    logArea.scrollTop = logArea.scrollHeight;
}

function updateBadge(el: HTMLElement, text: string, type: 'pending' | 'active' | 'success' | 'error') {
    el.textContent = text;
    el.className = `status-badge badge-${type}`;
}

function updateConvertButton() {
    btnConvert.disabled = !(isWasmReady && inDirHandle);
}

function resetState() {
    inDirHandle = null;
    currentSspjStem = '';
    currentSspjDir = [];
    sourceFiles.clear();
    inDirDisplay.value = '';
    outDirDisplay.value = '';
    updateBadge(convertStatus, 'Waiting', 'pending');
    updateConvertButton();
}

async function initWasm() {
    try {
        log('Initializing WebAssembly runtime...');
        await init(wasmUrl);
        const ver = version();
        const ssabSchemaVer = ssabSchemaVersion();
        versionDisplay.textContent = `Converter Version: ${ver} (ssab v${ssabSchemaVer})`;
        btnCopyVersion.style.display = 'inline-flex';
        btnCopyVersion.onclick = async () => {
            try {
                const textToCopy = `Converter Version: ${ver} (ssab v${ssabSchemaVer})`;
                await navigator.clipboard.writeText(textToCopy);
                const orig = btnCopyVersion.textContent;
                btnCopyVersion.textContent = 'Copied!';
                setTimeout(() => { btnCopyVersion.textContent = orig; }, 2000);
            } catch (e) {
                log('Failed to copy version.');
            }
        };
        log(`WASM Runtime loaded. Converter version: ${ver} (ssab v${ssabSchemaVer})`);
        updateBadge(wasmStatus, 'Ready', 'success');
        isWasmReady = true;
        updateConvertButton();
    } catch (e) {
        log(`Failed to load WASM: ${e}`);
        updateBadge(wasmStatus, 'Error', 'error');
    }
}

async function readDirectoryRecursive(dirHandle: FileSystemDirectoryHandle, basePath = ''): Promise<void> {
    // @ts-ignore
    for await (const entry of dirHandle.values()) {
        if (entry.name.startsWith('.')) continue; // Ignore hidden files like .DS_Store
        
        const path = basePath ? `${basePath}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
            const file = await entry.getFile();
            sourceFiles.set(path, file);
        } else if (entry.kind === 'directory') {
            await readDirectoryRecursive(entry as FileSystemDirectoryHandle, path);
        }
    }
}

async function handleInputDirectory(handle: FileSystemDirectoryHandle) {
    inDirHandle = handle;
    inDirDisplay.value = handle.name;
    sourceFiles.clear();
    currentSspjStem = '';
    currentSspjDir = [];
    
    log(`Scanning folder: ${handle.name}...`);
    try {
        await readDirectoryRecursive(handle);

        const { stem, dir } = locateProject(sourceFiles.keys());
        currentSspjStem = stem;
        currentSspjDir = dir;

        log(`Found project: ${currentSspjStem}`);
        const timestamp = getTimestamp();
        if (chkEmbedded.checked) {
            outDirDisplay.value = `${currentSspjStem}_emb_${timestamp}.zip`;
        } else {
            outDirDisplay.value = `${currentSspjStem}_${timestamp}.zip`;
        }
        
        updateConvertButton();
    } catch (e: any) {
        log(`Error: ${e.message || e}`);
        inDirHandle = null;
        inDirDisplay.value = '';
        outDirDisplay.value = '';
        updateConvertButton();
    }
}

btnSelectIn.addEventListener('click', async () => {
    if (!canPickFolders) {
        logNoFolderAccess();
        return;
    }
    try {
        // @ts-ignore
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        await handleInputDirectory(handle);
    } catch (e: any) {
        if (e.name !== 'AbortError') log(`Error: ${e.message || e}`);
    }
});

btnConvert.addEventListener('click', async () => {
    if (!inDirHandle) return;
    
    try {
        btnConvert.disabled = true;
        btnSelectIn.disabled = true;
        
        updateBadge(convertStatus, 'Reading Files...', 'active');
        log(`Reading folder: ${inDirHandle.name}`);
        await readDirectoryRecursive(inDirHandle);
        log(`Found ${sourceFiles.size} files in folder.`);
        
        if (!currentSspjStem) {
            throw new Error('No .sspj file found in the selected input folder.');
        }

        updateBadge(convertStatus, 'Converting...', 'active');
        log('Starting WASM conversion...');
        
        const filesMap = new Map<string, Uint8Array>();
        const prefix = currentSspjDir.length > 0 ? currentSspjDir.join('/') + '/' : '';
        for (const [path, file] of sourceFiles.entries()) {
            if (path.startsWith(prefix)) {
                filesMap.set(path, new Uint8Array(await file.arrayBuffer()));
            }
        }
        
        const startTime = performance.now();
        const result = convertProject(filesMap, { embedded: chkEmbedded.checked });
        const endTime = performance.now();
        log(`Conversion completed in ${(endTime - startTime).toFixed(2)} ms.`);
        
        // Output phase
        updateBadge(convertStatus, 'Generating ZIP...', 'active');
        const rootDirName = chkEmbedded.checked ? `${currentSspjStem}_emb` : currentSspjStem;
        const zipData: Record<string, Uint8Array> = {};
        
        // Write generated files
        for (const [filename, data] of result.output.entries()) {
            log(`Adding ${filename} to zip...`);
            zipData[`${rootDirName}/${filename}`] = data;
        }
        
        // Write referenced assets
        if (!chkEmbedded.checked && result.assets && result.assets.size > 0) {
            log('Copying referenced assets...');
            for (const [destPath, srcPath] of result.assets.entries()) {
                const fullSrcPath = currentSspjDir.length > 0 ? `${currentSspjDir.join('/')}/${srcPath}` : srcPath;
                const srcFile = sourceFiles.get(fullSrcPath);
                if (srcFile) {
                    log(`Adding asset ${fullSrcPath} -> ${destPath} to zip...`);
                    const buffer = await srcFile.arrayBuffer();
                    zipData[`${rootDirName}/${destPath}`] = new Uint8Array(buffer);
                } else {
                    log(`WARNING: Source asset not found: ${fullSrcPath}`);
                }
            }
        }
        
        log('Generating ZIP file...');
        const zippedBuffer = fflate.zipSync(zipData, { level: 6 });
        const zipBlob = new Blob([zippedBuffer], { type: 'application/zip' });
        
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        const zipFileName = outDirDisplay.value || `${rootDirName}_${getTimestamp()}.zip`;
        a.download = zipFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        updateBadge(convertStatus, 'Success', 'success');
        log(`Successfully downloaded ${zipFileName}`, 'success');
    } catch (e: any) {
        log(`Error: ${e.message || e}`);
        updateBadge(convertStatus, 'Failed', 'error');
    } finally {
        updateConvertButton();
        btnSelectIn.disabled = false;
    }
});

// Clear state and UI manually
btnClear.addEventListener('click', resetState);

// Drag & Drop logic for Input zone
dropZoneIn.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZoneIn.classList.add('dragover');
});
dropZoneIn.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZoneIn.classList.remove('dragover');
});
dropZoneIn.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZoneIn.classList.remove('dragover');
    if (!isWasmReady) return;
    
    // Before touching the item: calling getAsFileSystemHandle() here on an
    // insecure origin kills the tab outright.
    if (!canPickFolders) {
        logNoFolderAccess();
        return;
    }

    const items = e.dataTransfer?.items;
    if (items && items.length > 0) {
        try {
            // @ts-ignore
            const item = await items[0].getAsFileSystemHandle();
            if (item && item.kind === 'directory') {
                await handleInputDirectory(item as FileSystemDirectoryHandle);
            } else {
                log('Please drop a directory, not a file.');
            }
        } catch (e: any) {
            log(`Error: ${e.message || e}`);
        }
    }
});

chkEmbedded.addEventListener('change', () => {
    if (inDirHandle && currentSspjStem) {
        const timestamp = getTimestamp();
        if (chkEmbedded.checked) {
            outDirDisplay.value = `${currentSspjStem}_emb_${timestamp}.zip`;
        } else {
            outDirDisplay.value = `${currentSspjStem}_${timestamp}.zip`;
        }
    }
});

btnCopyLog.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(logArea.innerText || '');
        const originalText = btnCopyLog.textContent;
        btnCopyLog.textContent = 'Copied!';
        setTimeout(() => { btnCopyLog.textContent = originalText; }, 2000);
    } catch (e) {
        log('Failed to copy logs to clipboard.', 'error');
    }
});

btnClearLog.addEventListener('click', () => {
    logArea.textContent = '';
});

// Boot
// Say it up front rather than on the first click: nothing here can read a
// folder without the File System Access API, so a reader who cannot use it
// should learn that before picking a project, not after.
if (!canPickFolders) {
    btnSelectIn.disabled = true;
    dropZoneIn.classList.add('unavailable');
    inDirDisplay.placeholder = 'Folder access unavailable — see the log below';
    logNoFolderAccess();
}
initWasm();
