// Guards the seam between the two halves of the integration: the builder writes
// `[<key> <param>="…"]`, and @spritestudio/ssplayer-tyranoscript executes it at run
// time. Nothing else ties the two together, so a renamed attribute on either
// side would silently produce scenarios that parse but do nothing.
//
// The oracle is registerTags.ts itself: for each `ftag.master_tag['x'] = {…}`
// block, an attribute is real if it appears in `vital`, in the `pm` defaults, or
// as a `pm.<name>` read. Anything a component emits must be in that set.

import { existsSync, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { BUTTON_PARAM_TYPE, registerButtonParam } from './buttonParam.js';
import { defineSSComponents, type PackChoice } from './components.js';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const REGISTER_TAGS = nodePath.resolve(here, '../../ssplayer-tyranoscript/src/registerTags.ts');

/** Text of the object literal starting at `open` (the index of its `{`). */
function braceBlock(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  return '';
}

interface RuntimeTag {
  /** Everything the tag understands: vital + pm defaults + `pm.<name>` reads. */
  attrs: Set<string>;
  /** Attributes TyranoScript refuses to run the tag without. */
  vital: string[];
}

function runtimeTags(): Map<string, RuntimeTag> {
  const src = readFileSync(REGISTER_TAGS, 'utf8');
  const heads = [...src.matchAll(/ftag\.master_tag\['([a-z0-9_]+)'\]\s*=\s*\{/g)];
  const tags = new Map<string, RuntimeTag>();

  heads.forEach((head, i) => {
    const block = src.slice(head.index, heads[i + 1]?.index ?? src.length);
    const attrs = new Set<string>();

    const vitalMatch = block.match(/vital:\s*\[([^\]]*)\]/);
    const vital = vitalMatch ? [...vitalMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
    for (const name of vital) attrs.add(name);

    const pmAt = block.search(/\bpm:\s*\{/);
    if (pmAt !== -1) {
      const inner = braceBlock(block, block.indexOf('{', pmAt));
      for (const [, key] of inner.matchAll(/([a-zA-Z_]\w*)\s*:/g)) attrs.add(key);
    }

    // Attributes read through a shared helper still show up as `pm.<name>`.
    for (const [, key] of block.matchAll(/\bpm\.([a-zA-Z_]\w*)/g)) attrs.add(key);

    tags.set(head[1], { attrs, vital });
  });

  return tags;
}

const packs: PackChoice[] = [
  { name: 'others/ssdata/Ringo/Ringo.ssab', val: 'others/ssdata/Ringo/Ringo.ssab' },
  { name: 'image/hand-made.ssab', val: 'image/hand-made.ssab' },
];
const animations: Record<string, string[]> = {
  'others/ssdata/Ringo/Ringo.ssab': ['idle', 'walk'],
  'image/hand-made.ssab': ['blink'],
};
const contents: Record<string, PackContents> = {
  'others/ssdata/Ringo/Ringo.ssab': {
    animations: animations['others/ssdata/Ringo/Ringo.ssab'],
    parts: [
      { name: 'root', takesColor: false, takesCell: false },
      { name: 'body', takesColor: true, takesCell: true },
      { name: 'window', takesColor: false, takesCell: true },
    ],
    cellmaps: { Ringo: ['face_a', 'face_b'], Effect: ['spark'] },
  },
  'image/hand-made.ssab': {
    animations: animations['image/hand-made.ssab'],
    parts: [{ name: 'hat', takesColor: true, takesCell: true }],
    cellmaps: { Hand: ['h1'] },
  },
};

function build(overrides: Partial<Parameters<typeof defineSSComponents>[0]> = {}) {
  return defineSSComponents({
    $: undefined as never,
    listPacks: () => packs,
    listAnimations: (storage) => animations[String(storage)] ?? [],
    packContents: (storage) => contents[String(storage)] ?? { animations: [], parts: [], cellmaps: {} },
    reconvert: () => {},
    buttonType: BUTTON_PARAM_TYPE,
    ...overrides,
  });
}

const components = build();

/** The param view the host passes to `select_list`. */
const view = (pm: Record<string, unknown>) => ({ get: () => ({ data: { pm } }) });

describe('defineSSComponents', () => {
  it('defines every component the palette needs', () => {
    expect(Object.keys(components).length).toBeGreaterThan(0);
    for (const [tag, { info, component }] of Object.entries(components)) {
      expect(info.name, `${tag} info.name`).toBeTruthy();
      expect(info.icon, `${tag} info.icon`).toBeTruthy();
      expect(component.component_type, `${tag} component_type`).toBe('Simple');
      // The card template renders `class="tb-i-{{:icon}}"`, so a prefixed value
      // would produce `tb-i-tb-i-…` and show nothing.
      expect(component.default_view.icon, `${tag} icon`).not.toMatch(/^tb-i-/);
      for (const [key, param] of Object.entries(component.param)) {
        expect(param.type, `${tag}.${key} type`).toBeTruthy();
      }
    }
  });

  /**
   * Params that drive an editor action instead of describing a tag attribute,
   * as `<tag>.<param>`. They must never reach the scenario file, so they are
   * exempt from the runtime cross-check below — and listed one by one, because
   * the whole value of that check is that an ordinary param cannot quietly opt
   * out of it.
   */
  const EDITOR_ONLY_PARAMS = new Set(['ss_new.reconvert']);

  it.skipIf(!existsSync(REGISTER_TAGS))('agrees with the tags ssplayer-tyranoscript registers', () => {
    const tags = runtimeTags();
    // A parse that silently found nothing would make this test vacuous.
    expect(tags.size).toBeGreaterThan(10);
    expect(tags.get('ss_new')?.attrs).toContain('storage');

    for (const [tag, { component }] of Object.entries(components)) {
      const runtime = tags.get(tag);
      expect(runtime, `[${tag}] is not registered by ssplayer-tyranoscript`).toBeDefined();

      for (const key of Object.keys(component.param)) {
        if (EDITOR_ONLY_PARAMS.has(`${tag}.${key}`)) continue;
        expect(
          runtime!.attrs.has(key),
          `[${tag} ${key}=] is not read by ssplayer-tyranoscript's ${tag} tag`,
        ).toBe(true);
      }
      // Omitting one of these makes TyranoScript raise at run time.
      for (const name of runtime!.vital) {
        expect(
          Object.keys(component.param),
          `[${tag}] must expose the vital attribute "${name}"`,
        ).toContain(name);
      }
    }
  });

  it.skipIf(!existsSync(REGISTER_TAGS))('starts every vital attribute out filled', () => {
    // The host seeds a placed component with the truthy defaults only, and
    // writes only what it holds: a falsy default on a vital attribute is a tag
    // TyranoScript refuses until the author happens to touch that field.
    (globalThis as { app?: unknown }).app = {
      tyrano: { component: [{ data: { tag_name: 'ss_new', pm: { name: 'chr', storage: packs[0].val } } }] },
    };
    const tags = runtimeTags();
    for (const [tag, { component }] of Object.entries(build())) {
      for (const name of tags.get(tag)?.vital ?? []) {
        const d = component.param[name]?.default_val;
        const value = typeof d === 'function' ? (d as () => unknown)() : d;
        expect(value, `[${tag} ${name}=] default`).toBeTruthy();
      }
    }
    delete (globalThis as { app?: unknown }).app;
  });

  /** Seeded as if the host had stored a value from a default. */
  const placed = () => ({
    data: { tag_name: 'ss_new', pm: { storage: packs[0].val, reconvert: true } },
  });

  it('presses Reconvert on its own pack, and leaves nothing behind in the tag', () => {
    const asked: unknown[] = [];
    const param = build({ reconvert: (s) => asked.push(s) }).ss_new.component.param.reconvert;
    expect(param.type).toBe(BUTTON_PARAM_TYPE);

    const component = placed();
    param.onClick?.(component);

    // Scoped to the pack this component plays, not to every project.
    expect(asked).toEqual([packs[0].val]);
    // Or every [ss_new] the author places carries a meaningless `reconvert=`
    // into the scenario file.
    expect('reconvert' in component.data.pm).toBe(false);
  });

  it('falls back to a momentary tick box when the button could not be registered', () => {
    const asked: unknown[] = [];
    const param = build({ reconvert: (s) => asked.push(s), buttonType: 'Check' }).ss_new.component
      .param.reconvert;
    expect(param.type).toBe('Check');
    // Every Check in the host's own components carries both; leaving them off
    // is the difference between the inspector rendering and not.
    expect(param.name).toBeTruthy();
    expect(param.default_val).toBe(false);

    const component = placed();
    let checked: unknown = true;
    const checkbox = {
      prop: (_name: string, value?: boolean) => {
        if (value !== undefined) checked = value;
        return checked;
      },
    };
    param.onChange?.(undefined, component, checkbox as never);

    expect(asked).toEqual([packs[0].val]);
    expect('reconvert' in component.data.pm).toBe(false);
    // Momentary: the box does not stay ticked, because there is no state to show.
    expect(checked).toBe(false);
  });
});

describe('registerButtonParam', () => {
  /** `Builder.Param.Base.extend`, as Backbone provides it. */
  function fakeBuilder() {
    const Base = {
      extend(proto: Record<string, unknown>) {
        return function View(this: Record<string, unknown>, attrs: Record<string, unknown>) {
          Object.assign(this, proto, {
            get: (key: string) => attrs[key],
          });
        };
      },
    };
    return { Param: { Base } as Record<string, unknown> };
  }

  /** Enough jQuery to build an element and record a click handler. */
  function fake$() {
    const made: { html: string; handlers: Record<string, () => void> }[] = [];
    const $ = (html: string) => {
      const node = { html, handlers: {} as Record<string, () => void>, children: [] as unknown[] };
      made.push(node);
      return {
        append(child: unknown) {
          node.children.push(child);
          return this;
        },
        on(event: string, handler: () => void) {
          node.handlers[event] = handler;
          return this;
        },
      };
    };
    return { $, made };
  }

  it('registers a view that renders a button and calls onClick', () => {
    const builder = fakeBuilder();
    const { $, made } = fake$();
    expect(registerButtonParam($, builder)).toBe(true);

    const View = builder.Param[BUTTON_PARAM_TYPE] as new (attrs: unknown) => {
      createHtml(): unknown;
      valid(): boolean;
    };
    const component = { id: 'the component' };
    let pressed: unknown;
    const view = new View({
      param_name: 'reconvert',
      param: { label: 'Reconvert now', onClick: (c: unknown) => (pressed = c) },
      component,
    });

    view.createHtml();
    const button = made.find((n) => n.html.includes('type="button"'));
    expect(button?.html).toContain('value="Reconvert now"');
    button?.handlers.click();
    expect(pressed).toBe(component);

    // Base.valid() looks the control up by `[name=…]`, which a bare button has
    // none of; there is nothing to validate here anyway.
    expect(view.valid()).toBe(true);
  });

  it('escapes the label rather than injecting it into the attribute', () => {
    const builder = fakeBuilder();
    const { $, made } = fake$();
    registerButtonParam($, builder);
    const View = builder.Param[BUTTON_PARAM_TYPE] as new (attrs: unknown) => { createHtml(): void };
    new View({ param: { label: '" onmouseover="x' }, component: {} }).createHtml();

    const html = made.find((n) => n.html.includes('type="button"'))?.html ?? '';
    // The text may survive as inert data; the quote that would close `value="`
    // and open an event handler beside it may not.
    expect(html).toContain('&quot;');
    expect(html).not.toContain('" onmouseover=');
  });

  it('says no when the host does not expose what it needs', () => {
    const { $ } = fake$();
    expect(registerButtonParam($, undefined)).toBe(false);
    expect(registerButtonParam($, { Param: {} })).toBe(false);
    expect(registerButtonParam(undefined, fakeBuilder())).toBe(false);
  });

  it('registers once, so a plugin rebuild does not swap the class out', () => {
    const builder = fakeBuilder();
    const { $ } = fake$();
    registerButtonParam($, builder);
    const first = builder.Param[BUTTON_PARAM_TYPE];
    expect(registerButtonParam($, builder)).toBe(true);
    expect(builder.Param[BUTTON_PARAM_TYPE]).toBe(first);
  });

  it('offers every pack in the project, and says so when there are none', () => {
    const storage = components.ss_new.component.param.storage;
    expect(storage.select_list?.(view({}))).toEqual(packs);
    expect(storage.default_val).toBeTypeOf('function');
    expect((storage.default_val as () => string)()).toBe(packs[0].val);

    const empty = build({ listPacks: () => [] });
    const list = empty.ss_new.component.param.storage.select_list?.(view({})) ?? [];
    expect(list).toHaveLength(1);
    expect(list[0].val).toBe('');
    expect(list[0].name).toMatch(/SpriteStudio_Source/);
  });

  it('lists the animations of the selected pack, starting on the first', () => {
    const anime = components.ss_new.component.param.anime;
    expect(anime.select_list?.(view({ storage: 'others/ssdata/Ringo/Ringo.ssab' }))).toEqual([
      { name: 'idle', val: 'idle' },
      { name: 'walk', val: 'walk' },
    ]);
    // A freshly placed component is playable without opening either dropdown:
    // the first pack's first animation.
    expect((anime.default_val as () => string)()).toBe('idle');
  });

  it('falls back to anime="" for a pack it cannot read', () => {
    const anime = components.ss_new.component.param.anime;
    const list = anime.select_list?.(view({ storage: 'https://example.com/Boss.ssab' })) ?? [];
    // Empty value = "the pack's first animation" to the runtime, so the
    // component stays valid even when the list is unknown.
    expect(list).toHaveLength(1);
    expect(list[0].val).toBe('');
  });

  it('never traps a value the scan cannot see', () => {
    // A pack served from a CDN, or produced outside the project.
    const remote = 'https://example.com/packs/Boss.ssab';
    const storage = components.ss_new.component.param.storage;
    const list = storage.select_list?.(view({ storage: remote })) ?? [];
    expect(list.map((o) => o.val)).toContain(remote);

    // Likewise an animation name this pack does not contain: keep it selected
    // and flag it, rather than silently switching to another animation.
    const anime = components.ss_new.component.param.anime;
    const options =
      anime.select_list?.(view({ storage: 'image/hand-made.ssab', anime: 'walk' })) ?? [];
    const kept = options.find((o) => o.val === 'walk');
    expect(kept).toBeDefined();
    expect(kept!.name).not.toBe('walk');
  });

  it('narrows the animation list to the pack that player was created from', () => {
    // A scenario where the same name is reused for a different pack.
    const first = { data: { tag_name: 'ss_new', pm: { name: 'chr', storage: packs[0].val } } };
    const play = { data: { tag_name: 'ss_play', pm: { name: 'chr' } } };
    const second = { data: { tag_name: 'ss_new', pm: { name: 'chr', storage: packs[1].val } } };
    const later = { data: { tag_name: 'ss_play', pm: { name: 'chr' } } };
    (globalThis as { app?: unknown }).app = {
      tyrano: { component: [first, play, second, later] },
    };

    const anime = build().ss_play.component.param.anime;
    const asView = (c: unknown) => ({ get: () => c });

    // The nearest *preceding* [ss_new] decides, not just any of them.
    expect(anime.select_list?.(asView(play))?.slice(1).map((o) => o.val)).toEqual(['idle', 'walk']);
    expect(anime.select_list?.(asView(later))?.slice(1).map((o) => o.val)).toEqual(['blink']);

    delete (globalThis as { app?: unknown }).app;
  });

  it('offers every animation in the project when the pack cannot be told', () => {
    // The player was created in another .ks, so nothing here says which pack it
    // is — better to over-offer than to show an empty dropdown.
    delete (globalThis as { app?: unknown }).app;
    const list = components.ss_play.component.param.anime.select_list?.(view({ name: 'chr' })) ?? [];
    expect(list[0].val).toBe('');
    expect(list.slice(1).map((o) => o.val)).toEqual(['blink', 'idle', 'walk']);
  });

  // --- Part overrides: pickers fed from the pack's own tables ----------------

  /** A scenario with player `chr` created from the Ringo pack, then `tag` on it. */
  const scenarioWith = (tag: string, pm: Record<string, unknown> = {}) => {
    const created = { data: { tag_name: 'ss_new', pm: { name: 'chr', storage: packs[0].val } } };
    const placed = { data: { tag_name: tag, pm: { name: 'chr', ...pm } } };
    (globalThis as { app?: unknown }).app = { tyrano: { component: [created, placed] } };
    return { get: () => placed };
  };

  it('starts part and cell pickers on the first entry the player\'s pack offers', () => {
    (globalThis as { app?: unknown }).app = {
      tyrano: { component: [{ data: { tag_name: 'ss_new', pm: { name: 'chr', storage: packs[0].val } } }] },
    };
    const first = (tag: string, param: string) => {
      const d = build()[tag].component.param[param].default_val;
      return typeof d === 'function' ? (d as () => unknown)() : d;
    };
    expect(first('ss_part_color', 'part')).toBe('body'); // the first normal part, not 'root'
    expect(first('ss_part_visible', 'part')).toBe('root');
    expect(first('ss_part_cell', 'cellmap')).toBe('Ringo');
    expect(first('ss_part_cell', 'cell')).toBe('face_a');
    delete (globalThis as { app?: unknown }).app;
  });

  it('offers only the parts each override applies to, from the player\'s pack', () => {
    const list = (tag: string) =>
      build()[tag].component.param.part.select_list?.(scenarioWith(tag))?.map((o) => o.val);

    expect(list('ss_part_color')).toEqual(['body']); // normal parts only
    expect(list('ss_part_cell')).toEqual(['body', 'window']); // normal and mask
    expect(list('ss_part_visible')).toEqual(['root', 'body', 'window']);
    expect(list('ss_part_clear')).toEqual(['', 'root', 'body', 'window']); // '' = every part
    delete (globalThis as { app?: unknown }).app;
  });

  it('offers the cell maps of the player\'s pack, and the cells of the chosen one', () => {
    const param = build().ss_part_cell.component.param;
    expect(param.cellmap.select_list?.(scenarioWith('ss_part_cell'))?.map((o) => o.val)).toEqual([
      'Ringo',
      'Effect',
    ]);
    const cells = param.cell.select_list?.(scenarioWith('ss_part_cell', { cellmap: 'Ringo' }));
    expect(cells?.map((o) => o.val)).toEqual(['face_a', 'face_b']);
    delete (globalThis as { app?: unknown }).app;
  });

  it('offers every pack\'s parts when the player\'s pack cannot be told', () => {
    delete (globalThis as { app?: unknown }).app;
    const part = build().ss_part_color.component.param.part;
    expect(part.select_list?.(view({ name: 'chr' }))?.map((o) => o.val)).toEqual(['body', 'hat']);
  });

  it('writes the colour the way the builder\'s colour picker stores it', () => {
    // TyranoScript's own notation; [ss_part_color] reads it as well as #RRGGBB.
    const color = build().ss_part_color.component.param.color;
    expect(color.type).toBe('Color');
    expect(color.default_val).toBe('0xff0000');
  });

  it('offers the players already placed in the scenario', () => {
    // The editor's live component list for the open scenario.
    (globalThis as { app?: unknown }).app = {
      tyrano: {
        component: [
          { data: { tag_name: 'ss_new', pm: { name: 'akane' } } },
          { data: { tag_name: 'ss_play', pm: { name: 'ignored' } } },
          { data: { tag_name: 'ss_new', pm: { name: 'ringo' } } },
        ],
      },
    };
    const name = build().ss_play.component.param.name;
    expect(name.type).toBe('Select');
    expect(name.select_list?.(view({}))?.map((o) => o.val)).toEqual(['akane', 'ringo']);

    // A player created in another .ks is not in the list, and must survive.
    expect(name.select_list?.(view({ name: 'elsewhere' }))?.map((o) => o.val)).toContain(
      'elsewhere',
    );

    // [ss_new] names the player, so it stays free text.
    expect(build().ss_new.component.param.name.type).toBe('Text');
    delete (globalThis as { app?: unknown }).app;
  });

  it('says so when the scenario has no animation yet', () => {
    delete (globalThis as { app?: unknown }).app;
    const list = build().ss_stop.component.param.name.select_list?.(view({})) ?? [];
    expect(list).toHaveLength(1);
    expect(list[0].val).toBe('');
  });

  it('offers a follow-up animation only when the loop is off', () => {
    const next = components.ss_play.component.param.next;

    // Looping forever: the animation never ends, so nothing could follow it.
    const whileLooping = next.select_list?.(view({ name: 'chr', loop: true })) ?? [];
    expect(whileLooping).toHaveLength(1);
    expect(whileLooping[0].val).toBe('');
    expect(whileLooping[0].name).toMatch(/Loop forever/);

    // Untouched means the checkbox default, which is on.
    expect(next.select_list?.(view({ name: 'chr' }))).toHaveLength(1);

    // Off: the real choice appears.
    const whenOnce = next.select_list?.(view({ name: 'chr', loop: false })) ?? [];
    expect(whenOnce.length).toBeGreaterThan(1);
    expect(whenOnce.map((o) => o.val)).toContain('idle');
  });

  it('stores the loop checkbox itself, because the host stops doing it', () => {
    const changeParam = vi.fn();
    (globalThis as { app?: unknown }).app = { component: { changeParam } };
    const component = { data: { pm: {} } };
    // The host passes `undefined` as the value and the checkbox as the control.
    const checkbox = { prop: () => false } as unknown as Parameters<
      NonNullable<typeof components.ss_play.component.param.loop.onChange>
    >[2];

    components.ss_play.component.param.loop.onChange?.(undefined, component, checkbox);

    expect(changeParam).toHaveBeenCalledWith(component, 'loop', false);
    delete (globalThis as { app?: unknown }).app;
  });

  it('labels a placed component with its player name', () => {
    const model = { data: { pm: { name: 'akane', storage: 'others/ssdata/Ringo/Ringo.ssab' } } };
    expect(components.ss_new.component.header(model)).toBe('akane — Ringo.ssab');
    expect(components.ss_stop.component.header(model)).toBe('akane');
  });
});
