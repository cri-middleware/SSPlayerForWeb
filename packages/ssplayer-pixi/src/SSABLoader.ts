import { ExtensionType, ExtensionMetadata } from 'pixi.js';
import { SSABResource } from '@spritestudio/ssplayer-core';

export const SSABLoader = {
    name: 'ssab-parser',
    id: 'ssab-parser',
    extension: {
        type: ExtensionType.LoadParser,
        priority: 2,
    } as ExtensionMetadata,

    test(url: string): boolean {
        return url.split('?')[0].endsWith('.ssab');
    },

    async load(url: string): Promise<SSABResource> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`[SSABLoader] Failed to load ssab: ${url} - ${response.statusText}`);
        }
        
        const buffer = await response.arrayBuffer();
        const data = new Uint8Array(buffer);
        
        // Pass data to WASM which takes ownership of the memory inside the heap.
        // We let the JS Uint8Array get garbage collected to avoid double memory.
        const resource = new SSABResource(data);
        
        return resource;
    },

    unload(resource: SSABResource): void {
        resource.destroy();
    }
};
