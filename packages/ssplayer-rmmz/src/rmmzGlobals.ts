// Loose ambient views of the RPG Maker MZ / PixiJS v5 globals this plugin
// touches. The real implementations come from the MZ core scripts
// (rmmz_core.js etc.) at runtime; these types just keep the TypeScript honest
// without pulling MZ's untyped source into the build.

export type GL = WebGLRenderingContext | WebGL2RenderingContext;

export interface RMMZBitmap {
  readonly width: number;
  readonly height: number;
  readonly canvas: HTMLCanvasElement;
  isReady(): boolean;
  isError(): boolean;
  retry(): void;
  addLoadListener(cb: (bitmap: RMMZBitmap) => void): void;
}

export interface RMMZImageManager {
  loadBitmap(folder: string, filename: string): RMMZBitmap;
}

export interface RMMZUtils {
  hasEncryptedImages(): boolean;
}

export interface PixiV5Renderer {
  gl: GL;
  resolution: number;
  view: HTMLCanvasElement;
  batch: { flush(): void; setObjectRenderer(objectRenderer: unknown): void };
  geometry: { reset(): void };
  texture: { reset(): void };
  state: { reset(): void };
  shader: { reset(): void };
  framebuffer: { reset(): void };
  plugins: Record<string, unknown>;
}

export interface PixiV5Application {
  renderer: PixiV5Renderer;
}

export interface RMMZGraphics {
  _app?: PixiV5Application | null;
  app?: PixiV5Application | null;
}

// Access globals off globalThis so this module is import-safe outside MZ.
const g = globalThis as unknown as {
  Graphics?: RMMZGraphics;
  ImageManager?: RMMZImageManager;
  Utils?: RMMZUtils;
  PIXI?: any;
};

/** True when running inside an RPG Maker MZ runtime with a live PixiJS app. */
export function isMZ(): boolean {
  return !!(g.PIXI && g.Graphics && (g.Graphics._app || g.Graphics.app));
}

/** The PixiJS v5 renderer MZ created (`Graphics._app.renderer`), or null. */
export function getMZRenderer(): PixiV5Renderer | null {
  const app = g.Graphics?._app ?? g.Graphics?.app ?? null;
  return app ? app.renderer : null;
}

/**
 * The shared WebGL context MZ's Pixi renderer draws into. Everything SS —
 * texture uploads and the SSWebGLRenderer — must use THIS context so it draws
 * into MZ's framebuffer in Z-order (spec §0). Throws if MZ isn't booted yet.
 */
export function getMZGl(): GL {
  const r = getMZRenderer();
  if (!r || !r.gl) {
    throw new Error('[ssplayer-rmmz] RPG Maker MZ WebGL context is not available yet. Create SSPlayer after Scene_Boot.');
  }
  return r.gl;
}

export function getImageManager(): RMMZImageManager | null {
  return g.ImageManager ?? null;
}

/**
 * True when the game was deployed with image encryption on. MZ encrypts (and
 * appends "_" to) images under img/ and audio under audio/ only, but the flag
 * is global — every Bitmap load goes through the decrypt path once it is set.
 */
export function hasEncryptedImages(): boolean {
  return !!g.Utils?.hasEncryptedImages?.();
}

export function getPIXI(): any {
  return g.PIXI;
}

/**
 * Directory URL of the currently-executing plugin script (from
 * document.currentScript), e.g. "https://…/js/plugins/". Valid only during the
 * plugin's synchronous top-level execution — read it at load, not later. Empty
 * string when unavailable. Used to default the WASM path to sit next to the
 * plugin .js, so authors don't have to configure it.
 */
export function getSelfScriptDir(): string {
  const cs = (g as any).document?.currentScript as { src?: string } | null | undefined;
  const src = cs?.src ?? '';
  if (!src) return '';
  const slash = src.lastIndexOf('/');
  return slash >= 0 ? src.slice(0, slash + 1) : '';
}
