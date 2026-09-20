// Reading a dropped (or picked) SpriteStudio project folder.
//
// The twin of `examples/webgl-example/src/dropHelpers.ts`, which collects a
// folder of *converted* packs; this one collects the *source* project, so it
// keeps every file rather than filtering for `.ssab`, and then picks the
// `.sspj` out of the result. A change to how a folder is walked belongs in
// both.
//
// Two ways in, because a drop is not always the convenient one:
//   - drag and drop, which needs `DataTransferItem` to be walked; and
//   - `<input type="file" webkitdirectory>`, which hands over a flat FileList
//     whose entries already carry a relative path.

/** One file from the dropped project, with its path relative to the drop root. */
export interface ProjectFile {
  file: File;
  /** e.g. `Ringo/Ringo.ssae` — always `/`-separated. */
  path: string;
}

/** A `.sspj` found in the collected files, and the folder it sits in. */
export interface FoundProject {
  /** Path of the `.sspj` itself. */
  path: string;
  /** Its folder, `''` when the `.sspj` is at the root of what was dropped. */
  dir: string;
  /** `Ringo` for `Ringo/Ringo.sspj` — what the page calls the project. */
  stem: string;
}

/** Recursively enumerate a directory handed over by the File System Access API. */
async function fromDirectoryHandle(
  dir: FileSystemDirectoryHandle,
  prefix = '',
  depth = 0,
): Promise<ProjectFile[]> {
  // A SpriteStudio project is shallow (the `.sspj`, its `.ssae`/`.ssce`, and a
  // texture folder or two). The cap is what stops a mis-drop of `~/` from
  // walking a disk.
  if (depth > 6) return [];

  const files: ProjectFile[] = [];
  for await (const entry of (dir as unknown as {
    values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }).values()) {
    if (entry.name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      files.push({ file: await (entry as FileSystemFileHandle).getFile(), path });
    } else {
      files.push(...(await fromDirectoryHandle(entry as FileSystemDirectoryHandle, path, depth + 1)));
    }
  }
  return files;
}

/**
 * Everything that was dropped, as a flat list.
 *
 * A dropped *folder* only becomes walkable through `getAsFileSystemHandle`
 * (Chromium) — without it a drop reports the folder as a single unreadable
 * entry, and the caller is left with the `.sspj` alone, which cannot be
 * converted. The `<input webkitdirectory>` route below is the way in for the
 * browsers that have no handle, so the page always has one.
 */
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<ProjectFile[]> {
  const items = Array.from(dataTransfer.items).filter((item) => item.kind === 'file');
  const collected: ProjectFile[] = [];

  for (const item of items) {
    const asHandle = (item as DataTransferItem & {
      getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
    }).getAsFileSystemHandle;
    if (typeof asHandle === 'function') {
      const handle = await asHandle.call(item);
      if (!handle) continue;
      if (handle.kind === 'directory') {
        collected.push(...(await fromDirectoryHandle(handle as FileSystemDirectoryHandle)));
      } else {
        collected.push({ file: await (handle as FileSystemFileHandle).getFile(), path: handle.name });
      }
      continue;
    }
    const file = item.getAsFile();
    if (file) collected.push({ file, path: file.name });
  }

  if (collected.length > 0) return collected;
  // No items at all: a plain file list, with no folder to walk.
  return Array.from(dataTransfer.files).map((file) => ({ file, path: file.name }));
}

/**
 * The files an `<input type="file" webkitdirectory>` produces.
 *
 * `webkitRelativePath` carries the path inside the chosen folder, which is
 * exactly what the drop route builds by hand.
 */
export function collectPickedFiles(list: FileList): ProjectFile[] {
  return Array.from(list).map((file) => ({
    file,
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
}

/** Every `.sspj` among the collected files, shallowest first. */
export function findProjects(files: ProjectFile[]): FoundProject[] {
  return files
    .filter((f) => f.path.toLowerCase().endsWith('.sspj'))
    .map((f) => {
      const cut = f.path.lastIndexOf('/');
      return {
        path: f.path,
        dir: cut < 0 ? '' : f.path.slice(0, cut),
        stem: f.path.slice(cut + 1).replace(/\.sspj$/i, ''),
      };
    })
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
}

/**
 * The bytes of one project, keyed by path, ready for `convertProject`.
 *
 * Scoped to the chosen `.sspj` twice over, because the converter locates the
 * `.sspj` in what it is handed and re-bases every other path on its directory:
 * a drop holding two projects would otherwise convert whichever one it saw
 * last, whatever the page had been asked for. So this keeps the chosen
 * project's folder, and drops every *other* `.sspj` in it — two projects in
 * one folder is unusual, but nothing stops it, and the choice has to be the
 * page's either way.
 */
export async function readProject(
  files: ProjectFile[],
  project: FoundProject,
): Promise<Map<string, Uint8Array>> {
  const prefix = project.dir ? `${project.dir}/` : '';
  const bytes = new Map<string, Uint8Array>();
  for (const entry of files) {
    if (!entry.path.startsWith(prefix)) continue;
    if (entry.path !== project.path && entry.path.toLowerCase().endsWith('.sspj')) continue;
    bytes.set(entry.path, new Uint8Array(await entry.file.arrayBuffer()));
  }
  return bytes;
}
