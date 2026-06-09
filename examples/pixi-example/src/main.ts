import { Application, Assets } from 'pixi.js';
import { SSRuntimeManager, initializeWasm } from '@spritestudio/ssplayer-core';
import { SSPlayer, SSABLoader } from '@spritestudio/ssplayer-pixi';
import wasmUrl from '@spritestudio/ssplayer-core/wasm/ssruntime_bg.wasm?url';

// Register the SSAB Loader
Assets.loader.parsers.push(SSABLoader);

async function main() {
    // 1. Initialize WASM
    console.log("Initializing WASM...");
    await initializeWasm(wasmUrl);
    
    // 2. Setup PixiJS Application
    const app = new Application();
    await app.init({ width: 1280, height: 960, backgroundColor: 0x1099bb, preference: 'webgl' });
    document.body.appendChild(app.canvas);
    
    // 3. Setup Player
    const player = new SSPlayer();
    
    console.log("Loading animation...");
    await player.load('/PartsColor.ssab');
    
    // Enable subframe (interpolation)
    player.subframe = true;
    
    await player.setAnimation("PartsColor_only");
    
    player.position.set(640, 480);
    app.stage.addChild(player);
    
    // Debug frame progression (optional)
    // player.setDebugVisible(true);
    
    console.log("SSPlayer initialized successfully.");
    
    player.play();
}

main().catch(console.error);
