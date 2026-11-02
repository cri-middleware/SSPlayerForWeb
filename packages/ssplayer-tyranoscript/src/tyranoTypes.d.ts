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
 * layer element (used by TyranoScript's own character plugins) — it returns the layer as a
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
  /**
   * The engine's author-error display, the one its own tags use for an
   * undefined tag or label. Shows `message` in a dialog headed with the current
   * scenario file and line — only while `debugMenu.visible` is on. It reads the
   * position when called, so a failure reported after the scenario has advanced
   * names the wrong line. Optional: every caller guards it.
   */
  error?: (message: string, replace_map?: Record<string, unknown>) => void;
  /**
   * An effect duration shortened for skip mode — the rule `[chara_show]` and
   * `[chara_hide]` fade through. Returns the engine's short duration while
   * skipping with `skipEffectIgnore` on, and `time` unchanged otherwise, zero
   * included. Optional: every caller guards it.
   */
  cutTimeWithSkip?: (time: number) => number | string;
  /**
   * Run a script with `f` / `sf` / `tf` in scope — the engine's `[eval]`, and
   * how `[input name=]` stores into the variable an author names. Saves `sf`
   * afterwards. Optional: every caller guards it.
   */
  evalScript?: (script: string) => void;
  /**
   * Engine event bus. Optional: older TyranoScript builds have none, so every
   * caller guards it.
   *
   * `event_names` is space-separated and may carry `.namespace` suffixes.
   * Of the options, two matter here: `temp` means "delete this listener when a
   * save is loaded" (so a listener that must survive loads leaves it unset), and
   * `system` marks a listener as the engine's or a plugin's rather than an
   * author's.
   */
  on?: (
    event_names: string,
    callback: (event?: unknown) => void,
    options?: { once?: boolean; system?: boolean; temp?: boolean; priority?: number },
  ) => void;
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
