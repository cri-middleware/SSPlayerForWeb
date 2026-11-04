import wasmUrl from '@spritestudio/ssconverter-core/wasm/ssconverter_bg.wasm?url';
import {
  init,
  convertProject,
  locateProject,
  version,
  ssabSchemaVersion,
  ssqbSchemaVersion,
} from '@spritestudio/ssconverter-core';
import * as fflate from 'fflate';
import { parseThemeChoice, nextThemeChoice, resolveTheme, resultText } from './utils';
import type { ThemeChoice, RunTone } from './utils';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="header">
    <h1>SSConverter Web</h1>
    <p>Convert SpriteStudio projects (.sspj) to binaries (.ssab / .ssqb)</p>
  </div>

  <div class="panel">
    <div class="form-group drop-zone" id="dropZoneIn">
      <div class="zone-label">
        <span class="zone-title" id="dropHeading">📥 Drop Project Folder Here</span>
      </div>
      <div class="zone-note">* Must contain exactly one .sspj file</div>
      <div class="input-row">
        <input type="text" id="inDirDisplay" readonly aria-labelledby="dropHeading" placeholder="Drag & Drop a folder, or click Browse...">
        <button class="btn" id="btnSelectIn">Browse...</button>
        <button class="btn btn-secondary btn-small" id="btnClearIn" aria-label="Clear input folder" hidden>Clear</button>
        <input type="file" id="inDirPicker" webkitdirectory hidden>
      </div>
    </div>

    <div class="input-row output-row">
      <span class="output-label">📤 Output</span>
      <input type="text" id="outDirDisplay" readonly aria-label="Output ZIP file" placeholder="Automatically generated as .zip">
    </div>

    <div class="options-group">
      <label class="checkbox-label">
        <input type="checkbox" id="chkEmbedded">
        Embedded Assets
      </label>
    </div>

    <div class="action-row">
      <button class="btn btn-success btn-full" id="btnConvert" disabled>
        ⚡ Convert & Download
      </button>
      <span class="status-badge badge-pending" id="convertStatus" role="status" aria-atomic="true">Loading converter...</span>
    </div>

    <div class="panes">
      <div class="pane">
        <div class="pane-head">
          <h2 class="pane-title" id="logTitle">Logs</h2>
          <div class="pane-actions">
            <button class="btn btn-secondary btn-small" id="btnCopyLog">Copy Logs</button>
            <button class="btn btn-secondary btn-small" id="btnClearLog">Clear Logs</button>
          </div>
        </div>
        <div class="log-area log-area-fill" id="logArea" role="log" aria-labelledby="logTitle"></div>
      </div>
    </div>
  </div>

  <div class="app-footer">
    <span id="versionDisplay">Converter Version: Loading...</span>
    <button class="btn btn-secondary btn-tiny" id="btnCopyVersion" hidden title="Copy Version">Copy Version</button>
  </div>

  <dialog id="resultModal" class="modal" aria-labelledby="modalTitleText" tabindex="-1">
    <h3 class="modal-title">
      <span id="modalIcon" aria-hidden="true"></span>
      <span id="modalTitleText"></span>
    </h3>
    <div class="result-output" id="resultOutput" hidden></div>
    <div class="result-issues" id="resultIssues" hidden></div>
    <div class="result-actions">
      <button class="btn btn-secondary" id="btnResultCopy" title="Copy the result as text">Copy</button>
      <button class="btn" id="btnResultClose">Close</button>
    </div>
  </dialog>

  <button id="themeToggle" class="theme-toggle" aria-label="Toggle Theme" title="Toggle Theme">☀️</button>
`;

const dropZoneIn = document.getElementById('dropZoneIn')!;
const btnClearIn = document.getElementById('btnClearIn') as HTMLButtonElement;
const outDirDisplay = document.getElementById('outDirDisplay') as HTMLInputElement;
const btnSelectIn = document.getElementById('btnSelectIn') as HTMLButtonElement;
const inDirPicker = document.getElementById('inDirPicker') as HTMLInputElement;
const dropHeading = document.getElementById('dropHeading')!;
const btnConvert = document.getElementById('btnConvert') as HTMLButtonElement;
const btnCopyLog = document.getElementById('btnCopyLog') as HTMLButtonElement;
const btnClearLog = document.getElementById('btnClearLog') as HTMLButtonElement;
const btnCopyVersion = document.getElementById('btnCopyVersion') as HTMLButtonElement;
const inDirDisplay = document.getElementById('inDirDisplay') as HTMLInputElement;
const convertStatus = document.getElementById('convertStatus')!;
const logArea = document.getElementById('logArea')!;
const versionDisplay = document.getElementById('versionDisplay')!;
const chkEmbedded = document.getElementById('chkEmbedded') as HTMLInputElement;
const resultModal = document.getElementById('resultModal') as HTMLDialogElement;
const modalIcon = document.getElementById('modalIcon')!;
const modalTitleText = document.getElementById('modalTitleText')!;
const resultOutput = document.getElementById('resultOutput')!;
const resultIssues = document.getElementById('resultIssues')!;
const btnResultCopy = document.getElementById('btnResultCopy') as HTMLButtonElement;
const btnResultClose = document.getElementById('btnResultClose') as HTMLButtonElement;
const themeToggle = document.getElementById('themeToggle') as HTMLButtonElement;

const THEME_ICON: Record<ThemeChoice, string> = { auto: '🖥️', light: '☀️', dark: '🌙' };
const THEME_LABEL: Record<ThemeChoice, string> = {
    auto: 'Theme: follow system',
    light: 'Theme: light',
    dark: 'Theme: dark',
};

function readStoredTheme(): string | null {
    try {
        return localStorage.getItem('theme');
    } catch {
        return null;
    }
}

function storeTheme(choice: ThemeChoice) {
    try {
        if (choice === 'auto') {
            localStorage.removeItem('theme');
        } else {
            localStorage.setItem('theme', choice);
        }
    } catch {
    }
}

const systemPrefersLight = window.matchMedia('(prefers-color-scheme: light)');
let themeChoice = parseThemeChoice(readStoredTheme());
function applyTheme() {
    if (resolveTheme(themeChoice, systemPrefersLight.matches) === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    const label = `${THEME_LABEL[themeChoice]} (click to change)`;
    themeToggle.textContent = THEME_ICON[themeChoice];
    themeToggle.title = label;
    themeToggle.setAttribute('aria-label', label);
}
themeToggle.addEventListener('click', () => {
    themeChoice = nextThemeChoice(themeChoice);
    storeTheme(themeChoice);
    applyTheme();
});
systemPrefersLight.addEventListener('change', applyTheme);
applyTheme();

// Browse... reads the folder through <input webkitdirectory>, which every
// browser has in any context, and which browser automation can fill: CDP's
// DOM.setFileInputFiles takes a directory there.
//
// A dropped folder is read through DataTransferItem.getAsFileSystemHandle, part
// of the File System Access API, which is secure-context only: over plain http
// it exists on localhost / 127.0.0.1 / [::1] and nowhere else. A local preview
// served as http://[::]:8080 or http://<lan-ip>:8080 -- the URL `python -m
// http.server` prints, among others -- is NOT a secure context, and there the
// method is still PRESENT, and calling it takes the tab down with it: the
// browser process rejects the IPC and kills the renderer
// (RESULT_CODE_KILLED_BAD_MESSAGE). So the guard has to be the context, not the
// presence of the method, with showDirectoryPicker -- absent outside a secure
// context -- standing in for the API.
const canReadDroppedFolders =
    window.isSecureContext &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

function noDropReason(): string {
    return window.isSecureContext
        ? 'this browser cannot read a dropped folder (it has no File System Access API)'
        : `reading a dropped folder needs a secure context, and this page is ${location.origin}`;
}

let isWasmReady = false;
let isConverting = false;
// The project folder, however it came in; `read` fills sourceFiles from it. A
// dropped folder is a live handle, read again at conversion; Browse... hands
// over the files as they were when picked.
let inputFolder: { name: string; read: () => Promise<void> } | null = null;
let sourceFiles: Map<string, File> = new Map();
let currentSspjStem = '';
let currentSspjDir: string[] = [];
let versionsText: string | null = null;

function getTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

type LogType = 'info' | 'error' | 'success' | 'warning';

const MAX_LOG_LINES = 500;

function log(msg: string, type: LogType = 'info') {
    console.log(msg);
    const div = document.createElement('div');
    div.textContent = msg;
    if (type !== 'info') {
        div.className = `log-${type}`;
    }
    logArea.appendChild(div);
    while (logArea.children.length > MAX_LOG_LINES) {
        logArea.firstElementChild!.remove();
    }
    logArea.scrollTop = logArea.scrollHeight;
}

function updateBadge(el: HTMLElement, text: string, type: 'pending' | 'active' | 'success' | 'error' | 'warning') {
    el.textContent = text;
    el.className = `status-badge badge-${type}`;
}

function updateConvertButton() {
    btnConvert.disabled = isConverting || !(isWasmReady && inputFolder);
}

function setBusy(busy: boolean) {
    isConverting = busy;
    btnSelectIn.disabled = busy;
    btnClearIn.disabled = busy;
    chkEmbedded.disabled = busy;
    updateConvertButton();
}

function zipName(): string {
    return `${currentSspjStem}${chkEmbedded.checked ? '_emb' : ''}_${getTimestamp()}.zip`;
}

function resetState() {
    inputFolder = null;
    currentSspjStem = '';
    currentSspjDir = [];
    sourceFiles.clear();
    inDirDisplay.value = '';
    outDirDisplay.value = '';
    btnClearIn.hidden = true;
    if (isWasmReady) updateBadge(convertStatus, 'Waiting', 'pending');
    updateConvertButton();
}

const TONE_ICON: Record<RunTone, string> = { success: '✅', warning: '⚠️', error: '❌' };

interface ResultIssue {
    label?: string;
    detail: string;
    tone: 'warning' | 'error';
}

interface ResultView {
    tone: RunTone;
    headline: string;
    output: string | null;
    issues: ResultIssue[];
}

let shownResult: ResultView | null = null;

function renderIssue(issue: ResultIssue): HTMLElement {
    const row = document.createElement('div');
    row.className = `result-issue result-issue-${issue.tone}`;
    if (issue.label) {
        const label = document.createElement('div');
        label.className = 'result-issue-label';
        label.textContent = issue.label;
        row.appendChild(label);
    }
    const detail = document.createElement('div');
    detail.className = 'result-issue-detail';
    detail.textContent = issue.detail;
    row.appendChild(detail);
    return row;
}

function showResult(view: ResultView) {
    shownResult = view;
    modalIcon.textContent = TONE_ICON[view.tone];
    modalTitleText.textContent = view.headline;
    resultOutput.textContent = view.output ?? '';
    resultOutput.hidden = !view.output;
    resultIssues.replaceChildren(...view.issues.map(renderIssue));
    resultIssues.hidden = view.issues.length === 0;
    resultModal.showModal();
    btnResultClose.focus();
}

btnResultClose.addEventListener('click', () => resultModal.close());
resultModal.addEventListener('close', () => btnConvert.focus());

btnResultCopy.addEventListener('click', async () => {
    if (!shownResult) return;
    try {
        await navigator.clipboard.writeText(resultText(shownResult, versionsText));
        const orig = btnResultCopy.textContent;
        btnResultCopy.textContent = 'Copied!';
        setTimeout(() => { btnResultCopy.textContent = orig; }, 2000);
    } catch (e) {
        log('Failed to copy the result.', 'error');
    }
});

async function initWasm() {
    try {
        log('Initializing WebAssembly runtime...');
        await init(wasmUrl);
        const versions = `Converter Version: ${version()} (ssab v${ssabSchemaVersion()}, ssqb v${ssqbSchemaVersion()})`;
        versionsText = versions;
        versionDisplay.textContent = versions;
        btnCopyVersion.hidden = false;
        btnCopyVersion.onclick = async () => {
            try {
                await navigator.clipboard.writeText(versions);
                const orig = btnCopyVersion.textContent;
                btnCopyVersion.textContent = 'Copied!';
                setTimeout(() => { btnCopyVersion.textContent = orig; }, 2000);
            } catch (e) {
                log('Failed to copy version.', 'error');
            }
        };
        log(`WASM Runtime loaded. ${versions}`);
        updateBadge(convertStatus, 'Waiting', 'pending');
        isWasmReady = true;
        updateConvertButton();
    } catch (e) {
        log(`Failed to load WASM: ${e}`, 'error');
        versionDisplay.textContent = 'Converter Version: unavailable';
        updateBadge(convertStatus, 'Load failed', 'error');
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

// Each file's webkitRelativePath starts with the picked folder's own name, which
// readDirectoryRecursive leaves out of its paths, so that segment is dropped.
// Automation that hands in files rather than a folder leaves webkitRelativePath
// empty; those files are taken as one folder with no subfolders.
function readPickedFiles(files: File[]) {
    for (const file of files) {
        const segments = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1) : [file.name];
        if (segments.some((s) => s.startsWith('.'))) continue; // Ignore hidden files like .DS_Store
        sourceFiles.set(segments.join('/'), file);
    }
}

async function handleInputFolder(folder: { name: string; read: () => Promise<void> }) {
    inputFolder = folder;
    inDirDisplay.value = folder.name;
    btnClearIn.hidden = false;
    sourceFiles.clear();
    currentSspjStem = '';
    currentSspjDir = [];

    log(`Scanning folder: ${folder.name}...`);
    try {
        await folder.read();

        const { stem, dir } = locateProject(sourceFiles.keys());
        currentSspjStem = stem;
        currentSspjDir = dir;

        log(`Found project: ${currentSspjStem}`);
        outDirDisplay.value = zipName();
        updateConvertButton();
        btnConvert.focus();
    } catch (e: any) {
        log(`Error: ${e.message || e}`, 'error');
        resetState();
    }
}

btnSelectIn.addEventListener('click', () => inDirPicker.click());

inDirPicker.addEventListener('change', async () => {
    const files = Array.from(inDirPicker.files ?? []);
    // Cleared so that picking the same folder again fires `change` again.
    inDirPicker.value = '';
    if (files.length === 0) {
        log('Error: The selected folder has no files.', 'error');
        return;
    }
    const name = files[0].webkitRelativePath.split('/')[0] || 'Selected files';
    await handleInputFolder({ name, read: async () => readPickedFiles(files) });
});

async function runConversion() {
    if (!inputFolder || isConverting) return;

    const folder = inputFolder;
    const embedded = chkEmbedded.checked;
    const zipFileName = outDirDisplay.value || zipName();

    try {
        setBusy(true);

        updateBadge(convertStatus, 'Reading Files...', 'active');
        log(`Reading folder: ${folder.name}`);
        await folder.read();
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
        const result = convertProject(filesMap, { embedded });
        const endTime = performance.now();
        log(`Conversion completed in ${(endTime - startTime).toFixed(2)} ms.`);

        updateBadge(convertStatus, 'Generating ZIP...', 'active');
        const rootDirName = embedded ? `${currentSspjStem}_emb` : currentSspjStem;
        const zipData: Record<string, Uint8Array> = {};

        for (const [filename, data] of result.output.entries()) {
            log(`Adding ${filename} to zip...`);
            zipData[`${rootDirName}/${filename}`] = data;
        }

        const missing: string[] = [];
        if (!embedded && result.assets && result.assets.size > 0) {
            log('Copying referenced assets...');
            for (const [destPath, srcPath] of result.assets.entries()) {
                const fullSrcPath = currentSspjDir.length > 0 ? `${currentSspjDir.join('/')}/${srcPath}` : srcPath;
                const srcFile = sourceFiles.get(fullSrcPath);
                if (srcFile) {
                    log(`Adding asset ${fullSrcPath} -> ${destPath} to zip...`);
                    const buffer = await srcFile.arrayBuffer();
                    zipData[`${rootDirName}/${destPath}`] = new Uint8Array(buffer);
                } else {
                    log(`WARNING: Source asset not found: ${fullSrcPath}`, 'warning');
                    missing.push(fullSrcPath);
                }
            }
        }

        log('Generating ZIP file...');
        const zippedBuffer = fflate.zipSync(zipData, { level: 6 });
        const zipBlob = new Blob([zippedBuffer], { type: 'application/zip' });

        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (missing.length > 0) {
            const headline = `Downloaded ${zipFileName}, but ${missing.length} referenced asset${missing.length === 1 ? ' was' : 's were'} not found.`;
            updateBadge(convertStatus, 'Missing assets', 'warning');
            log(headline, 'warning');
            showResult({
                tone: 'warning',
                headline,
                output: `Output: ${zipFileName}`,
                issues: missing.map((path) => ({ label: path, detail: 'Source asset not found', tone: 'warning' as const })),
            });
        } else {
            updateBadge(convertStatus, 'Success', 'success');
            log(`Successfully downloaded ${zipFileName}`, 'success');
        }
    } catch (e: any) {
        const message = `${e.message || e}`;
        log(`Error: ${message}`, 'error');
        updateBadge(convertStatus, 'Failed', 'error');
        showResult({
            tone: 'error',
            headline: 'Conversion failed.',
            output: null,
            issues: [{ detail: message, tone: 'error' }],
        });
    } finally {
        setBusy(false);
        if (!resultModal.open) btnConvert.focus();
    }
}

btnConvert.addEventListener('click', runConversion);

btnClearIn.addEventListener('click', resetState);

// A drop anywhere in the page goes to the input. Every drop is cancelled, or the
// browser opens the dropped item in place of the page.
function dropAccepted(): boolean {
    return canReadDroppedFolders && isWasmReady && !isConverting && !resultModal.open;
}

window.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZoneIn.classList.toggle('dragover', dropAccepted());
});
window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) dropZoneIn.classList.remove('dragover');
});
window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZoneIn.classList.remove('dragover');
    if (!isWasmReady || resultModal.open) return;
    if (isConverting) {
        log('A conversion is already running — dropped item ignored.', 'warning');
        return;
    }

    // Before touching the item: calling getAsFileSystemHandle() here on an
    // insecure origin kills the tab outright.
    if (!canReadDroppedFolders) {
        log(`Error: ${noDropReason()}. Use Browse... to choose the folder.`, 'error');
        return;
    }

    const items = Array.from(e.dataTransfer?.items ?? []).filter((item) => item.kind === 'file');
    if (items.length === 0) return;
    if (items.length > 1) {
        log(`Dropped ${items.length} items; using only the first. Drop one folder at a time.`, 'warning');
    }
    try {
        // Called before any await: the items are unreadable once the drop
        // handler has returned.
        // @ts-ignore
        const item = await items[0].getAsFileSystemHandle();
        if (item && item.kind === 'directory') {
            const handle = item as FileSystemDirectoryHandle;
            await handleInputFolder({ name: handle.name, read: () => readDirectoryRecursive(handle) });
        } else {
            log('Please drop a directory, not a file.', 'error');
        }
    } catch (e: any) {
        log(`Error: ${e.message || e}`, 'error');
    }
});

chkEmbedded.addEventListener('change', () => {
    if (inputFolder && currentSspjStem) {
        outDirDisplay.value = zipName();
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
    logArea.replaceChildren();
});

// Say it up front rather than on the first drop, so a reader whose drop cannot
// work goes to Browse... instead.
if (!canReadDroppedFolders) {
    dropZoneIn.classList.add('unavailable');
    dropHeading.textContent = '📥 Choose Project Folder';
    inDirDisplay.placeholder = 'Click Browse... to choose a folder';
    log(`Note: ${noDropReason()}. Use Browse... to choose the folder.`);
}
initWasm();
