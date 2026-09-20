// The plugin manager panel — the one piece of editor chrome a plugin owns.
//
// Everything else this plugin contributes is a component, and a component is
// placed in a scenario. That is a problem for one job in particular: a `.sspj`
// dropped into the source folder while the builder is open. The per-pack
// Reconvert lives on an `[ss_new]`, and an `[ss_new]` cannot name a pack that
// does not exist yet, so there was nowhere to press and reopening the project
// was the only way in.
//
// This panel is the way out. `js/app/window/window.js` fills `.plugin_text`
// with jQuery's `.html()` — not `.text()` — when the author selects a plugin in
// the list, so a plugin's description may contain controls. Establishing that
// took undoing the file's string-array obfuscation; it is not guessable, and it
// is the single fact this whole surface rests on.
//
// It reads `plugin_text` off the live plugin instance
// (`app.plugin.map_plugin[id]`) at every selection, so the string may be
// rewritten after the constructor has run — which is how the version line gets
// there: the converter reports its schema versions asynchronously, long before
// anyone opens this panel.
//
// The panel is opened from the editor's own menu (`menu-plugin_manage` in
// `js/main/MenuBar.js`, labelled "プラグイン"), so it is reachable whatever the
// author has or has not placed in the scenario.
//
// The handler is delegated from `document` rather than bound to the button: the
// host re-renders `.plugin_text` on every change of the plugin list, and the
// element we are given here does not exist yet at the moment it is written.

import type { JQueryLike, TB } from './builderTypes.js';

/** Marks the panel's buttons, and are the selectors the handlers use. */
const IMPORT_BUTTON_CLASS = 'ss-import-now';
const SOURCE_BUTTON_CLASS = 'ss-open-source';
const LOG_BUTTON_CLASS = 'ss-open-log';

/**
 * jQuery event namespace. `loadPlugins()` runs more than once per session —
 * project open, `.tbp` install, any plugin added or removed — rebuilding every
 * plugin each time, so binding must be able to replace its own predecessor
 * without disturbing anything else on `document`.
 */
const EVENT = 'click.ssplayer';

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Text bound for markup. Exported because the panel is not the only thing this
 * plugin writes as HTML — the run report is an alertify dialog, and a converter
 * error carrying a `<` must not be able to open a tag there either.
 */
export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function button(cls: string, label: string): string {
  return (
    `<input type="button" class="${cls} btn btn-info btn-sm" ` +
    `value="${escapeAttr(label)}" style="margin-right:8px" />`
  );
}

/** What the panel is asked to show. */
export interface PanelContent {
  /**
   * False when the plugin could not reach the filesystem bridge, which is the
   * one state where pressing Import now could not do anything.
   */
  withImport: boolean;
  /** False when the host did not publish Electron's `shell`. */
  withFolders: boolean;
  /**
   * The build line, e.g. `converter 7.0.0 (ssab v1, ssqb v1)`. Empty until the
   * converter has started, since only it can say what it emits; the panel is
   * rendered again from the instance each time it is opened, so a line that
   * arrives after the constructor still lands.
   */
  version: string;
}

/** What the panel shows for this plugin: what it does, and what it can do now. */
export function panelHtml(t: (text: string) => string, content: PanelContent): string {
  const parts = [
    `<p>${escapeText(
      t(
        'Put a SpriteStudio project (.sspj and its folder) in SpriteStudio_Source and it is converted each time the project is opened. After editing in SpriteStudio, use "Reconvert now" on a SpriteStudio: show component. Place the animation from the SpriteStudio components in the palette.',
      ),
    )}</p>`,
  ];

  const controls = [
    content.withImport ? button(IMPORT_BUTTON_CLASS, t('Import now')) : '',
    content.withFolders ? button(SOURCE_BUTTON_CLASS, t('Open the source folder')) : '',
    content.withFolders ? button(LOG_BUTTON_CLASS, t('Open the import log')) : '',
  ].filter(Boolean);

  if (controls.length > 0) {
    parts.push(`<p style="margin-top:12px">${controls.join('')}</p>`);
  }
  if (content.withImport) {
    parts.push(
      `<p>${escapeText(
        t(
          'Converts anything added to or edited in SpriteStudio_Source since this project was opened — use it after adding a new project, which no component can point at yet.',
        ),
      )}</p>`,
    );
  }
  if (content.version) {
    // Not translated: it is the line an author copies into a bug report.
    parts.push(
      `<p style="margin-top:12px;opacity:.7"><small>${escapeText(content.version)}</small></p>`,
    );
  }

  return parts.join('');
}

/** What each of the panel's buttons does. */
export interface PanelHandlers {
  /** Takes the button, so the caller can disable it and put a label on it. */
  import: (button: JQueryLike) => void;
  openSource: () => void;
  openLog: () => void;
}

/**
 * Make the panel's buttons work. Returns false when the host did not hand over
 * a usable jQuery, in which case they are inert and the author's way in is
 * still to reopen the project.
 */
export function bindPanelButtons($: TB['$'] | undefined, handlers: PanelHandlers): boolean {
  if (typeof $ !== 'function') return false;

  // Reached through `globalThis` rather than as a bare global: this module is
  // also loaded outside a renderer, where naming `document` directly would be a
  // ReferenceError rather than a `false`.
  const root = (globalThis as { document?: unknown }).document;
  if (!root) return false;

  const bound = $(root);
  if (typeof bound?.on !== 'function' || typeof bound.off !== 'function') return false;

  // Replace rather than add: this same plugin, rebuilt, must not end up with
  // two handlers converting at once. One `off` for the namespace, because it
  // covers every selector bound under it.
  bound
    .off(EVENT)
    .on(EVENT, `.${IMPORT_BUTTON_CLASS}`, (event) => {
      handlers.import($(event.currentTarget));
    })
    .on(EVENT, `.${SOURCE_BUTTON_CLASS}`, () => {
      handlers.openSource();
    })
    .on(EVENT, `.${LOG_BUTTON_CLASS}`, () => {
      handlers.openLog();
    });
  return true;
}
