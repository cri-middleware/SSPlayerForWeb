// GUI components for the TyranoBuilder palette.
//
// A component is serialised by the host as `$.tag(key, pm)`, which expands to
// `[<key> attr="value" …]` — so **the map key is the KAG tag name and the param
// keys are its attributes**. That is why these mirror the `[ss_*]` master tags
// registered by `@spritestudio/ssplayer-tyrano` exactly: the builder writes the
// tag, that package executes it at run time.
//
// Two consequences of `$.tag` worth knowing:
//   - every declared param is emitted, blank ones included, so a field left
//     empty becomes `attr=""`. The runtime treats `""` as "not given" for every
//     optional attribute (`num()`, `bool()`, `loopCount()` in registerTags.ts),
//     so blanks fall back to the same defaults a hand-written scenario gets.
//   - there is no escaping, so a value containing `"` would break the tag. The
//     fields here are names, paths and numbers; nothing invites quotes.

import type {
  BuilderComponent,
  BuilderComponentEntry,
  BuilderComponentModel,
  BuilderParam,
  TB,
} from './builderTypes.js';

/** One converted `.ssab`, as a `[ss_new storage=]` value. */
export interface PackChoice {
  name: string;
  val: string;
}

export interface ComponentContext {
  $: TB['$'];
  /**
   * Every `.ssab` in the project. Called lazily, when the inspector renders a
   * `storage` field — the builder asks for the component definitions during
   * boot, before the first import pass has finished, so an eagerly built list
   * would always be one session stale.
   */
  listPacks(): PackChoice[];
  /** Animation names inside one pack; empty when it cannot be read from disk. */
  listAnimations(storage: unknown): string[];
}

/**
 * Names already given to an `[ss_new]` in the scenario being edited.
 *
 * `app.tyrano.component` is the editor's live list of placed components — the
 * same array its own search walks, matching on `data.tag_name`. It covers the
 * open scenario only, exactly like the built-in `target` param, which lists the
 * labels of one file; a name defined in another `.ks` still reaches the dropdown
 * through {@link withCurrent}.
 */
function placedPlayerNames(): string[] {
  const placed = (
    globalThis as { app?: { tyrano?: { component?: { data?: { tag_name?: string; pm?: Record<string, unknown> } }[] } } }
  ).app?.tyrano?.component;
  if (!Array.isArray(placed)) return [];

  const names = new Set<string>();
  for (const component of placed) {
    if (component?.data?.tag_name !== 'ss_new') continue;
    const name = String(component.data.pm?.name ?? '').trim();
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * Values of the component being edited. `select_list` is handed the param
 * *view* (`js/app/param/param.js`), which reaches the component through
 * `.get('component')`, while `name()` / `header()` are handed the component
 * itself — so accept either shape.
 */
function paramsOf(arg: unknown): Record<string, unknown> {
  const view = arg as
    | (Partial<BuilderComponentModel> & { get?: (key: string) => BuilderComponentModel | undefined })
    | undefined;
  const viaGet = typeof view?.get === 'function' ? view.get('component')?.data?.pm : undefined;
  return viaGet ?? view?.data?.pm ?? {};
}

/**
 * Keeps a picker from becoming a cage: whatever the component already holds
 * stays selectable even when the scan cannot see it — a pack kept outside the
 * project, a remote URL, a path assembled from a variable at run time. Without
 * this, opening such a component would show a blank dropdown and the next edit
 * would quietly replace a deliberate value.
 */
function withCurrent(
  options: PackChoice[],
  current: unknown,
  label: (value: string) => string,
): PackChoice[] {
  const value = String(current ?? '');
  if (!value || options.some((o) => o.val === value)) return options;
  return [...options, { name: label(value), val: value }];
}

/** Screen centre, so a freshly placed animation lands somewhere visible. */
function screenCentre(): { x: number; y: number } {
  const config = (globalThis as { app?: { tyrano?: { config?: Record<string, unknown> } } }).app
    ?.tyrano?.config;
  const w = Number(config?.scWidth);
  const h = Number(config?.scHeight);
  return {
    x: Number.isFinite(w) && w > 0 ? Math.round(w / 2) : 640,
    y: Number.isFinite(h) && h > 0 ? Math.round(h / 2) : 480,
  };
}

function pm(component: BuilderComponentModel | undefined): Record<string, unknown> {
  return component?.data?.pm ?? {};
}

export function defineSSComponents(ctx: ComponentContext): Record<string, BuilderComponentEntry> {
  // `$.s` returns the key itself when a translation is missing, so English
  // source strings are safe; `ja.json` shipped beside the plugin localises them.
  const t = (text: string): string =>
    typeof ctx.$?.s === 'function' ? ctx.$.s(text) : text;

  const CATEGORY = 'plugin';

  /** Marks `[ss_new]`'s animation dropdown so `storage`'s onChange can refill it. */
  const ANIME_CLASS = 'select_param_ss_anime';

  const animeOptions = (storage: unknown): PackChoice[] => {
    const names = ctx.listAnimations(storage);
    // A pack this process cannot read (remote, or not converted yet) still needs
    // a usable value: `anime=""` makes the runtime fall back to the first
    // animation, which is what the dropdown would have offered anyway.
    if (names.length === 0) return [{ name: t('(first animation in the pack)'), val: '' }];
    return names.map((anime) => ({ name: anime, val: anime }));
  };

  /** The animation a freshly placed `[ss_new]` starts on: the pack's first. */
  const firstAnimation = (): string => {
    const pack = ctx.listPacks()[0]?.val;
    return pack ? (ctx.listAnimations(pack)[0] ?? '') : '';
  };

  const unknownAnime = (value: string): string => `${value} ${t('(not in this pack)')}`;

  /**
   * Every animation name in the project. `[ss_play]` names a player, not a pack,
   * so which pack it will be driving is only known at run time — the union is as
   * close as a picker can get, and it still beats typing a name from memory.
   */
  const allAnimations = (): string[] => {
    const names = new Set<string>();
    for (const pack of ctx.listPacks()) {
      for (const anime of ctx.listAnimations(pack.val)) names.add(anime);
    }
    return [...names].sort();
  };

  const anyAnimeOptions = (leading: string): PackChoice[] => [
    { name: t(leading), val: '' },
    ...allAnimations().map((anime) => ({ name: anime, val: anime })),
  ];

  /**
   * Refill `[ss_new]`'s animation dropdown when the pack changes. The host hands
   * `onChange` the new value only — no component, no view — so the control is
   * found by class, exactly the way the builder's own `storage`/`target` pair
   * does it (`js/app/component/default.js`).
   */
  const refillAnimations = (storage: unknown): void => {
    const $ = ctx.$;
    if (typeof $ !== 'function') return;

    const select = $('.tb-parameter').find(`.${ANIME_CLASS}`);
    if (!select || select.length === 0) return;

    const previous = select.val();
    const options = animeOptions(storage);
    select.empty();
    for (const option of options) select.append($('<option>').html(option.name).val(option.val));

    // Fire change() rather than just setting the value: that runs the host's own
    // handler, so the component's stored `anime=` follows the new pack instead
    // of keeping a name that pack does not contain. Same animation if the new
    // pack has one by that name, otherwise its first.
    const keep = options.some((o) => o.val === previous) ? previous : (options[0]?.val ?? '');
    select.val(keep).change();
  };

  /** Shared shape: a Simple card carrying nothing but its tag. */
  const simple = (
    icon: string,
    title: string,
    header: BuilderComponent['header'],
    param: Record<string, BuilderParam>,
  ): BuilderComponent => ({
    name: () => t(title),
    header,
    component_type: 'Simple',
    default_view: { base_img_url: '', icon, icon_color: '#00A0E9', category: CATEGORY },
    param_view: {},
    param,
  });

  const entry = (
    icon: string,
    title: string,
    help: string,
    header: BuilderComponent['header'],
    param: Record<string, BuilderParam>,
  ): BuilderComponentEntry => ({
    info: { pro: 0, default: true, name: t(title), help: t(help), icon },
    component: simple(icon, title, header, param),
  });

  /**
   * The name `[ss_new]` gives a player. Free text there — it is the author's to
   * choose — but a dropdown everywhere else, because every other tag has to
   * match it exactly and a typo only shows up as a run-time error.
   */
  const playerName = (help: string): BuilderParam => ({
    type: 'Text',
    name: t('Player name'),
    help: t(help),
    default_val: 'ss',
    validate: { required: true },
  });

  const playerRef = (): BuilderParam => ({
    type: 'Select',
    name: t('Player name'),
    help: t('The name given when the animation was shown.'),
    select_list: (view) => {
      const placed = placedPlayerNames();
      const options =
        placed.length > 0
          ? placed.map((name) => ({ name, val: name }))
          : [{ name: t('(no animation shown in this scene yet)'), val: '' }];
      // A player created in another scenario file is not in the list, and must
      // not be silently replaced by whatever happens to be first.
      return withCurrent(options, paramsOf(view).name, (v) => v);
    },
    default_val: () => placedPlayerNames()[0] ?? 'ss',
  });

  const byName: BuilderComponent['header'] = (c) => String(pm(c).name ?? '');

  const coord = (axis: 'x' | 'y', label: string): BuilderParam => ({
    type: 'Num',
    name: t(label),
    help: t('Position of the animation origin, in game screen pixels.'),
    unit: 'px',
    validate: { number: true },
    default_val: () => screenCentre()[axis],
  });

  const scale: BuilderParam = {
    type: 'Num',
    name: t('Scale'),
    help: t('1 = original size.'),
    validate: { number: true },
    default_val: 1,
  };

  return {
    // -----------------------------------------------------------------------
    // Setup
    // -----------------------------------------------------------------------
    // The runtime is already started by the plugin's own init.ks, which
    // TyranoScript calls via the [plugin name="ssplayer"] that this package
    // writes into plugin_third.ks. So nothing here is required to make an
    // animation play — [ss_init] survives only as the way to reach its audio
    // settings, which it applies before checking whether the runtime is up.
    ss_init: entry(
      'sound',
      'SpriteStudio: sound settings',
      'Changes how sounds embedded in the animations are played. Only needed if you want something other than the defaults — the animation runtime starts on its own.',
      (c) => (String(pm(c).audio) === 'false' ? 'off' : 'on'),
      {
        audio: {
          type: 'Check',
          text: t('Play sounds embedded in the animation'),
          help: t('Routes SpriteStudio audio through TyranoScript.'),
          default_val: true,
        },
        sevolume: {
          type: 'Num',
          name: t('Volume'),
          help: t('0 to 1.'),
          validate: { number: true },
          default_val: 1,
        },
      },
    ),

    // -----------------------------------------------------------------------
    // Display
    // -----------------------------------------------------------------------
    ss_new: entry(
      'chara-in',
      'SpriteStudio: show',
      'Loads an animation pack and displays it on a layer.',
      (c) => {
        const name = String(pm(c).name ?? '');
        const pack = String(pm(c).storage ?? '').split('/').pop() ?? '';
        return pack ? `${name} — ${pack}` : name;
      },
      {
        name: playerName('Any name you like. Later components refer to the animation by it.'),
        storage: {
          type: 'Select',
          name: t('Animation pack'),
          help: t('Any .ssab in the project. Ones in SpriteStudio_Source are converted for you.'),
          select_list: (view) => {
            const packs = ctx.listPacks();
            const options =
              packs.length > 0
                ? packs
                : [{ name: t('(no packs yet — add a .sspj to SpriteStudio_Source)'), val: '' }];
            return withCurrent(options, paramsOf(view).storage, (v) => v);
          },
          default_val: () => ctx.listPacks()[0]?.val ?? '',
          onChange: (value) => refillAnimations(value),
        },
        anime: {
          type: 'Select',
          className: ANIME_CLASS,
          name: t('Animation'),
          help: t('Which animation in the pack to play.'),
          select_list: (view) => {
            const params = paramsOf(view);
            return withCurrent(animeOptions(params.storage), params.anime, unknownAnime);
          },
          // Matches the pack the storage field defaults to, so a freshly placed
          // component is already playable without opening either dropdown.
          default_val: () => firstAnimation(),
        },
        layer: {
          type: 'Text',
          name: t('Layer'),
          help: t('Character layer number, or "base" for the background layer.'),
          default_val: '0',
        },
        x: coord('x', 'X'),
        y: coord('y', 'Y'),
        scale,
        loop: {
          type: 'Check',
          text: t('Loop forever'),
          help: t('Off plays the animation once and holds the last frame.'),
          default_val: true,
        },
        visible: {
          type: 'Check',
          text: t('Show immediately'),
          help: t('Off loads without displaying, so a later "fade in" is instant.'),
          default_val: true,
        },
      },
    ),

    ss_show: entry(
      's-icon-eye',
      'SpriteStudio: fade in',
      'Reveals an animation that was loaded hidden, optionally moving it first.',
      byName,
      {
        name: playerRef(),
        time: {
          type: 'Num',
          name: t('Fade time'),
          unit: t('ms'),
          validate: { number: true },
          default_val: 0,
        },
      },
    ),

    ss_hide: entry(
      's-icon-eye-blocked',
      'SpriteStudio: fade out',
      'Hides an animation without unloading it.',
      byName,
      {
        name: playerRef(),
        time: {
          type: 'Num',
          name: t('Fade time'),
          unit: t('ms'),
          validate: { number: true },
          default_val: 0,
        },
      },
    ),

    // -----------------------------------------------------------------------
    // Playback
    // -----------------------------------------------------------------------
    ss_play: entry(
      's-icon-film',
      'SpriteStudio: change animation',
      'Switches to another animation in the same pack.',
      (c) => {
        const name = String(pm(c).name ?? '');
        const anime = String(pm(c).anime ?? '');
        return anime ? `${name} — ${anime}` : name;
      },
      {
        name: playerRef(),
        anime: {
          type: 'Select',
          name: t('Animation'),
          help: t('Which animation to switch to. Leave unset to replay the current one.'),
          select_list: (view) =>
            withCurrent(
              anyAnimeOptions('(replay the current animation)'),
              paramsOf(view).anime,
              (v) => v,
            ),
          default_val: '',
        },
        loop: {
          type: 'Check',
          text: t('Loop forever'),
          default_val: true,
        },
        next: {
          type: 'Select',
          name: t('Then play'),
          help: t('Animation to hand over to once this one ends — e.g. an entrance into an idle loop.'),
          select_list: (view) =>
            withCurrent(anyAnimeOptions('(nothing)'), paramsOf(view).next, (v) => v),
          default_val: '',
        },
      },
    ),

    ss_stop: entry('game-stop', 'SpriteStudio: stop', 'Stops playback and rewinds.', byName, {
      name: playerRef(),
    }),

    ss_pause: entry(
      's-icon-pause',
      'SpriteStudio: pause',
      'Freezes playback on the current frame.',
      byName,
      { name: playerRef() },
    ),

    ss_resume: entry(
      's-icon-play',
      'SpriteStudio: resume',
      'Resumes a paused animation.',
      byName,
      { name: playerRef() },
    ),

    ss_wait: entry(
      's-icon-hour-glass',
      'SpriteStudio: wait',
      'Holds the scenario until the animation finishes (or completes one loop).',
      byName,
      { name: playerRef() },
    ),

    // -----------------------------------------------------------------------
    // Placement
    // -----------------------------------------------------------------------
    ss_pos: entry(
      's-icon-enlarge',
      'SpriteStudio: place',
      'Moves or scales an animation instantly.',
      byName,
      {
        name: playerRef(),
        x: coord('x', 'X'),
        y: coord('y', 'Y'),
        scale,
      },
    ),

    ss_move: entry(
      's-icon-move-up',
      'SpriteStudio: move',
      'Slides an animation to a new position over time.',
      byName,
      {
        name: playerRef(),
        x: coord('x', 'X'),
        y: coord('y', 'Y'),
        scale,
        time: {
          type: 'Num',
          name: t('Duration'),
          unit: t('ms'),
          validate: { number: true },
          default_val: 500,
        },
        wait: {
          type: 'Check',
          text: t('Wait for the move to finish'),
          help: t('Off lets the story continue while the animation is still moving.'),
          default_val: false,
        },
      },
    ),

    // -----------------------------------------------------------------------
    // All animations at once — for scene changes and menus, where the point is
    // that the author does not have to name each player.
    // -----------------------------------------------------------------------
    ss_fadeout: entry(
      's-icon-eye-blocked',
      'SpriteStudio: fade out all',
      'Fades every animation out together, e.g. at a scene change.',
      () => '',
      {
        time: {
          type: 'Num',
          name: t('Fade time'),
          unit: t('ms'),
          validate: { number: true },
          default_val: 1000,
        },
        wait: {
          type: 'Check',
          text: t('Wait for the fade to finish'),
          default_val: true,
        },
      },
    ),

    ss_fadein: entry(
      's-icon-eye',
      'SpriteStudio: fade in all',
      'Brings back exactly the animations that were on screen before the fade out.',
      () => '',
      {
        time: {
          type: 'Num',
          name: t('Fade time'),
          unit: t('ms'),
          validate: { number: true },
          default_val: 1000,
        },
        wait: {
          type: 'Check',
          text: t('Wait for the fade to finish'),
          default_val: true,
        },
      },
    ),

    ss_pause_all: entry(
      's-icon-pause',
      'SpriteStudio: pause all',
      'Freezes every animation — for a menu or save screen. Ordinary text waits do not stop playback, so this is how you get it to stop.',
      () => '',
      {},
    ),

    ss_resume_all: entry(
      's-icon-play',
      'SpriteStudio: resume all',
      'Resumes every animation paused by "pause all".',
      () => '',
      {},
    ),

    // -----------------------------------------------------------------------
    // Teardown
    // -----------------------------------------------------------------------
    ss_free: entry(
      'chara-out',
      'SpriteStudio: remove',
      'Unloads one animation and frees its memory.',
      byName,
      { name: playerRef() },
    ),

    ss_free_all: entry(
      's-icon-exit',
      'SpriteStudio: remove all',
      'Unloads every animation — handy at a scene change.',
      () => '',
      {},
    ),
  };
}
