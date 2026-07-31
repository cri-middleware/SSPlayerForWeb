// The panel is a string the host injects with `.html()`, so what can be
// asserted here is the string and the binding — everything up to the point the
// editor takes over. That it survives the real `window.js` path, and that
// pressing the button converts a project added after the pass, is checked by
// running the built plugin inside an Electron window with the builder's own
// webPreferences; there is nothing about jQuery or the DOM this file could
// stand in for.

import { describe, expect, it, vi } from 'vitest';

import type { JQueryLike, TB } from './builderTypes.js';
import { bindImportButton, panelHtml } from './managerPanel.js';

const identity = (text: string): string => text;

describe('panelHtml', () => {
  it('offers a button when there is something behind it', () => {
    const html = panelHtml(identity, true);
    expect(html).toContain('class="ss-import-now btn btn-info btn-sm"');
    expect(html).toContain('value="Import now"');
  });

  it('says only what the plugin does when it could not reach the filesystem', () => {
    // Pressing it could not do anything, so it is not offered.
    const html = panelHtml(identity, false);
    expect(html).not.toContain('input');
    expect(html).toContain('SpriteStudio_Source');
  });

  it('escapes the translation, which lands in an attribute and in markup', () => {
    // `.plugin_text` is rendered with `.html()`; a translator's `&` or `"` must
    // not be able to end the attribute or open a tag.
    const html = panelHtml(() => 'a & b "<i>"', true);
    expect(html).toContain('value="a &amp; b &quot;&lt;i&gt;&quot;"');
    expect(html).toContain('<p>a &amp; b "&lt;i&gt;"</p>');
    expect(html).not.toContain('<i>');
  });
});

/** A `$` that records what was bound to it, standing in for jQuery. */
function fakeJQuery() {
  const calls = { off: [] as string[], on: [] as string[] };
  let handler: ((event: { currentTarget: unknown }) => void) | null = null;

  const $ = vi.fn((selector: unknown) => {
    const node = {
      off(events: string) {
        calls.off.push(events);
        handler = null;
        return node;
      },
      on(events: string, delegate: string, fn: (event: { currentTarget: unknown }) => void) {
        calls.on.push(`${events} ${delegate}`);
        handler = fn;
        return node;
      },
      selector,
    } as unknown as JQueryLike;
    return node;
  }) as unknown as TB['$'];

  return { $, calls, fire: (target: unknown) => handler?.({ currentTarget: target }) };
}

/** There is no renderer here; the binding only needs something to delegate from. */
function withDocument<T>(body: () => T): T {
  const global = globalThis as { document?: unknown };
  const original = global.document;
  global.document = { id: 'document' };
  try {
    return body();
  } finally {
    if (original === undefined) delete global.document;
    else global.document = original;
  }
}

describe('bindImportButton', () => {
  it('delegates from document, namespaced, replacing its own predecessor', () => {
    const { $, calls } = withDocument(() => {
      const jq = fakeJQuery();
      expect(bindImportButton(jq.$, () => {})).toBe(true);
      return jq;
    });

    // Delegated, because the host writes the button into the panel long after
    // this runs; namespaced, because `loadPlugins()` re-runs this constructor
    // and two handlers would convert twice.
    expect(calls.off).toEqual(['click.ssplayer']);
    expect(calls.on).toEqual(['click.ssplayer .ss-import-now']);
  });

  it('hands the run the button that was pressed', () => {
    const run = vi.fn();
    const button = { id: 'the-button' };
    withDocument(() => {
      const { $, fire } = fakeJQuery();
      bindImportButton($, run);
      fire(button);
    });

    expect(run).toHaveBeenCalledTimes(1);
    // Wrapped, so the caller can disable it and put a label on it.
    expect((run.mock.calls[0][0] as unknown as { selector: unknown }).selector).toBe(button);
  });

  it('reports failure rather than throwing when the host has no jQuery', () => {
    // A constructor that threw would abort loading of every plugin after it.
    expect(bindImportButton(undefined, () => {})).toBe(false);
  });
});
