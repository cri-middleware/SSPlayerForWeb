// The importer's filesystem, as the builder publishes it.

import { HostFs } from '@spritestudio/ssconverter-importer';

/** Throws unless the builder actually exposed its filesystem bridge. */
export function studioFs(): HostFs {
  const api = window.studio_api;
  if (!api?.fs || !api.path) {
    throw new Error(
      'window.studio_api is unavailable — this plugin only runs inside the TyranoBuilder editor.',
    );
  }
  return new HostFs(api);
}
