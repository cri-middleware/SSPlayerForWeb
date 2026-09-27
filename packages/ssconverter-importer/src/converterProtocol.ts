// What a host and its conversion Worker say to each other.
//
// Shared by two bundles that never meet at run time — the host's plugin on its
// UI thread and `converter.worker.js` inside the Worker — so this file is the
// only thing keeping them agreeing. Both inline it at build time.
//
// Everything here has to survive a structured clone: `Map`, `Uint8Array` and
// strings do, which is the whole payload. Nothing is transferred: the byte
// arrays come from `readFileSync`, across a bridge or not, and may be views
// onto a pooled Node `Buffer`, so detaching one could take unrelated data
// with it. A clone of a few MB is a millisecond; a detached pool is a bug that
// only shows up on small files.

import type { ConvertOptions } from '@spritestudio/ssconverter-core';

/**
 * How the importer always converts: textures stay as sibling files next to the
 * `.ssab` rather than being inlined into it.
 *
 * Defined here because both the Worker and the in-thread fallback must make the
 * same choice — a pack converted one way and refreshed the other would change
 * shape on disk depending on whether the host happened to have a Worker.
 */
export const CONVERT_OPTIONS: ConvertOptions = { embedded: false };

/** The formats a converter build emits — the line people quote in a report. */
export interface SchemaVersions {
  ssab: number;
  ssqb: number;
}

export type ToWorker =
  | { kind: 'init'; wasm: Uint8Array }
  | { kind: 'convert'; id: number; files: Map<string, Uint8Array> };

export type FromWorker =
  /**
   * The wasm is instantiated; `version` identifies the build that did it, and
   * `schema` the formats it emits. Both are read off this side of the wire
   * because the UI thread only instantiates the wasm when it has to convert
   * there itself.
   */
  | { kind: 'ready'; version: string; schema: SchemaVersions }
  /** The Worker started but cannot convert; the caller falls back in-thread. */
  | { kind: 'unavailable'; message: string }
  | { kind: 'converted'; id: number; output: Map<string, Uint8Array>; assets: Map<string, string> }
  | { kind: 'failed'; id: number; message: string };
