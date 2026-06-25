import { Application, Rectangle } from 'pixi.js';
import { SSPlayer } from '@spritestudio/ssplayer-pixi';
import { UIManager, showToast } from './ui/UIManager.js';
import { DropLoader } from './loader/DropLoader.js';
import { extractAnimationNames } from './utils/ssabExtractor.js';

async function main() {
    await SSPlayer.initialize();

    // 1. Setup PixiJS Application
    const app = new Application();
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

    // 4. Setup default animation select for Ringo
    try {
        const response = await fetch('/Ringo.ssab');
        const buffer = await response.arrayBuffer();
        const anims = extractAnimationNames(buffer);
        uiManager.updateAnimationSelect(anims, "run");
    } catch (e) {
        console.warn("Failed to fetch default Ringo.ssab animations", e);
    }

    // 5. Initialize Drag and Drop Loader
    new DropLoader(player, uiManager);
}

main().catch(console.error);
