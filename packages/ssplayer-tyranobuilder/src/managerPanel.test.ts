// The panel is a string the host injects with `.html()`, so what can be
// asserted here is the string and the binding — everything up to the point the
// editor takes over. That it survives the real `window.js` path, and that
// pressing the button converts a project added after the pass, is checked by
// running the built plugin inside an Electron window with the builder's own
// webPreferences; there is nothing about jQuery or the DOM this file could
// stand in for.

import { describe, expect, it, vi } from 'vitest';

import type { JQueryLike, TB } from './builderTypes.js';
import { bindPanelButtons, panelHtml, type PanelContent } from './managerPanel.js';

const identity = (text: string): string => text;

const content = (over: Partial<PanelContent> = {}): PanelContent => ({
  withImport: true,
  withFolders: true,
  version: '',
  ...over,
});

describe('panelHtml', () => {
  it('offers a button when there is something behind it', () => {
    const html = panelHtml(identity, content());
    expect(html).toContain('class="ss-import-now btn btn-info btn-sm"');
    expect(html).toContain('value="Import now"');
  });

  it('says only what the plugin does when it could not reach the filesystem', () => {
    // Pressing anything could not do anything, so nothing is offered.
    const html = panelHtml(identity, content({ withImport: false, withFolders: false }));
    expect(html).not.toContain('input');
    expect(html).toContain('SpriteStudio_Source');
  });

  it('leaves the folder buttons off a host with no shell', () => {
    // `preload.js` publishes Electron's `shell`, but it is undocumented: a
    // build that stopped would leave a button that could not do anything.
    const html = panelHtml(identity, content({ withFolders: false }));
    expect(html).toContain('ss-import-now');
    expect(html).not.toContain('ss-open-source');
    expect(html).not.toContain('ss-open-log');
  });

  it('shows the build line once the converter has reported it', () => {
    // The line an author copies into a bug report: both formats.
    const html = panelHtml(identity, content({ version: 'converter 7.0.0 (ssab v1, ssqb v1)' }));
    expect(html).toContain('converter 7.0.0 (ssab v1, ssqb v1)');
  });

  it('escapes the translation, which lands in an attribute and in markup', () => {
    // `.plugin_text` is rendered with `.html()`; a translator's `&` or `"` must
    // not be able to end the attribute or open a tag.
    const html = panelHtml(() => 'a & b "<i>"', content({ version: '<b>v</b>' }));
    expect(html).toContain('value="a &amp; b &quot;&lt;i&gt;&quot;"');
    expect(html).toContain('<p>a &amp; b "&lt;i&gt;"</p>');
    expect(html).toContain('&lt;b&gt;v&lt;/b&gt;');
    expect(html).not.toContain('<i>');
  });
});

/** A `$` that records what was bound to it, standing in for jQuery. */
function fakeJQuery() {
  const calls = { off: [] as string[], on: [] as string[] };
  // Per selector, because the panel binds three buttons under one namespace
  // and a press has to reach the one it was aimed at.
  const handlers = new Map<string, (event: { currentTarget: unknown }) => void>();

  const $ = vi.fn((selector: unknown) => {
    const node = {
      off(events: string) {
        calls.off.push(events);
        handlers.clear();
        return node;
      },
      on(events: string, delegate: string, fn: (event: { currentTarget: unknown }) => void) {
        calls.on.push(`${events} ${delegate}`);
        handlers.set(delegate, fn);
        return node;
      },
      selector,
    } as unknown as JQueryLike;
    return node;
  }) as unknown as TB['$'];

  return {
    $,
    calls,
    fire: (selector: string, target?: unknown) =>
      handlers.get(selector)?.({ currentTarget: target }),
  };
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

const noHandlers = () => ({ import: vi.fn(), openSource: vi.fn(), openLog: vi.fn() });

describe('bindPanelButtons', () => {
  it('delegates from document, namespaced, replacing its own predecessor', () => {
    const { calls } = withDocument(() => {
      const jq = fakeJQuery();
      expect(bindPanelButtons(jq.$, noHandlers())).toBe(true);
      return jq;
    });

    // Delegated, because the host writes the buttons into the panel long after
    // this runs; namespaced, because `loadPlugins()` re-runs this constructor
    // and two handlers would convert twice. One `off` covers all three, which
    // is the point of binding them under one namespace.
    expect(calls.off).toEqual(['click.ssplayer']);
    expect(calls.on).toEqual([
      'click.ssplayer .ss-import-now',
      'click.ssplayer .ss-open-source',
      'click.ssplayer .ss-open-log',
    ]);
  });

  it('hands the import run the button that was pressed', () => {
    const handlers = noHandlers();
    const button = { id: 'the-button' };
    withDocument(() => {
      const { $, fire } = fakeJQuery();
      bindPanelButtons($, handlers);
      fire('.ss-import-now', button);
    });

    expect(handlers.import).toHaveBeenCalledTimes(1);
    // Wrapped, so the caller can disable it and put a label on it.
    const wrapped = handlers.import.mock.calls[0][0] as unknown as { selector: unknown };
    expect(wrapped.selector).toBe(button);
  });

  it('sends each folder button to its own handler', () => {
    const handlers = noHandlers();
    withDocument(() => {
      const { $, fire } = fakeJQuery();
      bindPanelButtons($, handlers);
      fire('.ss-open-source');
      fire('.ss-open-log');
    });

    expect(handlers.openSource).toHaveBeenCalledTimes(1);
    expect(handlers.openLog).toHaveBeenCalledTimes(1);
    expect(handlers.import).not.toHaveBeenCalled();
  });

  it('reports failure rather than throwing when the host has no jQuery', () => {
    // A constructor that threw would abort loading of every plugin after it.
    expect(bindPanelButtons(undefined, noHandlers())).toBe(false);
  });
});
