// Drag-and-drop file helpers for the WebGL example, mirroring examples/pixi-example's
// DropLoader (getFilesFromDirHandle / resolveRelativePath / fileToDataUrl). Kept
// engine-agnostic; the WebGL-specific loading lives in main.ts (via loadBuffer).

export interface DroppedFile {
  file: File;
  /** Path relative to the dropped root (e.g. "anime/textures/common.png"). */
  path: string;
}

/** Resolve a texture path (possibly with ../) against the ssab's directory. */
export function resolveRelativePath(baseDir: string, relativePath: string): string {
  const parts = baseDir ? baseDir.split('/') : [];
  for (const p of relativePath.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.' && p !== '') parts.push(p);
  }
  return parts.join('/');
}

/** Read a File as a data: URL (used as an <img> src for dropped textures). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Recursively enumerate a dropped directory (File System Access handle). */
export async function getFilesFromDirHandle(
  dirHandle: any, currentPath = '', currentDepth = 0, maxDepth = 4
): Promise<DroppedFile[]> {
  if (currentDepth > maxDepth) return [];
  const files: DroppedFile[] = [];
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

/** Gather the dropped items into a flat file list (directory-aware when supported). */
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<DroppedFile[]> {
  const items = dataTransfer.items;
  if (items && items.length) {
    // Prefer the File System Access API so dropped folders are walked recursively.
    let dirHandle: any = null;
    const handleFiles: DroppedFile[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      if (typeof (item as any).getAsFileSystemHandle === 'function') {
        const handle = await (item as any).getAsFileSystemHandle();
        if (!handle) continue;
        if (handle.kind === 'directory') { dirHandle = handle; break; }
        if (handle.kind === 'file') handleFiles.push({ file: await handle.getFile(), path: handle.name });
      } else {
        const f = item.getAsFile();
        if (f) handleFiles.push({ file: f, path: f.name });
      }
    }
    if (dirHandle) return getFilesFromDirHandle(dirHandle);
    if (handleFiles.length) return handleFiles;
  }
  // Fallback: plain file list (no directory traversal).
  return Array.from(dataTransfer.files).map((f) => ({ file: f, path: f.name }));
}

/** Sort ssab paths shallow-first, then lexicographically, for a stable dropdown order. */
export function sortByPath(files: DroppedFile[]): DroppedFile[] {
  return files.slice().sort((a, b) => {
    const pa = a.path.split('/'), pb = b.path.split('/');
    const n = Math.min(pa.length, pb.length);
    for (let i = 0; i < n; i++) if (pa[i] !== pb[i]) return pa[i].localeCompare(pb[i]);
    return pa.length - pb.length;
  });
}
