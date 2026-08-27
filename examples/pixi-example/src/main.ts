import { Application } from 'pixi.js';
import { SSPlayer } from '@spritestudio/ssplayer-pixi';
import { UIManager, showToast } from './ui/UIManager.js';
import { ViewControls } from './view/ViewControls.js';
import { DropLoader } from './loader/DropLoader.js';
import { extractAnimationNames } from './utils/ssabExtractor.js';

// The deploy nests each SS project's output under public/<project>/ (ssconverter
// `--stem-dir`): Ringo's assets live in Ringo/, everything else comes from the
// `overall` test project in overall/. Map a bare sample filename to its URL.
//
// Resolved against the page, not written as a root-absolute '/Ringo/...', so
// this works both at the dev-server root and under the /examples/pixi/ subpath
// the Pages build is served from -- vite's --base rewrites HTML references and
// imported assets, never a string literal like this one. (override-example
// resolves its one asset the same way.)
const ssabUrl = (name: string) =>
    new URL((name.startsWith('Ringo') ? 'Ringo/' : 'overall/') + name, document.baseURI).href;

async function main() {
    await SSPlayer.initialize();

    // 1. Setup PixiJS Application
    const app = new Application();
    // Opaque background. The SpriteStudio backdrop-reading blend modes (Screen /
    // Exclusion / Invert) are now real fixed-function GPU blends that read the live
    // framebuffer, so this background IS the backdrop they composite against — e.g.
    // Invert/Exclusion over this blue invert it toward yellow, matching the editor.
    await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e, preference: 'webgpu' });
    
    const container = document.getElementById('canvas-container');
    if (container) {
        container.insertBefore(app.canvas, container.firstChild);
    } else {
        document.body.appendChild(app.canvas);
    }
    
    // 2. Setup Player
    const player = new SSPlayer();
    // Hand over the renderer before the first draw so the mask coverage pre-pass
    // can run on frame 1 — otherwise masked parts (Mask.ssab in the sample list)
    // are held back for that one frame. Optional; only matters with masks.
    player.attachRenderer(app.renderer);

    console.log("Loading default animation...");
    await player.load(ssabUrl('Ringo.ssab'));
    player.setAnimation("run");

    app.stage.addChild(player);

    // --- Pan (drag) / zoom (wheel) of the animation itself ---
    // Owns the view transform: every newly-shown animation is re-centred and
    // unscaled through view.reset() (called by UIManager.syncAfterLoad).
    const view = new ViewControls(app, player);

    console.log("SSPlayer initialized successfully.");

    // --- Animation event listeners (06_playback_control) ---
    // The runtime fires UserData / Signal / Audio events on the frames they were
    // authored; end/loop are derived from playback state. Drag-drop e.g.
    // UserData.ssab / Signal.ssab / Sound.ssab to see these fire. The runtime
    // plays no audio itself — onAudio hands the sound reference to the host.
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

    player.play();

    // 3. Initialize UI Manager
    const uiManager = new UIManager(player, view);

    // 4. Populate the SSAB dropdown with the bundled sample assets so any of them
    //    (BlendMode, PartsColor, Effect, Mask, …) can be loaded straight from the
    //    UI, not only via drag & drop. Vite does not glob files under public/, so
    //    the sample list is enumerated explicitly here.
    const BASE_SSABS = [
        'Ringo.ssab', '01-new.ssab', 'Basic.ssab', 'BlendMode.ssab', 'Bounding.ssab',
        'Effect.ssab', 'Instance.ssab', 'Instance_SourceAnime.ssab', 'Interpolation.ssab',
        'Interpolation_Easing_v1.ssab', 'Mask.ssab', 'Mesh.ssab', 'NineSlice.ssab',
        'PartsColor.ssab', 'Ringo_tyu.ssab', 'Shader.ssab', 'Shape.ssab', 'Signal.ssab',
        'Sound.ssab', 'Text.ssab', 'TextureChange.ssab', 'UserData.ssab',
    ];
    // Embedded-texture SSABs (converter `--embedded`): the PNG is inlined in the
    // .ssab, so these load with no sibling texture file. Every base sample above has
    // a matching `<name>_embedded.ssab` under public/, so derive the list instead of
    // maintaining it by hand.
    const EMBEDDED_SSABS = BASE_SSABS.map((n) => n.replace(/\.ssab$/, '_embedded.ssab'));
    const SAMPLE_SSABS = [...BASE_SSABS, ...EMBEDDED_SSABS];

    // Load a bundled sample by filename (served from public/ at the site root).
    // Textures and any external instance packs resolve by URL relative to root,
    // matching how the bundled assets are laid out.
    const loadSample = async (name: string) => {
        try {
            await player.load(ssabUrl(name));
            const buffer = await (await fetch(ssabUrl(name))).arrayBuffer();
            const anims = extractAnimationNames(buffer);
            uiManager.updateAnimationSelect(anims, anims[0]);
            if (anims.length > 0) player.setAnimation(anims[0]);
            // Refresh the seek-bar range for the new animation, reset the view and
            // start playback (the seek bar's max is otherwise stale from Ringo).
            uiManager.syncAfterLoad();
        } catch (e) {
            console.error(`Failed to load sample "${name}"`, e);
            showToast(`Failed to load ${name}`, 'error');
        }
    };

    uiManager.updateSsabSelect(SAMPLE_SSABS, 'Ringo.ssab');
    // The DropLoader also listens on this <select>, but its handler only matches
    // dropped files; this one only matches the bundled sample names — so the two
    // never act on the same change.
    uiManager.ssabSelect.addEventListener('change', (e) => {
        const name = (e.target as HTMLSelectElement).value;
        if (SAMPLE_SSABS.includes(name)) void loadSample(name);
    });

    // Default animation list for the initially-loaded Ringo.
    try {
        const response = await fetch(ssabUrl('Ringo.ssab'));
        const buffer = await response.arrayBuffer();
        const anims = extractAnimationNames(buffer);
        uiManager.updateAnimationSelect(anims, "run");
    } catch (e) {
        console.warn("Failed to fetch default Ringo.ssab animations", e);
    }

    // 5. Initialize Drag and Drop Loader (dropping files repopulates the dropdown
    //    with the dropped paths; its change handler ignores the bundled samples).
    new DropLoader(player, uiManager);
}

main().catch(console.error);
