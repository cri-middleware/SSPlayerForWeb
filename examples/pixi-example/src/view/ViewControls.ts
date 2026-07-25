import { Application, Container, Rectangle } from 'pixi.js';

// Zoom range for the wheel. Wide enough to inspect a tiny part or to fit a
// large animation, tight enough that a stray scroll can't lose the asset.
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
// Wheel delta → scale factor. exp() keeps the zoom perceptually even (one notch
// always changes the size by the same ratio, whatever the current scale).
const ZOOM_SENSITIVITY = 0.002;

/**
 * Pan (drag) / zoom (wheel) of the animation inside the canvas, plus the
 * default view every newly-shown animation starts from.
 *
 * Dragging is wired on the stage rather than on the player so the whole canvas
 * is grabbable — an animation that is scaled down or dragged off-screen can
 * still be brought back. The DOM controls sit above the canvas, so a click on
 * them never reaches the stage.
 */
export class ViewControls {
    private dragging = false;
    private dragOffset = { x: 0, y: 0 };

    constructor(private app: Application, private target: Container) {
        this.reset();
        this.setupDrag();
        this.setupZoom();
    }

    /**
     * Restore the default view: centred in the canvas, unscaled. Called for every
     * newly-shown animation (ssab load / animation switch) so a pan-and-zoom from
     * the previous one never hides the new one.
     */
    public reset(): void {
        this.target.position.set(this.app.screen.width / 2, this.app.screen.height / 2);
        this.target.scale.set(1);
    }

    private setupDrag(): void {
        const stage = this.app.stage;
        stage.eventMode = 'static';
        stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
        this.app.canvas.style.cursor = 'grab';

        stage.on('pointerdown', (e) => {
            this.dragging = true;
            this.dragOffset.x = this.target.position.x - e.global.x;
            this.dragOffset.y = this.target.position.y - e.global.y;
            this.app.canvas.style.cursor = 'grabbing';
        });

        const endDrag = () => {
            this.dragging = false;
            this.app.canvas.style.cursor = 'grab';
        };
        stage.on('pointerup', endDrag);
        stage.on('pointerupoutside', endDrag);

        stage.on('pointermove', (e) => {
            if (!this.dragging) return;
            this.target.position.set(e.global.x + this.dragOffset.x, e.global.y + this.dragOffset.y);
        });
    }

    private setupZoom(): void {
        // Native listener (not a federated 'wheel' event): PixiJS registers its own
        // wheel listener as passive, so preventDefault() there would be ignored and
        // the browser would zoom the page on ctrl+wheel / trackpad pinch.
        this.app.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.app.canvas.getBoundingClientRect();
            // Canvas CSS size may differ from the stage size — map to stage coords.
            const px = (e.clientX - rect.left) * (this.app.screen.width / rect.width);
            const py = (e.clientY - rect.top) * (this.app.screen.height / rect.height);
            // deltaMode: 0 = pixels, 1 = lines, 2 = pages.
            const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
            this.zoomAt(px, py, Math.exp(-delta * ZOOM_SENSITIVITY));
        }, { passive: false });
    }

    /** Scale about (px, py) so the point under the cursor stays put. */
    private zoomAt(px: number, py: number, factor: number): void {
        const current = this.target.scale.x;
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * factor));
        const k = next / current;
        this.target.position.set(
            px + (this.target.position.x - px) * k,
            py + (this.target.position.y - py) * k,
        );
        this.target.scale.set(next);
    }
}
