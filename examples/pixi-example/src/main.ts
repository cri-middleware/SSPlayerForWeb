import { Application, Rectangle } from 'pixi.js';
import { SSPlayer } from '@spritestudio/ssplayer-pixi';
import { UIManager, showToast } from './ui/UIManager.js';
import { DropLoader } from './loader/DropLoader.js';
import { extractAnimationNames } from './utils/ssabExtractor.js';

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
    
    console.log("Loading default animation...");
    await player.load('/Ringo.ssab');
    await player.setAnimation("run");

    player.subframe = true;
    player.position.set(640, 480);
    app.stage.addChild(player);
    
    // --- Setup Drag and Drop for SSPlayer ---
    player.eventMode = 'dynamic';
    player.cursor = 'pointer';

    let dragging = false;
    let dragOffset = { x: 0, y: 0 };

    player.on('pointerdown', (e) => {
        dragging = true;
        dragOffset.x = player.position.x - e.global.x;
        dragOffset.y = player.position.y - e.global.y;
    });

    app.stage.eventMode = 'static';
    app.stage.hitArea = new Rectangle(0, 0, 1280, 960);

    app.stage.on('pointerup', () => { dragging = false; });
    app.stage.on('pointerupoutside', () => { dragging = false; });
    app.stage.on('pointermove', (e) => {
        if (dragging) {
            player.position.set(e.global.x + dragOffset.x, e.global.y + dragOffset.y);
        }
    });
    // ----------------------------------------
    
    console.log("SSPlayer initialized successfully.");

    // --- Animation event listeners (06_playback_control) ---
    // The runtime fires UserData / Signal / Audio events on the frames they were
    // authored; end/loop are derived from playback state. Drag-drop e.g.
    // UserData.ssab / Signal.ssab / Sound.ssab to see these fire. The runtime
    // plays no audio itself — onAudio hands the sound reference to the host.
    player.onAnimationEnd(() => console.log('[SS][end] animation finished'));
    player.onAnimationLoop(() => console.log('[SS][loop] animation looped'));
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
    const uiManager = new UIManager(player);

    // 4. Populate the SSAB dropdown with the bundled sample assets so any of them
    //    (BlendMode, PartsColor, Effect, Mask, …) can be loaded straight from the
    //    UI, not only via drag & drop. Vite does not glob files under public/, so
    //    the sample list is enumerated explicitly here.
    const SAMPLE_SSABS = [
        'Ringo.ssab', '01-new.ssab', 'Basic.ssab', 'BlendMode.ssab', 'Bounding.ssab',
        'Effect.ssab', 'Instance.ssab', 'Instance_SourceAnime.ssab', 'Interpolation.ssab',
        'Interpolation_Easing_v1.ssab', 'Mask.ssab', 'Mesh.ssab', 'NineSlice.ssab',
        'PartsColor.ssab', 'Ringo_tyu.ssab', 'Shader.ssab', 'Shape.ssab', 'Signal.ssab',
        'Sound.ssab', 'Text.ssab', 'TextureChange.ssab', 'UserData.ssab',
        // Embedded-texture SSABs (converter `--embedded`): the PNG is inlined in
        // the .ssab, so these load with no sibling texture file.
        'Basic_embedded.ssab', 'PartsColor_embedded.ssab', 'Mesh_embedded.ssab',
        'Mask_embedded.ssab', 'Effect_embedded.ssab', 'BlendMode_embedded.ssab',
    ];

    // Load a bundled sample by filename (served from public/ at the site root).
    // Textures and any external instance packs resolve by URL relative to root,
    // matching how the bundled assets are laid out.
    const loadSample = async (name: string) => {
        try {
            await player.load('/' + name);
            const buffer = await (await fetch('/' + name)).arrayBuffer();
            const anims = extractAnimationNames(buffer);
            uiManager.updateAnimationSelect(anims, anims[0]);
            if (anims.length > 0) await player.setAnimation(anims[0]);
            player.position.set(640, 480);
            // Refresh the seek-bar range / frame display for the new animation and
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
        const response = await fetch('/Ringo.ssab');
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
