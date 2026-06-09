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
    await app.init({ width: 800, height: 600, backgroundColor: 0x1099bb });
    document.body.appendChild(app.canvas);
    
    // 3. Load SSAB and Texture
    console.log("Loading assets...");
    const ssab = await Assets.load<any>('/Basic.ssab');
    const texture = await Assets.load<any>('/common.png');
    
    // 4. Setup SSRuntimeManager and Player
    const manager = new SSRuntimeManager();
    // bind the resource
    manager.bindResource(ssab);
    
    const player = new SSPlayer(manager);
    
    // Texture hash logic (for now just apply the same texture to all, or assume 0 is the hash)
    // For Ringo.png, we just set a dummy fallback if we don't know the hash, but let's override `setTexture` 
    // to map automatically. For this example, we hack it by overriding the `textures.get` to return `texture`.
    player.setTexture(0, texture); // We'll patch this inside SSPlayer if hash is dynamic
    // Actually, let's just make a quick workaround for the example:
    (player as any).textures = new Map();
    (player as any).textures.get = () => texture; 

    // Setup animation. Basic.ssae has an animation named "anime_1"
    manager.context.setup_animation("anime_1");
    manager.context.set_loop(0); // Infinite loop
    manager.context.play();
    
    player.position.set(400, 300);
    app.stage.addChild(player);
    
    // Debug frame progression
    setInterval(() => {
        console.log("Current frame:", manager.context.get_frame_no());
    }, 1000);
    
    console.log("SSPlayer initialized successfully.");
    
    player.play();
}

main().catch(console.error);
