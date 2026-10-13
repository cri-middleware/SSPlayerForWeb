// The timeline, against a player that only pretends to play.
//
// What a browser is needed for is whether the picture changes; what it is not
// needed for is the table this page builds out of the event pulse, which is
// where the logic is. So the player is a stub that lets a test fire events at
// chosen frames, and everything below is the real DOM the page builds.

import type { SSAudioEvent, SSPlayer, SSSignalEvent, SSUserDataEvent } from '@spritestudio/ssplayer-webgl';
import { beforeEach, describe, expect, it } from 'vitest';

import { Timeline, type TimelineElements } from './timeline.js';

/** A player with a playhead and three event channels, and nothing else. */
function fakePlayer() {
  const listeners = {
    frame: [] as ((frame: number) => void)[],
    userData: [] as ((e: SSUserDataEvent) => void)[],
    signal: [] as ((e: SSSignalEvent) => void)[],
    audio: [] as ((e: SSAudioEvent) => void)[],
  };
  const calls: string[] = [];
  // A real unsubscribe, so a test can tell a player the timeline has let go of
  // from one it is still listening to.
  const subscribe = <T>(list: T[], fn: T) => {
    list.push(fn);
    return () => void list.splice(list.indexOf(fn), 1);
  };

  const player = {
    startFrame: 0,
    endFrame: 20,
    frameNo: 0,
    speedScale: 1,
    subFrameEnabled: true,
    play: () => void calls.push('play'),
    pause: () => void calls.push('pause'),
    resume: () => void calls.push('resume'),
    onFrame: (fn: (frame: number) => void) => subscribe(listeners.frame, fn),
    onUserData: (fn: (e: SSUserDataEvent) => void) => subscribe(listeners.userData, fn),
    onSignal: (fn: (e: SSSignalEvent) => void) => subscribe(listeners.signal, fn),
    onAudio: (fn: (e: SSAudioEvent) => void) => subscribe(listeners.audio, fn),
  };

  return {
    player: player as unknown as SSPlayer,
    raw: player,
    calls,
    fire: {
      frame: (n: number) => listeners.frame.forEach((fn) => fn(n)),
      userData: (e: SSUserDataEvent) => listeners.userData.forEach((fn) => fn(e)),
      signal: (e: SSSignalEvent) => listeners.signal.forEach((fn) => fn(e)),
      audio: (e: SSAudioEvent) => listeners.audio.forEach((fn) => fn(e)),
    },
  };
}

/** The elements index.html supplies, built here rather than parsed from it. */
function elements(): TimelineElements {
  document.body.innerHTML = `
    <button id="playPause" disabled>⏸</button>
    <button id="restart" disabled></button>
    <div class="track">
      <input id="seek" type="range" min="0" max="100" value="0" step="0.1" disabled />
      <div id="markers"></div>
    </div>
    <span id="frame"></span>
    <input id="speed" type="range" min="0.1" max="3" step="0.1" value="1" />
    <span id="speedOut">1.0</span>
    <input id="sub" type="checkbox" checked />
    <div id="events"></div>`;
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  return {
    playPause: byId<HTMLButtonElement>('playPause'),
    restart: byId<HTMLButtonElement>('restart'),
    seek: byId<HTMLInputElement>('seek'),
    markers: byId('markers'),
    frame: byId('frame'),
    speed: byId<HTMLInputElement>('speed'),
    speedOut: byId('speedOut'),
    subFrame: byId<HTMLInputElement>('sub'),
    events: byId('events'),
  };
}

const userData = (over: Partial<SSUserDataEvent> = {}): SSUserDataEvent => ({
  partIndex: 3,
  partName: 'body',
  frameNo: 5,
  str: 'hit',
  source: 0,
  ...over,
});

let el: TimelineElements;
let fake: ReturnType<typeof fakePlayer>;
let timeline: Timeline;

beforeEach(() => {
  el = elements();
  fake = fakePlayer();
  timeline = new Timeline(fake.player, el);
});

describe('the transport', () => {
  it('takes its range from the player, and enables itself', () => {
    expect(el.seek.min).toBe('0');
    expect(el.seek.max).toBe('20');
    expect(el.seek.disabled).toBe(false);
    expect(el.frame.textContent).toBe('0.0 / 20');
  });

  it('follows the playhead, unless the reader is holding the thumb', () => {
    fake.fire.frame(7);
    expect(el.seek.value).toBe('7');

    // Playback pulling the thumb out from under a drag is the one thing a
    // scrub must not do.
    el.seek.dispatchEvent(new Event('pointerdown'));
    fake.fire.frame(12);
    expect(el.seek.value).toBe('7');

    el.seek.dispatchEvent(new Event('pointerup'));
    fake.fire.frame(12);
    expect(el.seek.value).toBe('12');
  });

  it('seeks the player when the bar moves', () => {
    el.seek.value = '9';
    el.seek.dispatchEvent(new Event('input'));
    expect(fake.raw.frameNo).toBe(9);
    expect(el.frame.textContent).toBe('9.0 / 20');
  });

  it('pauses and resumes from one button', () => {
    el.playPause.click();
    expect(fake.calls).toEqual(['pause']);
    expect(el.playPause.textContent).toBe('▶');
    el.playPause.click();
    expect(fake.calls).toEqual(['pause', 'resume']);
    expect(el.playPause.textContent).toBe('⏸');
  });

  it('passes speed and sub-frame straight through', () => {
    el.speed.value = '2.5';
    el.speed.dispatchEvent(new Event('input'));
    expect(fake.raw.speedScale).toBe(2.5);
    expect(el.speedOut.textContent).toBe('2.5');

    el.subFrame.checked = false;
    el.subFrame.dispatchEvent(new Event('change'));
    expect(fake.raw.subFrameEnabled).toBe(false);
  });
});

describe('the event strip', () => {
  it('places a marker in the seek bar’s own coordinate space', () => {
    fake.fire.userData(userData({ frameNo: 5 }));

    const marker = el.markers.querySelector<HTMLElement>('.marker.kind-userData');
    expect(marker).not.toBeNull();
    // Half a thumb in at each end, which is where the thumb centre can reach:
    // 5 of 0..20 is a quarter along.
    expect(marker!.style.left).toBe('calc(var(--thumb) / 2 + 0.25 * (100% - var(--thumb)))');
    expect(marker!.title).toContain('frame 5 · userData · body');
  });

  it('lists frame, kind, part and payload, and seeks from a row', () => {
    fake.fire.userData(userData({ frameNo: 5, str: 'hit', integer: 7 }));

    const row = el.events.querySelector('tbody tr')!;
    expect([...row.children].map((td) => td.textContent)).toEqual([
      '5',
      'userData',
      'body',
      '"hit"  int=7',
    ]);

    (row as HTMLElement).click();
    expect(fake.raw.frameNo).toBe(5);
  });

  it('keeps one entry per authored key, and flashes the repeat', () => {
    // Every loop fires the same keys again; a table that grew a row per pass
    // would be unreadable after ten seconds.
    fake.fire.userData(userData());
    fake.fire.userData(userData());
    expect(el.markers.children).toHaveLength(1);
    expect(el.events.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(el.markers.querySelector('.marker')!.classList.contains('fired')).toBe(true);
  });

  it('separates the three kinds, and orders the list by frame', () => {
    fake.fire.audio({
      partIndex: 1,
      partName: 'sfx',
      frameNo: 12,
      soundListNameHash: 1,
      soundNameHash: 2,
      soundName: 'step',
      loopNum: 2,
      source: 0,
    });
    fake.fire.signal({
      partIndex: 2,
      partName: 'root',
      frameNo: 3,
      active: true,
      commandId: 'Attack',
      params: { power: 10 },
      source: 0,
    });
    fake.fire.userData(userData({ frameNo: 5 }));

    const rows = [...el.events.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.children].map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ['3', 'signal', 'root', 'Attack(power=10)'],
      ['5', 'userData', 'body', '"hit"'],
      ['12', 'audio', 'sfx', 'step ×2'],
    ]);
    expect(el.markers.querySelectorAll('.kind-signal')).toHaveLength(1);
    expect(el.markers.querySelectorAll('.kind-audio')).toHaveLength(1);
  });

  it('shows a payload as text, whatever the project put in it', () => {
    // Every string here came out of a `.sspj` someone dropped on the page.
    fake.fire.userData(userData({ str: '<img src=x onerror=alert(1)>' }));

    const payload = el.events.querySelector('tbody tr td:nth-child(4)')!;
    expect(payload.querySelector('img')).toBeNull();
    expect(payload.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('starts over when the animation does', () => {
    fake.fire.userData(userData());
    expect(el.markers.children).toHaveLength(1);

    // An event belongs to the animation that fired it, and the frame range is
    // the new animation's.
    fake.raw.endFrame = 40;
    new Timeline(fake.player, el).reset();

    expect(el.markers.children).toHaveLength(0);
    expect(el.events.textContent).toContain('Events appear here');
    expect(el.seek.max).toBe('40');
  });
});

describe('a player swapped in', () => {
  // The renderer menu replaces the player; the controls on the page stay.
  it('takes the events, the transport and the settings the controls show', () => {
    el.speed.value = '2';
    el.speed.dispatchEvent(new Event('input'));
    el.subFrame.checked = false;
    el.subFrame.dispatchEvent(new Event('change'));
    fake.fire.userData(userData());

    const next = fakePlayer();
    next.raw.endFrame = 40;
    timeline.attach(next.player);

    // A new player starts at its own defaults; the controls still say 2 and off.
    expect(next.raw.speedScale).toBe(2);
    expect(next.raw.subFrameEnabled).toBe(false);
    // Its range, and an empty table: what the old one fired is not its.
    expect(el.seek.max).toBe('40');
    expect(el.markers.children).toHaveLength(0);

    fake.fire.userData(userData({ frameNo: 9 }));
    expect(el.markers.children).toHaveLength(0);
    next.fire.userData(userData({ frameNo: 9 }));
    expect(el.markers.children).toHaveLength(1);

    el.playPause.click();
    expect(next.calls).toEqual(['pause']);
    expect(fake.calls).toEqual([]);
  });
});
