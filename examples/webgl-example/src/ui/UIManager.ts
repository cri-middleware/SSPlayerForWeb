import type { SSCanvasPlayer } from '@spritestudio/ssplayer-webgl';
import type { ViewControls } from '../view/ViewControls.js';

export type ToastType = 'info' | 'error' | 'warning' | 'success';

/** Transient message in the top-right corner (mirrors examples/pixi-example). */
export function showToast(message: string, type: ToastType = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  // Add icon based on type
  let icon = 'ℹ️';
  if (type === 'error') icon = '❌';
  else if (type === 'warning') icon = '⚠️';
  else if (type === 'success') icon = '✅';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Remove after 5 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.parentElement?.removeChild(toast);
    }, 300); // match CSS transition duration
  }, 5000);
}

/**
 * The playback panel: restart / play-pause / reset-view buttons, timeline,
 * subframe toggle and speed slider.
 *
 * The ssab and animation dropdowns are *populated* here but their `change`
 * handlers live in main.ts, where the loading (bundled URL vs dropped file)
 * belongs.
 */
export class UIManager {
  private btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;
  private btnPlayPause = document.getElementById('btn-play-pause') as HTMLButtonElement;
  private btnResetView = document.getElementById('btn-reset-view') as HTMLButtonElement;
  private seekBar = document.getElementById('seek-bar') as HTMLInputElement;
  private frameDisplay = document.getElementById('frame-display') as HTMLDivElement;
  private speedBar = document.getElementById('speed-bar') as HTMLInputElement;
  private speedDisplay = document.getElementById('speed-display') as HTMLSpanElement;
  private subframeCheck = document.getElementById('subframe-check') as HTMLInputElement;
  public animationSelect = document.getElementById('animation-select') as HTMLSelectElement;
  public ssabSelect = document.getElementById('ssab-select') as HTMLSelectElement;
  public dropZone = document.getElementById('drop-zone');

  private isDraggingSeekBar = false;

  constructor(private player: SSCanvasPlayer, private view: ViewControls) {
    this.setupControls();
  }

  private get startFrame(): number { return this.player.startFrame; }
  private get endFrame(): number { return this.player.endFrame; }
  private get isPausing(): boolean { return this.player.isPausing; }

  private setupControls() {
    // The seek-bar range is set by syncAfterLoad(), which runs for every loaded
    // animation — this manager is built before the first one exists.
    this.btnRestart.addEventListener('click', () => {
      this.player.play(this.startFrame);
      this.btnPlayPause.textContent = '⏸ Pause';
    });

    this.btnPlayPause.addEventListener('click', () => {
      if (this.isPausing) {
        this.player.resume();
        this.btnPlayPause.textContent = '⏸ Pause';
      } else if (!this.player.isPlaying) {
        this.player.play(this.startFrame);
        this.btnPlayPause.textContent = '⏸ Pause';
      } else {
        this.player.pause();
        this.btnPlayPause.textContent = '▶️ Play';
      }
    });

    this.btnResetView.addEventListener('click', () => this.view.reset());

    this.seekBar.addEventListener('mousedown', () => { this.isDraggingSeekBar = true; });
    this.seekBar.addEventListener('mouseup', () => { this.isDraggingSeekBar = false; });
    this.seekBar.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this.player.frame = val;
      this.frameDisplay.textContent = `${val.toFixed(1)} / ${this.endFrame}`;
    });

    this.speedBar.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this.player.speedScale = val;
      this.speedDisplay.textContent = val.toFixed(1);
    });

    this.subframeCheck.addEventListener('change', (e) => {
      this.player.subFrameEnabled = (e.target as HTMLInputElement).checked;
    });
    this.player.subFrameEnabled = this.subframeCheck.checked;

    // onFrame fires once per advanced frame (never while paused or stopped), so
    // this is exactly the timeline the seek bar should follow.
    this.player.onFrame((frame) => {
      if (this.isDraggingSeekBar) return;
      this.seekBar.value = frame.toString();
      this.frameDisplay.textContent = `${frame.toFixed(1)} / ${this.endFrame}`;
    });
  }

  public updateAnimationSelect(anims: string[], defaultAnim?: string) {
    this.animationSelect.innerHTML = '';
    for (const name of anims) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      this.animationSelect.appendChild(opt);
    }
    this.animationSelect.disabled = anims.length === 0;
    if (anims.length > 0) {
      this.animationSelect.value = defaultAnim && anims.includes(defaultAnim) ? defaultAnim : anims[0];
    }
  }

  public updateSsabSelect(ssabPaths: string[], primaryPath: string) {
    this.ssabSelect.innerHTML = '';
    for (const path of ssabPaths) {
      const opt = document.createElement('option');
      opt.value = path;
      opt.textContent = path;
      this.ssabSelect.appendChild(opt);
    }
    this.ssabSelect.value = primaryPath;
  }

  /**
   * Bring the UI in line with a newly-shown animation: refresh the seek-bar
   * range (otherwise stale from the previous animation), drop the pan/zoom back
   * to the default view so the new animation is on-screen, and start playback.
   */
  public syncAfterLoad() {
    this.seekBar.max = this.endFrame.toString();
    this.view.reset();
    this.player.play();
    this.btnPlayPause.textContent = '⏸ Pause';
  }
}
