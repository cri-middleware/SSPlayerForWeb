// Minimal ambient types for the TyranoScript runtime surface this adapter
// touches. TyranoScript ships no types; we model only what `[ss_*]` needs.
// Kept intentionally loose — the real object has far more, and we must not
// over-constrain a foreign runtime.

/** A KAG custom tag registered on `TYRANO.kag.ftag.master_tag`. */
export interface TyranoMasterTag {
  /** Attribute names that must be present, or Tyrano raises an error. */
  vital?: string[];
  /** Default values applied to omitted attributes. */
  pm?: Record<string, string | number | boolean>;
  /**
   * Tag body. Receives the merged attribute map. MUST eventually cause
   * `ftag.nextOrder()` to fire (directly, or after an async op) or the scenario
   * stalls.
   */
  start: (pm: Record<string, any>) => void;
}

export interface TyranoFtag {
  master_tag: Record<string, TyranoMasterTag>;
  /** Advance to the next scenario order. */
  nextOrder: () => void;
  /** Invoke another (built-in or custom) tag from JS. */
  startTag: (name: string, pm: Record<string, any>) => void;
}

export interface TyranoConfig {
  /** Game screen width (px). Tyrano stores config values as strings. */
  scWidth?: string | number;
  /** Game screen height (px). */
  scHeight?: string | number;
  [key: string]: unknown;
}

/** Saved game variables (`f`), persisted by Tyrano's save/load. */
export interface TyranoStat {
  f: Record<string, any>;
  /** Id of the character currently speaking (`#name`), `""` when nobody is. */
  current_speaker?: string;
  /** Tyrano's chara definitions, keyed by id (each carries a `jname`). */
  charas?: Record<string, { jname?: string; [key: string]: unknown }>;
  /** Tyrano's reverse map: Japanese display name -> chara id. */
  jcharas?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * TyranoScript's character manager. Only the speaker lookup `[ss_chara]` needs
 * is modelled; everything else on the real object is left untyped.
 */
export interface TyranoChara {
  /** Current speaker; `convertToId` maps a display name to the chara id. */
  getCharaName?(convertToId?: boolean): string;
  [key: string]: unknown;
}

export interface TyranoVariable {
  /** Game variables (save target) — same namespace as `stat.f`. */
  f: Record<string, any>;
  /** System variables (cross-save, not saved). */
  sf: Record<string, any>;
  /** Temporary variables. */
  tf: Record<string, any>;
  [key: string]: unknown;
}

/**
 * TyranoScript's layer manager. `getLayer` is the canonical way to reach a
 * layer element (used by the official Spine plugin) — it returns the layer as a
 * jQuery object, handling the `<number>_<fore|back>` naming and `base`
 * internally, so callers never build (invalid) `.0_fore` selectors themselves.
 */
export interface TyranoLayer {
  getLayer(layer: string | number, page: string): JQueryResult;
  [key: string]: unknown;
}

export interface TyranoKag {
  ftag: TyranoFtag;
  config: TyranoConfig;
  stat: TyranoStat;
  variable: TyranoVariable;
  layer: TyranoLayer;
  /** Optional: absent in tests / very old engines, so `[ss_chara]` guards it. */
  chara?: TyranoChara;
  [key: string]: unknown;
}

export interface TyranoGlobal {
  kag: TyranoKag;
  [key: string]: unknown;
}

/** The tiny slice of jQuery this adapter uses to reach layer `div`s. */
export interface JQueryLike {
  (selector: string): JQueryResult;
}
export interface JQueryResult {
  length: number;
  get(index: number): HTMLElement | undefined;
  append(el: HTMLElement | string): JQueryResult;
  show?(): JQueryResult;
  [index: number]: HTMLElement;
}

declare global {
  // TyranoScript exposes these as browser globals once the engine has booted.
  // Typed as optional so guarded (`typeof TYRANO !== 'undefined'`) access is safe.
  // eslint-disable-next-line no-var
  var TYRANO: TyranoGlobal | undefined;
  interface Window {
    TYRANO?: TyranoGlobal;
    $?: JQueryLike;
  }
}
