import { Application, Assets } from 'pixi.js';
import { SSRuntimeManager } from '@spritestudio/ssplayer-core';
import { SSPlayer, SSABLoader } from '@spritestudio/ssplayer-pixi';
import initWasm from '@spritestudio/ssplayer-core';

// Register the SSAB Loader
Assets.loader.parsers.push(SSABLoader);

async function main() {
    // 1. Initialize WASM
    console.log("Initializing WASM...");
    await initWasm();
    
    // 2. Setup PixiJS Application
    const app = new Application();
    await app.init({ width: 800, height: 600, backgroundColor: 0x1099bb });
    document.body.appendChild(app.canvas);
    
    // 3. (Optional) Load an SSAB file once we have one.
    // For now, we just create the player to verify no errors are thrown.
    const manager = new SSRuntimeManager();
    const player = new SSPlayer(manager);
    
    player.position.set(400, 300);
    app.stage.addChild(player);
    
    console.log("SSPlayer initialized successfully.");
    
    // player.play(); // Uncomment when an animation is loaded
}

main().catch(console.error);
