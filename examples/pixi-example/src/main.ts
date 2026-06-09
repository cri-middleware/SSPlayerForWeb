import { Application, Assets, Ticker } from 'pixi.js';
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
    await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e, preference: 'webgl' });
    
    const container = document.getElementById('canvas-container');
    if (container) {
        container.insertBefore(app.canvas, container.firstChild);
    } else {
        document.body.appendChild(app.canvas);
    }
    
    // 3. Setup Player
    const player = new SSPlayer();
    
    console.log("Loading animation...");
    await player.load('/Effect.ssab');
    
    // Enable subframe (interpolation)
    player.subframe = true;
    
    await player.setAnimation("anime_1");
    
    player.position.set(640, 480);
    app.stage.addChild(player);
    
    console.log("SSPlayer initialized successfully.");
    
    player.play();

    // 4. Setup UI Controls
    const btnPlayPause = document.getElementById('btn-play-pause') as HTMLButtonElement;
    const seekBar = document.getElementById('seek-bar') as HTMLInputElement;
    const frameDisplay = document.getElementById('frame-display') as HTMLDivElement;
    const speedBar = document.getElementById('speed-bar') as HTMLInputElement;
    const speedDisplay = document.getElementById('speed-display') as HTMLSpanElement;

    let isDraggingSeekBar = false;

    if (btnPlayPause && seekBar && frameDisplay && speedBar && speedDisplay) {
        // Initialize seek bar max
        seekBar.max = player.endFrame.toString();

        btnPlayPause.addEventListener('click', () => {
            if (player.isPausing) {
                player.resume();
                btnPlayPause.textContent = 'Pause';
            } else {
                player.pause();
                btnPlayPause.textContent = 'Play';
            }
        });

        seekBar.addEventListener('mousedown', () => { isDraggingSeekBar = true; });
        seekBar.addEventListener('mouseup', () => { isDraggingSeekBar = false; });
        seekBar.addEventListener('input', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            player.frame = val;
            frameDisplay.textContent = `${Math.floor(val)} / ${player.endFrame}`;
        });

        speedBar.addEventListener('input', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            player.animationSpeed = val;
            speedDisplay.textContent = val.toFixed(1);
        });

        // Update UI every frame
        Ticker.shared.add(() => {
            if (!isDraggingSeekBar && player.isPlaying && !player.isPausing) {
                seekBar.value = player.frame.toString();
                frameDisplay.textContent = `${Math.floor(player.frame)} / ${player.endFrame}`;
            }
        });
    }
}

main().catch(console.error);
