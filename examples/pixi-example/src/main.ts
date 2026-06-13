import { Application } from 'pixi.js';
import { SSPlayer } from '@spritestudio/ssplayer-pixi';
import { UIManager } from './ui/UIManager.js';
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
    
    console.log("SSPlayer initialized successfully.");
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
