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
// The panel is opened from the editor's own menu (`menu-plugin_manage` in
// `js/main/MenuBar.js`, labelled "プラグイン"), so it is reachable whatever the
// author has or has not placed in the scenario.
//
// The handler is delegated from `document` rather than bound to the button: the
// host re-renders `.plugin_text` on every change of the plugin list, and the
// element we are given here does not exist yet at the moment it is written.

import type { JQueryLike, TB } from './builderTypes.js';

/** Marks the panel's button, and is the selector the delegated handler uses. */
const IMPORT_BUTTON_CLASS = 'ss-import-now';

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

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * What the panel shows for this plugin: what it does, and a button that does
 * it now.
 *
 * `withButton` is false when the plugin could not reach the filesystem bridge,
 * which is the one state where pressing it could not do anything.
 */
export function panelHtml(t: (text: string) => string, withButton: boolean): string {
  const description = escapeText(
    t(
      'Put a SpriteStudio project (.sspj and its folder) in SpriteStudio_Source and it is converted each time the project is opened. After editing in SpriteStudio, use "Reconvert now" on a SpriteStudio: show component. Place the animation from the SpriteStudio components in the palette.',
    ),
  );
  if (!withButton) return `<p>${description}</p>`;

  return (
    `<p>${description}</p>` +
    `<p style="margin-top:12px">` +
    `<input type="button" class="${IMPORT_BUTTON_CLASS} btn btn-info btn-sm" ` +
    `value="${escapeAttr(t('Import now'))}" />` +
    `</p>` +
    `<p>${escapeText(
      t(
        'Converts anything added to or edited in SpriteStudio_Source since this project was opened — use it after adding a new project, which no component can point at yet.',
      ),
    )}</p>`
  );
}

/**
 * Make the panel's button work. Returns false when the host did not hand over a
 * usable jQuery, in which case the button is inert and the author's way in is
 * still to reopen the project.
 */
export function bindImportButton(
  $: TB['$'] | undefined,
  run: (button: JQueryLike) => void,
): boolean {
  if (typeof $ !== 'function') return false;

  // Reached through `globalThis` rather than as a bare global: this module is
  // also loaded outside a renderer, where naming `document` directly would be a
  // ReferenceError rather than a `false`.
  const root = (globalThis as { document?: unknown }).document;
  if (!root) return false;

  const bound = $(root);
  if (typeof bound?.on !== 'function' || typeof bound.off !== 'function') return false;

  // Replace rather than add: this same plugin, rebuilt, must not end up with
  // two handlers converting at once.
  bound.off(EVENT).on(EVENT, `.${IMPORT_BUTTON_CLASS}`, (event) => {
    run($(event.currentTarget));
  });
  return true;
}
