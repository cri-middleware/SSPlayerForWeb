import { SSCanvasPlayer, SSRuntimeManager } from '@spritestudio/ssplayer-webgl';
import { collectDroppedFiles, fileToDataUrl, resolveRelativePath, sortByPath, type DroppedFile } from './dropHelpers.js';

// Bundled sample ssabs served from public/ (root). Their <option> value is the URL.
const BUNDLED_SSABS = [
  'Basic.ssab', 'Shape.ssab', 'PartsColor.ssab', 'Mesh.ssab', 'Ringo.ssab',
  'Effect.ssab', 'Mask.ssab', 'Instance.ssab', 'BlendMode.ssab',
];

async function main() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  // Fixed drawing-buffer size (matches pixi-example's 1280x960). Effect-heavy
  // animations are fill-rate bound (additive overdraw), so capping the pixel
  // count here — rather than tracking the full window — keeps them smooth.
  const CANVAS_W = 1280;
  const CANVAS_H = 960;
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  const ssabSelect = document.getElementById('ssab-select') as HTMLSelectElement;
  const animSelect = document.getElementById('animation-select') as HTMLSelectElement;
  const statusEl = document.getElementById('status') as HTMLElement | null;
  const dropOverlay = document.getElementById('drop-overlay') as HTMLElement | null;
  const setStatus = (msg: string) => { if (statusEl) statusEl.textContent = msg; console.log(msg); };

  await SSCanvasPlayer.initialize();

  // Opaque backdrop (matches the page's #333 body). Additive / backdrop-reading
  // blend modes (Add, Screen, …) only composite correctly against a real opaque
  // backdrop — on a transparent canvas an additive glow baked on a black
  // background renders that black as an opaque block. Omit backgroundColor for a
  // transparent overlay (accepting that limitation for such blends).
  const player = new SSCanvasPlayer(canvas, { autoStart: true, backgroundColor: 0x333333 });
  player.subFrameEnabled = true;

  // --- Sound ---
  // Nothing to wire up: when an SSAB references sounds, the player auto-creates a
  // default Web Audio manager on setAnimation and plays them (autoAudio, on by
  // default). Just select/drop Sound.ssab. Audio starts after a user gesture per
  // the browser autoplay policy — clicking anywhere on the page resumes it.
  //
  // The onAudio listener below is OPTIONAL — only for showing which sound fired.
  // Playback happens automatically regardless of whether you listen.

  // --- Animation event listeners (06_playback_control) ---
  player.onAnimationEnd(() => console.log('[SS][end] animation finished'));
  player.onAnimationLoop(() => console.log('[SS][loop] animation looped'));
  player.onUserData((e) => console.log('[SS][userData]', e));
  player.onSignal((e) => console.log('[SS][signal]', e));
  player.onAudio((e) => {
    console.log('[SS][audio]', e);
    setStatus(`♪ Audio "${e.soundName ?? e.soundNameHash}" (loop ${e.loopNum})`);
  });

  // Fixed drawing buffer (1280x960): re-centre the animation. The projection is
  // recomputed from canvas.width/height each frame, so no per-resize work is
  // needed — the CSS layout scales the fixed buffer to fit the window.
  player.setTransform({ x: canvas.width / 2, y: canvas.height / 2 });

  // Dropped ssab files by their dropdown value (path); empty until a folder is dropped.
  let droppedSsabs = new Map<string, DroppedFile>();
  let droppedFiles: DroppedFile[] = [];

  const populateAnimations = (anims: string[]) => {
    animSelect.innerHTML = '';
    for (const name of anims) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      animSelect.appendChild(opt);
    }
    animSelect.disabled = anims.length === 0;
  };

  const playAnimation = async (name: string) => {
    if (!name) return;
    await player.setAnimation(name);
    player.play();
  };

  // --- Bundled ssab (loaded by URL; textures fetched from public/) ---
  const loadBundled = async (url: string) => {
    setStatus(`Loading ${url}...`);
    await player.load(url);
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const anims = SSRuntimeManager.extractAnimationNames(buf);
    populateAnimations(anims);
    if (anims.length > 0) await playAnimation(anims[0]);
    setStatus(`Loaded ${url} (${anims.length} animation${anims.length === 1 ? '' : 's'})`);
  };

  const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');

  // --- Dropped ssab (loaded from the dropped buffer + sibling texture files) ---
  const loadDropped = async (ssabObj: DroppedFile) => {
    setStatus(`Loading ${ssabObj.path}...`);
    const ssabBuffer = await ssabObj.file.arrayBuffer();
    const rootBuf = new Uint8Array(ssabBuffer);

    // Read every dropped ssab once (buffer + pack identity) for the provider and the
    // instance-pack traversal below.
    const entries = await Promise.all([...droppedSsabs.values()].map(async (sf) => {
      const b = new Uint8Array(await sf.file.arrayBuffer());
      return { sf, buf: b, info: SSRuntimeManager.extractPackInfo(b) };
    }));
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
    // runtime won't load their textures for us — we must (09_mask peer: PackResolver §87).
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
    if (missingPacks.length > 0) setStatus(`Missing instance pack(s): ${[...new Set(missingPacks)].join(', ')} — include them in the dropped folder.`);

    // Resolve every involved ssab's textures to a dropped file (data URL → <img> src),
    // each relative to ITS own ssab's directory. Textures embedded in the ssab
    // (converter `--embedded` mode) are skipped here — the player decodes them
    // from the ssab's own bytes in loadTextures, so no sibling file is needed.
    const textures = new Map<number, string>();
    const missingTex: string[] = [];
    for (const { buf, baseDir } of involved) {
      const embedded = new Set(SSRuntimeManager.extractEmbeddedTextures(buf).map((e) => e.hash >>> 0));
      for (const { hash, path } of SSRuntimeManager.extractTexturePaths(buf)) {
        if (textures.has(hash)) continue;
        if (embedded.has(hash >>> 0)) continue;
        const expected = resolveRelativePath(baseDir, path);
        const texFile = droppedFiles.find((f) => f.path === expected);
        if (!texFile) { missingTex.push(expected); continue; }
        textures.set(hash, await fileToDataUrl(texFile.file));
      }
    }
    if (missingTex.length > 0) setStatus(`Missing texture(s): ${[...new Set(missingTex)].join(', ')}`);

    await player.loadBuffer(ssabBuffer, textures);
    const anims = SSRuntimeManager.extractAnimationNames(rootBuf);
    populateAnimations(anims);
    if (anims.length > 0) await playAnimation(anims[0]);
    setStatus(`Loaded ${ssabObj.file.name} (${anims.length} animation${anims.length === 1 ? '' : 's'})`);
  };

  // ssab dropdown: value is a dropped path (if any) or a bundled URL.
  ssabSelect.addEventListener('change', () => {
    const value = ssabSelect.value;
    const dropped = droppedSsabs.get(value);
    (dropped ? loadDropped(dropped) : loadBundled(value)).catch((e) => setStatus(`Error: ${e?.message ?? e}`));
  });

  // animation dropdown
  animSelect.addEventListener('change', () => {
    playAnimation(animSelect.value).catch((e) => setStatus(`Error: ${e?.message ?? e}`));
  });

  // --- Drag & drop a folder (or files) of ssab + textures ---
  window.addEventListener('dragover', (e) => { e.preventDefault(); dropOverlay?.classList.add('active'); });
  window.addEventListener('dragleave', (e) => { if (e.target === dropOverlay) dropOverlay?.classList.remove('active'); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropOverlay?.classList.remove('active');
    if (!e.dataTransfer) return;
    try {
      droppedFiles = await collectDroppedFiles(e.dataTransfer);
      const ssabs = sortByPath(droppedFiles.filter((f) => f.path.toLowerCase().endsWith('.ssab')));
      if (ssabs.length === 0) { setStatus('No .ssab file found in the dropped items.'); return; }

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

      // Repopulate the ssab dropdown with the dropped ssab paths.
      droppedSsabs = new Map(ssabs.map((f) => [f.path, f]));
      ssabSelect.innerHTML = '';
      for (const f of ssabs) {
        const opt = document.createElement('option');
        opt.value = f.path;
        opt.textContent = f.path;
        ssabSelect.appendChild(opt);
      }
      ssabSelect.value = primary.path;
      await loadDropped(primary);
    } catch (err) {
      setStatus(`Error loading dropped files: ${(err as Error)?.message ?? err}`);
      console.error(err);
    }
  });

  // Initial bundled load.
  await loadBundled(ssabSelect.value);
}

main().catch(console.error);
