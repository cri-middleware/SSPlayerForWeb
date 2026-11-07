import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  armLiveChain,
  clearLiveChain,
  clearLivePlayer,
  clearLivePlayerEnded,
  deferLiveCommand,
  getLiveStatus,
  markLivePlayerEnded,
  runDeferredLiveCommand,
  setLivePlayer,
} from './liveRegistry.js';
import type { SSPlayer } from '../SSPlayer.js';

const ID = 7;

describe('liveRegistry', () => {
  beforeEach(() => {
    clearLivePlayer(ID);
    setLivePlayer(ID, {} as SSPlayer);
  });

  it('lets waitForSS wait for the next run once a command starts one', () => {
    markLivePlayerEnded(ID);
    expect(getLiveStatus(ID)).toBe('ended');
    clearLivePlayerEnded(ID);
    expect(getLiveStatus(ID)).toBe('playing');
    markLivePlayerEnded(ID);
    expect(getLiveStatus(ID)).toBe('ended');
  });

  it('does not read a sequence entry finishing as the end', () => {
    armLiveChain(ID, () => {}, true);
    markLivePlayerEnded(ID);
    expect(getLiveStatus(ID)).toBe('playing');
    clearLiveChain(ID);
    markLivePlayerEnded(ID);
    expect(getLiveStatus(ID)).toBe('ended');
  });

  it('reads a one-shot finishing as the end, though its return to base is armed', () => {
    armLiveChain(ID, () => {});
    markLivePlayerEnded(ID);
    expect(getLiveStatus(ID)).toBe('ended');
  });

  it('runs a command held for the load once, and the latest of them', () => {
    const earlier = vi.fn();
    const later = vi.fn();
    deferLiveCommand(ID, earlier);
    deferLiveCommand(ID, later);
    runDeferredLiveCommand(ID);
    runDeferredLiveCommand(ID);
    expect(earlier).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('drops a held command when a later command cancels', () => {
    const held = vi.fn();
    deferLiveCommand(ID, held);
    clearLiveChain(ID);
    runDeferredLiveCommand(ID);
    expect(held).not.toHaveBeenCalled();
  });
});
