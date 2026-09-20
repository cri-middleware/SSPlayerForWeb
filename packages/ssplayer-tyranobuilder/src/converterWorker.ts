// The converter, off the editor's UI thread.
//
// Built to `dist/ssplayer.worker.js` as a classic (non-module) script, because
// the plugin starts it from a Blob URL and a module Worker would then try to
// resolve its imports against `blob:` — so everything it needs is inlined.
//
// The Worker has no filesystem: `window.studio_api` is a renderer-only bridge.
// That suits the converter core exactly, since it is environment-agnostic by
// design — bytes in, bytes out — so the UI thread reads the project, this runs
// the wasm, and the UI thread writes the results.
//
// Failures are reported, never thrown: an exception crossing `onmessage` would
// reach the editor as an unhandled worker error with no id attached, and the
// caller waiting on that conversion would hang forever.

import {
  convertProject,
  init,
  ssabSchemaVersion,
  ssqbSchemaVersion,
  version,
} from '@spritestudio/ssconverter-core';

import { CONVERT_OPTIONS, type FromWorker, type ToWorker } from './converterProtocol.js';

/**
 * `self` typed as what a dedicated worker actually is. The DOM lib models the
 * global as a `Window`, whose `postMessage` takes a target origin — wrong shape
 * and wrong arity for this side of the wire.
 */
interface WorkerScope {
  postMessage(message: FromWorker): void;
  onmessage: ((event: { data: ToWorker }) => void) | null;
}

const scope = self as unknown as WorkerScope;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Instantiating the wasm is asynchronous, so a `convert` that arrives while it
 * is still in flight waits on this rather than racing it. Rejects once and
 * stays rejected: a wasm that would not instantiate will not instantiate for
 * the next request either.
 */
let ready: Promise<void> | null = null;

scope.onmessage = (event) => {
  const request = event.data;

  if (request.kind === 'init') {
    ready ??= init(request.wasm).then(() => undefined);
    void ready.then(
      () =>
        scope.postMessage({
          kind: 'ready',
          version: version(),
          schema: { ssab: ssabSchemaVersion(), ssqb: ssqbSchemaVersion() },
        }),
      (error: unknown) => scope.postMessage({ kind: 'unavailable', message: message(error) }),
    );
    return;
  }

  const { id, files } = request;
  void (ready ?? Promise.reject(new Error('convert before init')))
    .then(() => {
      const result = convertProject(files, CONVERT_OPTIONS);
      try {
        // Both maps hold plain JS values — wasm-bindgen copies each byte array
        // out of the wasm heap on the way through — so they stay valid after
        // `free()` and clone cleanly on the way back.
        scope.postMessage({
          kind: 'converted',
          id,
          output: result.output as Map<string, Uint8Array>,
          assets: result.assets as unknown as Map<string, string>,
        });
      } finally {
        // This Worker lives as long as the editor session and converts
        // repeatedly; waiting for the FinalizationRegistry would let the wasm
        // heap grow by a whole project per pass.
        result.free();
      }
    })
    .catch((error: unknown) => {
      scope.postMessage({ kind: 'failed', id, message: message(error) });
    });
};
