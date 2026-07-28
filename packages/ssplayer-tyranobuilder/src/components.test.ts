// Guards the seam between the two halves of the integration: the builder writes
// `[<key> <param>="…"]`, and @spritestudio/ssplayer-tyrano executes it at run
// time. Nothing else ties the two together, so a renamed attribute on either
// side would silently produce scenarios that parse but do nothing.
//
// The oracle is registerTags.ts itself: for each `ftag.master_tag['x'] = {…}`
// block, an attribute is real if it appears in `vital`, in the `pm` defaults, or
// as a `pm.<name>` read. Anything a component emits must be in that set.

import { existsSync, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { defineSSComponents, type PackChoice } from './components.js';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const REGISTER_TAGS = nodePath.resolve(here, '../../ssplayer-tyrano/src/registerTags.ts');

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

function build(overrides: Partial<Parameters<typeof defineSSComponents>[0]> = {}) {
  return defineSSComponents({
    $: undefined as never,
    listPacks: () => packs,
    listAnimations: (storage) => animations[String(storage)] ?? [],
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

  it.skipIf(!existsSync(REGISTER_TAGS))('agrees with the tags ssplayer-tyrano registers', () => {
    const tags = runtimeTags();
    // A parse that silently found nothing would make this test vacuous.
    expect(tags.size).toBeGreaterThan(10);
    expect(tags.get('ss_new')?.attrs).toContain('storage');

    for (const [tag, { component }] of Object.entries(components)) {
      const runtime = tags.get(tag);
      expect(runtime, `[${tag}] is not registered by ssplayer-tyrano`).toBeDefined();

      for (const key of Object.keys(component.param)) {
        expect(
          runtime!.attrs.has(key),
          `[${tag} ${key}=] is not read by ssplayer-tyrano's ${tag} tag`,
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

  it('offers every animation in the project where the pack is not known yet', () => {
    // [ss_play] names a player, not a pack — the pack is only known at run time.
    const list = components.ss_play.component.param.anime.select_list?.(view({})) ?? [];
    expect(list[0].val).toBe('');
    expect(list.slice(1).map((o) => o.val)).toEqual(['blink', 'idle', 'walk']);
  });

  it('labels a placed component with its player name', () => {
    const model = { data: { pm: { name: 'akane', storage: 'others/ssdata/Ringo/Ringo.ssab' } } };
    expect(components.ss_new.component.header(model)).toBe('akane — Ringo.ssab');
    expect(components.ss_stop.component.header(model)).toBe('akane');
  });
});
