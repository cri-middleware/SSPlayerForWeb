import { SSSurface, SSRuntimeManager } from '@spritestudio/ssplayer-webgl';
import { UIManager, showToast } from './ui/UIManager.js';
import { ViewControls } from './view/ViewControls.js';
import { collectDroppedFiles, resolveRelativePath, sortByPath, type DroppedFile } from './dropHelpers.js';

async function main() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  // Fixed drawing-buffer size (matches pixi-example's 1280x960). Effect-heavy
  // animations are fill-rate bound (additive overdraw), so capping the pixel
  // count here — rather than tracking the full window — keeps them smooth.
  const CANVAS_W = 1280;
  const CANVAS_H = 960;
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  await SSSurface.initialize();

  // Opaque backdrop (matches the page's dark canvas frame). Additive /
  // backdrop-reading blend modes (Add, Screen, …) only composite correctly against
  // a real opaque backdrop — on a transparent canvas an additive glow baked on a
  // black background renders that black as an opaque block. Omit backgroundColor
  // for a transparent overlay (accepting that limitation for such blends).
  const surface = new SSSurface(canvas, { autoStart: true, backgroundColor: 0x1a1a2e });
  const player = surface.createPlayer();

  // Pan (drag) / zoom (wheel) of the animation. Owns the view transform: every
  // newly-shown animation is re-centred and unscaled via view.reset(), which
  // UIManager.syncAfterLoad() calls.
  const view = new ViewControls(player, canvas);
  // Playback panel (restart / play-pause / reset view / timeline / speed).
  // Subframe interpolation follows its checkbox, on by default.
  const ui = new UIManager(player, view);

  const notify = (msg: string, type: 'info' | 'error' | 'warning' | 'success' = 'info') => {
    showToast(msg, type);
    console.log(msg);
  };

  // --- Sound ---
  // Nothing to wire up: when an SSAB references sounds, the player auto-creates a
  // default Web Audio manager while loading and plays them (autoAudio, on by
  // default). Just select/drop Sound.ssab. Audio starts after a user gesture per
  // the browser autoplay policy — clicking anywhere on the page resumes it.
  //
  // The onAudio listener below is OPTIONAL — only for showing which sound fired.
  // Playback happens automatically regardless of whether you listen.

  // --- Animation event listeners ---
  player.onAnimationFinished(() => console.log('[SS][end] animation finished'));
  player.onAnimationLooped(() => console.log('[SS][loop] animation looped'));
  player.onUserData((e) => {
    console.log('[SS][userData]', e);
    showToast(`UserData @${e.partName ?? e.partIndex}`, 'info');
  });
  player.onSignal((e) => {
    console.log('[SS][signal]', e);
    showToast(`Signal "${e.commandId}" @${e.partName ?? e.partIndex}`, 'info');
  });
  player.onAudio((e) => {
    console.log('[SS][audio]', e);
    showToast(`Audio "${e.soundName ?? e.soundNameHash}" (loop ${e.loopNum})`, 'success');
  });

  // Dropped ssab files by their dropdown value (path); empty until a folder is dropped.
  let droppedSsabs = new Map<string, DroppedFile>();
  let droppedFiles: DroppedFile[] = [];

  // Every drop and every ssab pick is a new load, and the newest one wins: one
  // that is still reading files when the next begins stops at its next await,
  // before it touches the player. Left to run on, the two bind each other's
  // packs, and the older one goes on to pick its own animation on the newer
  // pack.
  let loadSeq = 0;
  // ...and the player calls themselves run one at a time, each only if its load
  // is still the newest. load() binds once its fetch is back, so one still
  // fetching could otherwise bind over a newer pack that got there first.
  let playerLoad: Promise<unknown> = Promise.resolve();
  const loadInTurn = (seq: number, load: () => Promise<void>): Promise<void> => {
    const run = playerLoad.then(() => (seq === loadSeq ? load() : undefined));
    playerLoad = run.catch(() => {});
    return run;
  };

  const playAnimation = async (name: string) => {
    if (!name) return;
    player.setAnimation(name);
    // Refreshes the seek-bar range, resets the pan/zoom and starts playback.
    ui.syncAfterLoad();
  };

  // --- Bundled ssab (loaded by URL; textures fetched from public/) ---
  // The bundled set is the <option>s of #ssab-select in index.html, each value
  // a URL. The deploy nests each project under public/<project>/ (ssconverter
  // --stem-dir): the `overall` test project in overall/, Ringo in Ringo/.
  //
  // The URLs are RELATIVE — no leading slash. The demo is served from a subpath
  // on GitHub Pages (/SSPlayerForWeb/examples/webgl/), where a root-absolute
  // '/overall/…' resolves to the site root and 404s. Textures follow the ssab:
  // the player derives their base from the ssab URL, so a relative ssab keeps its
  // sibling PNGs relative too.
  const loadBundled = async (url: string, seq: number) => {
    notify(`Loading ${url}...`);
    await loadInTurn(seq, () => player.load(url));
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    if (seq !== loadSeq) return;
    const anims = SSRuntimeManager.extractAnimationNames(buf);
    ui.updateAnimationSelect(anims);
    if (anims.length > 0) await playAnimation(anims[0]);
    notify(`Loaded ${url} (${anims.length} animation${anims.length === 1 ? '' : 's'})`, 'success');
  };

  const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');

  // --- Dropped ssab (loaded from the dropped buffer + sibling texture files) ---
  const loadDropped = async (ssabObj: DroppedFile, seq: number) => {
    notify(`Loading ${ssabObj.path}...`);
    const ssabBuffer = await ssabObj.file.arrayBuffer();
    const rootBuf = new Uint8Array(ssabBuffer);

    // Read every dropped ssab once (buffer + pack identity) for the provider and the
    // instance-pack traversal below.
    const entries = await Promise.all([...droppedSsabs.values()].map(async (sf) => {
      const b = new Uint8Array(await sf.file.arrayBuffer());
      return { sf, buf: b, info: SSRuntimeManager.extractPackInfo(b) };
    }));
    if (seq !== loadSeq) return;
    const byHash = new Map<number, typeof entries[number]>();
    const byName = new Map<string, typeof entries[number]>();
    for (const e of entries) {
      if (e.info.hash) byHash.set(e.info.hash >>> 0, e);
      if (e.info.name) byName.set(e.info.name, e);
    }

    // Instance-pack provider: hand the runtime any dropped ssab by hash/name so
    // instance parts referencing sibling packs resolve without a network fetch.
    const rootRefs = SSRuntimeManager.extractInstancePackRefs(rootBuf);
    if (rootRefs.length > 0) {
      player.internalPlayer.setInstancePackProvider((name: string, hash: number) => (byHash.get(hash >>> 0) ?? byName.get(name))?.buf ?? null);
    } else {
      player.internalPlayer.setInstancePackProvider(null);
    }

    // Every ssab whose textures must be loaded up front = root + the instance packs it
    // references, transitively. Provider-served packs are NOT URL-addressable, so the
    // runtime won't load their textures for us — we must.
    const involved: { buf: Uint8Array; baseDir: string }[] = [{ buf: rootBuf, baseDir: dirOf(ssabObj.path) }];
    const visited = new Set<number>([SSRuntimeManager.extractPackInfo(rootBuf).hash >>> 0]);
    const queue = [...rootRefs];
    const missingPacks: string[] = [];
    while (queue.length > 0) {
      const ref = queue.shift()!;
      if (visited.has(ref.hash >>> 0)) continue;
      visited.add(ref.hash >>> 0);
      const e = byHash.get(ref.hash >>> 0) ?? byName.get(ref.name);
      if (!e) { missingPacks.push(`${ref.name}.ssab`); continue; }
      involved.push({ buf: e.buf, baseDir: dirOf(e.sf.path) });
      for (const nested of SSRuntimeManager.extractInstancePackRefs(e.buf)) {
        if (!visited.has(nested.hash >>> 0)) queue.push(nested);
      }
    }
    if (missingPacks.length > 0) notify(`Missing instance pack(s): ${[...new Set(missingPacks)].join(', ')} — include them in the dropped folder.`, 'warning');

    // Resolve every involved ssab's textures to a dropped file, each relative to
    // ITS own ssab's directory. Textures embedded in the ssab (converter
    // `--embedded` mode) are skipped here — the player decodes them from the
    // ssab's own bytes in loadTextures, so no sibling file is needed.
    //
    // Handed over as bytes, not as a data: URL. Bytes become a texture this
    // player owns and frees when the next pack loads; a URL goes into the
    // surface's shared cache, which keys on it and never evicts, so every drop
    // left its atlases on the GPU for the life of the page.
    const textures = new Map<number, ArrayBuffer>();
    const missingTex: string[] = [];
    for (const { buf, baseDir } of involved) {
      const embedded = new Set(SSRuntimeManager.extractEmbeddedTextures(buf).map((e) => e.hash >>> 0));
      for (const { hash, path } of SSRuntimeManager.extractTexturePaths(buf)) {
        if (textures.has(hash)) continue;
        if (embedded.has(hash >>> 0)) continue;
        const expected = resolveRelativePath(baseDir, path);
        const texFile = droppedFiles.find((f) => f.path === expected);
        if (!texFile) { missingTex.push(expected); continue; }
        textures.set(hash, await texFile.file.arrayBuffer());
      }
    }
    if (seq !== loadSeq) return;
    if (missingTex.length > 0) notify(`Missing texture(s): ${[...new Set(missingTex)].join(', ')}`, 'error');

    await loadInTurn(seq, () => player.loadBuffer(ssabBuffer, textures));
    if (seq !== loadSeq) return;
    const anims = SSRuntimeManager.extractAnimationNames(rootBuf);
    ui.updateAnimationSelect(anims);
    if (anims.length > 0) await playAnimation(anims[0]);
    notify(`Loaded ${ssabObj.file.name} (${anims.length} animation${anims.length === 1 ? '' : 's'})`, 'success');
  };

  // ssab dropdown: value is a dropped path (if any) or a bundled URL.
  ui.ssabSelect.addEventListener('change', () => {
    const value = ui.ssabSelect.value;
    const dropped = droppedSsabs.get(value);
    const seq = ++loadSeq;
    (dropped ? loadDropped(dropped, seq) : loadBundled(value, seq)).catch((e) => notify(`Error: ${e?.message ?? e}`, 'error'));
  });

  // animation dropdown
  ui.animationSelect.addEventListener('change', () => {
    playAnimation(ui.animationSelect.value).catch((e) => notify(`Error: ${e?.message ?? e}`, 'error'));
  });

  // --- Drag & drop a folder (or files) of ssab + textures ---
  window.addEventListener('dragover', (e) => { e.preventDefault(); ui.dropZone?.classList.add('active'); });
  // The drop zone is `pointer-events: none`, so it is never a drag event's target.
  // relatedTarget is where the drag went; null once it has left the page or been
  // cancelled — without this the dark overlay stayed up until the next drop.
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) ui.dropZone?.classList.remove('active'); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    ui.dropZone?.classList.remove('active');
    if (!e.dataTransfer) return;
    try {
      const files = await collectDroppedFiles(e.dataTransfer);
      const ssabs = sortByPath(files.filter((f) => f.path.toLowerCase().endsWith('.ssab')));
      if (ssabs.length === 0) { notify('No .ssab file found in the dropped items.', 'error'); return; }
      // From here this drop replaces whatever is still loading — but not before:
      // a drop with nothing to play leaves the current load alone.
      const seq = ++loadSeq;

      // Pick a primary ssab: prefer one not referenced as an instance pack by another.
      let primary = ssabs[0];
      if (ssabs.length > 1) {
        const referenced = new Set<number>();
        const infos: { f: DroppedFile; hash: number }[] = [];
        for (const f of ssabs) {
          const b = new Uint8Array(await f.file.arrayBuffer());
          infos.push({ f, hash: SSRuntimeManager.extractPackInfo(b).hash });
          for (const r of SSRuntimeManager.extractInstancePackRefs(b)) referenced.add(r.hash);
        }
        primary = (infos.find((i) => i.hash && !referenced.has(i.hash)) ?? infos[0]).f;
      }

      if (seq !== loadSeq) return;

      // Repopulate the ssab dropdown with the dropped ssab paths.
      droppedFiles = files;
      droppedSsabs = new Map(ssabs.map((f) => [f.path, f]));
      ui.updateSsabSelect(ssabs.map((f) => f.path), primary.path);
      await loadDropped(primary, seq);
    } catch (err) {
      notify(`Error loading dropped files: ${(err as Error)?.message ?? err}`, 'error');
      console.error(err);
    }
  });

  // Initial bundled load.
  await loadBundled(ui.ssabSelect.value, ++loadSeq);
}

main().catch(console.error);
