// The transport, the marker strip and the event list: a seek bar, a strip of
// markers under it in the same coordinate space, and a list of frame / kind /
// part / payload. Clicking either seeks; the marker for a frame the playhead just crossed
// flashes, so the static picture and the live pulse are visibly the same thing.
//
// **The strip fills itself from playback.** There is no "list every event this
// animation authors" call to fill it from, and deliberately: the web player
// exposes events only as `onUserData` / `onSignal` / `onAudio` subscriptions,
// and a viewer-shaped API is a cost every face pays forever, for one caller. What
// the pulse gives instead is complete: the runtime reports every frame a tick
// stepped across, not merely the one it landed on, so one pass over the
// animation is the whole table at any frame rate. The honest cost is that a
// marker does not exist until the playhead has been past it once, and the
// preview plays on open, so that is one loop.

import type {
  SSAudioEvent,
  SSPlayer,
  SSSignalEvent,
  SSUserDataEvent,
  Unsubscribe,
} from '@spritestudio/ssplayer-webgl';

/**
 * What the timeline drives: the part of a player every renderer on this page
 * shares, so ssplayer-pixi's player fits it as well as ssplayer-webgl's.
 */
export type TimelinePlayer = Pick<
  SSPlayer,
  | 'startFrame'
  | 'endFrame'
  | 'frameNo'
  | 'play'
  | 'pause'
  | 'resume'
  | 'speedScale'
  | 'subFrameEnabled'
  | 'onFrame'
  | 'onUserData'
  | 'onSignal'
  | 'onAudio'
>;

/** The three things a part can fire, as the strip colours them. */
type EventKind = 'userData' | 'signal' | 'audio';

/** One row of the table, and the two elements that stand for it. */
interface TableEntry {
  frameNo: number;
  kind: EventKind;
  partName: string;
  text: string;
  marker: HTMLElement;
  row?: HTMLTableRowElement;
}

export interface TimelineElements {
  playPause: HTMLButtonElement;
  restart: HTMLButtonElement;
  seek: HTMLInputElement;
  markers: HTMLElement;
  frame: HTMLElement;
  speed: HTMLInputElement;
  speedOut: HTMLElement;
  subFrame: HTMLInputElement;
  events: HTMLElement;
}

const EMPTY_NOTE = 'Events appear here as the animation plays them.';

/** What a user-data / signal / audio event carries, in one line. */
function describe(kind: EventKind, event: SSUserDataEvent | SSSignalEvent | SSAudioEvent): string {
  if (kind === 'userData') {
    const e = event as SSUserDataEvent;
    const parts: string[] = [];
    if (e.str !== undefined) parts.push(JSON.stringify(e.str));
    if (e.integer !== undefined) parts.push(`int=${e.integer}`);
    if (e.point) parts.push(`point(${e.point.x}, ${e.point.y})`);
    if (e.rect) parts.push(`rect(${e.rect.left}, ${e.rect.top}, ${e.rect.right}, ${e.rect.bottom})`);
    return parts.join('  ') || '(empty)';
  }
  if (kind === 'signal') {
    const e = event as SSSignalEvent;
    const args = Object.entries(e.params)
      .map(([id, value]) => `${id}=${value}`)
      .join(', ');
    return `${e.commandId ?? '(no command)'}(${args})`;
  }
  const e = event as SSAudioEvent;
  return `${e.soundName ?? `#${e.soundNameHash}`} ×${e.loopNum}`;
}

export class Timeline {
  private readonly subscriptions: Unsubscribe[] = [];
  /** Everything seen so far, keyed so the same key at the same frame is one entry. */
  private table = new Map<string, TableEntry>();
  /** True while the reader is dragging the thumb, so playback must not move it. */
  private dragging = false;
  private start = 0;
  private end = 0;

  constructor(
    private player: TimelinePlayer,
    private readonly el: TimelineElements,
  ) {
    this.wireTransport();
    this.wireEvents();
    this.reset();
  }

  /**
   * Point the transport at whatever is loaded now and empty the table.
   *
   * Called after every load and every animation change: the frame range is the
   * new animation's, and an event belongs to the animation that fired it.
   */
  reset(): void {
    this.start = this.player.startFrame;
    this.end = this.player.endFrame;
    this.el.seek.min = String(this.start);
    this.el.seek.max = String(this.end);
    this.el.seek.value = String(this.player.frameNo);
    this.el.seek.disabled = false;
    this.el.playPause.disabled = false;
    this.el.restart.disabled = false;
    this.showFrame(this.player.frameNo);
    this.setPlayingLabel(true);

    this.table = new Map();
    this.el.markers.replaceChildren();
    this.el.events.replaceChildren(
      Object.assign(document.createElement('div'), { className: 'empty', textContent: EMPTY_NOTE }),
    );
  }

  private setPlayingLabel(playing: boolean): void {
    this.el.playPause.textContent = playing ? '⏸' : '▶';
    this.el.playPause.dataset.playing = String(playing);
  }

  private showFrame(frame: number): void {
    this.el.frame.textContent = `${frame.toFixed(1)} / ${this.end}`;
  }

  /** Where a frame sits along the bar — the thumb's own space, so they line up. */
  private positionOf(frame: number): string {
    const span = Math.max(1, this.end - this.start);
    const ratio = Math.min(1, Math.max(0, (frame - this.start) / span));
    return `calc(var(--thumb) / 2 + ${ratio} * (100% - var(--thumb)))`;
  }

  private seekTo(frame: number): void {
    // A paused player still draws, so scrubbing while stopped updates the
    // picture — which is the whole point of a preview's seek bar.
    this.player.frameNo = frame;
    this.el.seek.value = String(frame);
    this.showFrame(frame);
  }

  private wireTransport(): void {
    this.el.playPause.addEventListener('click', () => {
      const playing = this.el.playPause.dataset.playing !== 'false';
      if (playing) this.player.pause();
      else this.player.resume();
      this.setPlayingLabel(!playing);
    });

    this.el.restart.addEventListener('click', () => {
      this.player.play();
      this.setPlayingLabel(true);
    });

    this.el.seek.addEventListener('pointerdown', () => {
      this.dragging = true;
    });
    this.el.seek.addEventListener('pointerup', () => {
      this.dragging = false;
    });
    this.el.seek.addEventListener('input', () => {
      this.seekTo(Number(this.el.seek.value));
    });

    this.el.speed.addEventListener('input', () => {
      const scale = Number(this.el.speed.value);
      this.player.speedScale = scale;
      this.el.speedOut.textContent = scale.toFixed(1);
    });

    this.el.subFrame.addEventListener('change', () => {
      this.player.subFrameEnabled = this.el.subFrame.checked;
    });
  }

  private wireEvents(): void {
    this.subscriptions.push(
      // Not while dragging: the reader is holding the thumb, and playback
      // pulling it away is the one thing a scrub must not do.
      this.player.onFrame((frame) => {
        if (this.dragging) return;
        this.el.seek.value = String(frame);
        this.showFrame(frame);
      }),
      this.player.onUserData((e) => this.record('userData', e, e.frameNo, e.partName)),
      this.player.onSignal((e) => this.record('signal', e, e.frameNo, e.partName)),
      this.player.onAudio((e) => this.record('audio', e, e.frameNo, e.partName)),
    );
  }

  /**
   * Drive a different player — the page's renderer switch replaces the player,
   * not just its pack.
   *
   * The transport is wired once and reads `this.player` when clicked, so only
   * the event subscriptions move. The speed and sub-frame the controls still
   * show are handed over, since the new player starts at its own defaults.
   */
  attach(player: TimelinePlayer): void {
    this.dispose();
    this.player = player;
    this.player.speedScale = Number(this.el.speed.value);
    this.player.subFrameEnabled = this.el.subFrame.checked;
    this.wireEvents();
    this.reset();
  }

  /** Stop listening to the player. */
  dispose(): void {
    for (const off of this.subscriptions.splice(0)) off();
  }

  private record(
    kind: EventKind,
    event: SSUserDataEvent | SSSignalEvent | SSAudioEvent,
    frameNo: number,
    partName: string | null,
  ): void {
    const part = partName ?? `#${event.partIndex}`;
    const text = describe(kind, event);
    // `frameNo` is the frame the key is authored on, not the frame the tick
    // landed on — which is what lets a marker sit where the key is even when
    // one tick crossed several frames.
    const key = `${frameNo}|${kind}|${part}|${text}`;

    const seen = this.table.get(key);
    if (seen) {
      this.flash(seen);
      return;
    }

    const marker = document.createElement('div');
    marker.className = `marker kind-${kind}`;
    marker.style.left = this.positionOf(frameNo);
    marker.title = `frame ${frameNo} · ${kind} · ${part}\n${text}`;
    marker.addEventListener('click', () => this.seekTo(frameNo));
    this.el.markers.append(marker);

    const entry: TableEntry = { frameNo, kind, partName: part, text, marker };
    this.table.set(key, entry);
    this.redrawList();
    this.flash(entry);
  }

  private redrawList(): void {
    const rows = [...this.table.values()].sort(
      (a, b) => a.frameNo - b.frameNo || a.kind.localeCompare(b.kind),
    );

    const body = document.createElement('tbody');
    for (const entry of rows) {
      const tr = document.createElement('tr');
      const cells: (string | Node)[] = [];

      const frameCell = document.createElement('td');
      const dot = document.createElement('span');
      dot.className = `dot kind-${entry.kind}`;
      frameCell.append(dot, String(entry.frameNo));
      cells.push(frameCell);

      for (const text of [entry.kind, entry.partName, entry.text]) {
        const td = document.createElement('td');
        // textContent, not innerHTML: every one of these comes out of a
        // project the reader dropped.
        td.textContent = text;
        cells.push(td);
      }

      tr.append(...cells);
      tr.addEventListener('click', () => this.seekTo(entry.frameNo));
      body.append(tr);
      entry.row = tr;
    }

    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const title of ['frame', 'kind', 'part', 'payload']) {
      const th = document.createElement('th');
      th.textContent = title;
      headRow.append(th);
    }
    head.append(headRow);

    const table = document.createElement('table');
    table.append(head, body);
    this.el.events.replaceChildren(table);
  }

  /** Pulse the marker and the row the playhead just crossed. */
  private flash(entry: TableEntry): void {
    for (const element of [entry.marker, entry.row]) {
      if (!element) continue;
      element.classList.remove('fired');
      void element.offsetWidth; // restart the transition
      element.classList.add('fired');
      setTimeout(() => element.classList.remove('fired'), 320);
    }
  }
}
