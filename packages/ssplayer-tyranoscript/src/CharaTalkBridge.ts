import type { TyranoKag, TyranoMasterTag } from './tyranoTypes.js';

/**
 * "Who is talking, and are they talking right now?" — the hook `[ss_chara]`
 * needs to swap a player between its talk and idle animations, mirroring the
 * `jname` + `lip="text"` behaviour of TyranoScript's character plugins.
 *
 * TyranoScript already brackets character-by-character text output with a pair
 * of lip-sync calls on its built-in `[text]` tag (`startLipSyncWithText` /
 * `stopLipSyncWithText`, added for its own layered-character mouth frames), so
 * we wrap those rather than poll `stat.is_adding_text`. Two consequences worth
 * knowing, both of them desirable:
 *
 *  - In skip / `[nowait]` mode the engine displays the whole line at once and
 *    never calls the pair, so no talk animation flickers past during a skip.
 *  - The stop call also runs when the player clicks to rush the text, so the
 *    idle animation comes back at the moment the text actually finishes.
 *
 * Older engines without that pair fall back to `addChars` / `finishAddingChars`,
 * which bracket the same work one level out.
 */

/** Callbacks driven by the engine's text output. */
export interface TalkHooks {
  /** Text started being typed out; `speaker` is Tyrano's current speaker id. */
  onTalkStart: (speaker: string) => void;
  /** Text finished (or was rushed to the end). */
  onTalkStop: () => void;
}

/** Marker so a second `[ss_chara]` does not wrap the engine methods twice. */
const WRAPPED = '__ssTalkHooked';

type WrappableTextTag = TyranoMasterTag & {
  [WRAPPED]?: boolean;
  startLipSyncWithText?: (...args: unknown[]) => unknown;
  stopLipSyncWithText?: (...args: unknown[]) => unknown;
  addChars?: (...args: unknown[]) => unknown;
  finishAddingChars?: (...args: unknown[]) => unknown;
};

/**
 * Tyrano's current speaker, as an id where one exists. `getCharaName(true)`
 * converts a Japanese display name (`#あかね`) to the registered chara id
 * (`akane`); `stat.current_speaker` is the same value and is the fallback for
 * engines whose `chara` helper is shaped differently.
 */
export function currentSpeaker(kag: TyranoKag): string {
  const chara = kag.chara as { getCharaName?: (convertToId?: boolean) => string } | undefined;
  const viaHelper = typeof chara?.getCharaName === 'function' ? chara.getCharaName(true) : '';
  const speaker = viaHelper || (kag.stat.current_speaker as string | undefined) || '';
  return String(speaker);
}

/**
 * Does `jname` (as written in `[ss_chara jname=]`) name the given speaker?
 * Accepts either side of Tyrano's name/id pair, so both `#あかね` and `#akane`
 * reach a binding written with either spelling.
 */
export function speakerMatches(kag: TyranoKag, jname: string, speaker: string): boolean {
  if (!jname || !speaker) return false;
  if (jname === speaker) return true;
  // Display name -> id (stat.jcharas is Tyrano's own jname->id map).
  const jcharas = kag.stat.jcharas as Record<string, string> | undefined;
  if (jcharas?.[jname] === speaker) return true;
  // id -> display name (the chara definition carries `jname`).
  const charas = kag.stat.charas as Record<string, { jname?: string }> | undefined;
  return charas?.[speaker]?.jname === jname;
}

/**
 * Wrap the engine's text-output bracket so `hooks` fire around every line.
 * Returns `false` when no known hook point exists (a very old or heavily
 * customised engine) — the caller warns and speaker linkage stays inert rather
 * than throwing. Idempotent: wrapping is applied at most once per `[text]` tag.
 */
export function attachTalkHooks(kag: TyranoKag, hooks: TalkHooks): boolean {
  const textTag = kag.ftag.master_tag['text'] as WrappableTextTag | undefined;
  if (!textTag) return false;
  if (textTag[WRAPPED]) return true;

  const wrap = (
    startKey: 'startLipSyncWithText' | 'addChars',
    stopKey: 'stopLipSyncWithText' | 'finishAddingChars',
  ): void => {
    const originalStart = textTag[startKey];
    const originalStop = textTag[stopKey];
    // Assigning here shadows the engine's prototype method (master_tag entries
    // are Object.create'd from tyrano.plugin.kag.tag.*), so the original stays
    // reachable and other plugins wrapping the same method still run.
    textTag[startKey] = function (this: unknown, ...args: unknown[]) {
      try {
        hooks.onTalkStart(currentSpeaker(kag));
      } catch (err) {
        console.error('[ss] speaker hook failed:', (err as Error)?.stack ?? err);
      }
      return originalStart?.apply(this, args);
    };
    textTag[stopKey] = function (this: unknown, ...args: unknown[]) {
      try {
        hooks.onTalkStop();
      } catch (err) {
        console.error('[ss] speaker hook failed:', (err as Error)?.stack ?? err);
      }
      return originalStop?.apply(this, args);
    };
  };

  if (typeof textTag.startLipSyncWithText === 'function' && typeof textTag.stopLipSyncWithText === 'function') {
    wrap('startLipSyncWithText', 'stopLipSyncWithText');
  } else if (typeof textTag.addChars === 'function' && typeof textTag.finishAddingChars === 'function') {
    wrap('addChars', 'finishAddingChars');
  } else {
    return false;
  }

  textTag[WRAPPED] = true;
  return true;
}
