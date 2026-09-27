// The conversion Worker's bundle, as source — what `AutoImporter`'s
// `workerSource` option takes.
//
// Its own entry so a host that converts only on its own thread never carries
// the string. The Worker is built first (`tsdown.worker.config.ts`) and read in
// by `tsdown.config.ts`, so the two always come from the same build of the
// protocol they speak.

import source from 'virtual:converter-worker';

const workerSource: string = source;
export default workerSource;
