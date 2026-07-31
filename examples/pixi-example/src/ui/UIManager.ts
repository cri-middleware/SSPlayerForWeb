import { Ticker } from 'pixi.js';
import { SSPlayer } from '@spritestudio/ssplayer-pixi';
import { ViewControls } from '../view/ViewControls.js';

export function showToast(message: string, type: 'info' | 'error' | 'warning' | 'success' = 'info') {
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
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 300); // match CSS transition duration
    }, 5000);
}

export class UIManager {
    private player: SSPlayer;
    private view: ViewControls;
    private btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;
    private btnPlayPause = document.getElementById('btn-play-pause') as HTMLButtonElement;
    private btnResetView = document.getElementById('btn-reset-view') as HTMLButtonElement;
    private seekBar = document.getElementById('seek-bar') as HTMLInputElement;
    private frameDisplay = document.getElementById('frame-display') as HTMLDivElement;
    private speedBar = document.getElementById('speed-bar') as HTMLInputElement;
    private speedDisplay = document.getElementById('speed-display') as HTMLSpanElement;
    public animationSelect = document.getElementById('animation-select') as HTMLSelectElement;
    public ssabSelect = document.getElementById('ssab-select') as HTMLSelectElement;
    public dropZone = document.getElementById('drop-zone');
    private subframeCheck = document.getElementById('subframe-check') as HTMLInputElement;

    private isDraggingSeekBar = false;

    constructor(player: SSPlayer, view: ViewControls) {
        this.player = player;
        this.view = view;
        this.setupControls();
    }

    private setupControls() {
        if (!this.btnPlayPause || !this.seekBar || !this.frameDisplay || !this.speedBar || !this.speedDisplay) {
            return;
        }

        this.seekBar.max = this.player.endFrame.toString();

        this.btnRestart.addEventListener('click', () => {
            this.player.play(this.player.startFrame);
            this.btnPlayPause.textContent = '⏸ Pause';
        });

        this.btnPlayPause.addEventListener('click', () => {
            if (this.player.isPausing) {
                this.player.resume();
                this.btnPlayPause.textContent = '⏸ Pause';
            } else if (!this.player.isPlaying) {
                this.player.play(this.player.startFrame);
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
            this.frameDisplay.textContent = `${val.toFixed(1)} / ${this.player.endFrame}`;
        });

        this.speedBar.addEventListener('input', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            this.player.speedScale = val;
            this.speedDisplay.textContent = val.toFixed(1);
        });

        if (this.subframeCheck) {
            this.subframeCheck.addEventListener('change', (e) => {
                this.player.subFrameEnabled = (e.target as HTMLInputElement).checked;
            });
            this.player.subFrameEnabled = this.subframeCheck.checked;
        }

        // Update UI every frame
        Ticker.shared.add(() => {
            if (!this.isDraggingSeekBar && this.player.isPlaying && !this.player.isPausing) {
                this.seekBar.value = this.player.frame.toString();
                this.frameDisplay.textContent = `${this.player.frame.toFixed(1)} / ${this.player.endFrame}`;
            }
        });

        this.animationSelect.addEventListener('change', async (e) => {
            const animName = (e.target as HTMLSelectElement).value;
            if (animName) {
                this.player.setAnimation(animName);
                this.syncAfterLoad();
            }
        });
    }

    public updateAnimationSelect(anims: string[], defaultAnim?: string) {
        this.animationSelect.innerHTML = '';
        anims.forEach(animName => {
            const opt = document.createElement('option');
            opt.value = animName;
            opt.textContent = animName;
            this.animationSelect.appendChild(opt);
        });

        if (anims.length > 0) {
            this.animationSelect.value = defaultAnim && anims.includes(defaultAnim) ? defaultAnim : anims[0];
        }
    }

    public updateSsabSelect(ssabPaths: string[], primaryPath: string) {
        this.ssabSelect.innerHTML = '';
        ssabPaths.forEach(path => {
            const opt = document.createElement('option');
            opt.value = path;
            opt.textContent = path;
            this.ssabSelect.appendChild(opt);
        });
        this.ssabSelect.style.display = 'block';
        this.ssabSelect.value = primaryPath;
    }

    /**
     * Bring the UI in line with a newly-shown animation: refresh the seek-bar
     * range (otherwise stale from the previous animation), drop the pan/zoom back
     * to the default view so the new animation is on-screen, and start playback.
     */
    public syncAfterLoad() {
        this.seekBar.max = this.player.endFrame.toString();
        this.view.reset();
        this.player.play();
        this.btnPlayPause.textContent = '⏸ Pause';
    }
}
