import { SSCanvasPlayer, SSRuntimeManager } from '@spritestudio/ssplayer-webgl';

async function main() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  console.log("Initializing WASM...");
  // No argument → wasm-bindgen default resolution; the bundler serves the runtime
  // shipped with @spritestudio/ssplayer-core (same as pixi-example). Pass a URL or
  // ArrayBuffer here for a custom/inline wasm instead.
  await SSCanvasPlayer.initialize();
  
  const player = new SSCanvasPlayer(canvas, { autoStart: true });
  player.setTransform({ x: canvas.width / 2, y: canvas.height / 2 });
  player.subFrameEnabled = true;
  
  const select = document.getElementById('ssab-select') as HTMLSelectElement;
  
  const loadSsab = async (url: string) => {
    console.log(`Loading ${url}...`);
    await player.load(url);
    
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const anims = SSRuntimeManager.extractAnimationNames(new Uint8Array(buffer));
    
    if (anims.length > 0) {
      console.log(`Setting animation to ${anims[0]}`);
      await player.setAnimation(anims[0]);
      player.play();
    }
  };

  select.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    loadSsab(target.value).catch(console.error);
  });

  // Automatically select the value that matches the dropdown default
  await loadSsab(select.value);
}

main().catch(console.error);
