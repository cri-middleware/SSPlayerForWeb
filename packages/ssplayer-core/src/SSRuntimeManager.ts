import init, { SSRuntimeContext, SSRuntimeResource, InitOutput, WebCoordinateSystem } from '../wasm/ssruntime.js';
import * as flatbuffers from 'flatbuffers';
import { FrameData } from './fbs/ss/runtime/frame-data.js';

let wasmMemory: WebAssembly.Memory | null = null;
let initPromise: Promise<InitOutput> | null = null;

export async function initializeWasm(wasmUrl?: string | URL): Promise<InitOutput> {
    if (!initPromise) {
        initPromise = init({ module_or_path: wasmUrl }).then(output => {
            wasmMemory = output.memory;
            return output;
        });
    }
    return initPromise;
}

export function getWasmMemory(): WebAssembly.Memory {
    if (!wasmMemory) throw new Error("WASM is not initialized");
    return wasmMemory;
}

const finalizationRegistry = new FinalizationRegistry((heldValue: { free: () => void }) => {
    try {
        heldValue.free();
    } catch (e) {
        console.warn("Error freeing WASM resource in FinalizationRegistry", e);
    }
});

export class SSABResource {
    public raw: SSRuntimeResource;

    constructor(data: Uint8Array) {
        this.raw = new SSRuntimeResource(data);
        finalizationRegistry.register(this, this.raw);
    }

    public destroy() {
        if (this.raw) {
            finalizationRegistry.unregister(this);
            this.raw.free();
            // @ts-ignore
            this.raw = null;
        }
    }
}

export class SSRuntimeManager {
    public context: SSRuntimeContext;

    constructor() {
        this.context = new SSRuntimeContext();
        finalizationRegistry.register(this, this.context);
    }

    public bindResource(resource: SSABResource) {
        this.context.bind_resource(resource.raw);
    }

    public update(deltaSeconds: number) {
        this.context.update(deltaSeconds);
    }

    public getWorldMatrices(): Float32Array {
        const ptr = this.context.get_world_matrices_buf();
        const len = this.context.get_world_matrices_len();
        return new Float32Array(getWasmMemory().buffer, ptr, len);
    }

    public getLocalVertices(): Float32Array {
        const ptr = this.context.get_local_vertices_buf();
        const len = this.context.get_local_vertices_len();
        return new Float32Array(getWasmMemory().buffer, ptr, len);
    }

    public getLocalUVs(): Float32Array {
        const ptr = this.context.get_local_uvs_buf();
        const len = this.context.get_local_uvs_len();
        return new Float32Array(getWasmMemory().buffer, ptr, len);
    }

    public setCoordinateSystem(system: WebCoordinateSystem) {
        this.context.set_coordinate_system(system);
    }

    public getFrameData(frame: number): FrameData | null {
        const ptr = this.context.get_frame_data_buf(frame);
        const len = this.context.get_frame_data_len(frame);
        if (ptr === 0 || len === 0) return null;
        
        const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
        const bb = new flatbuffers.ByteBuffer(buf);
        return FrameData.getRootAsFrameData(bb);
    }

    public getFloat32Array(ptr: number, len: number): Float32Array {
        return new Float32Array(getWasmMemory().buffer, ptr, len);
    }

    public getUint16Array(ptr: number, len: number): Uint16Array {
        return new Uint16Array(getWasmMemory().buffer, ptr, len);
    }

    public destroy() {
        if (this.context) {
            finalizationRegistry.unregister(this);
            this.context.free();
            // @ts-ignore
            this.context = null;
        }
    }
}

export { WebCoordinateSystem, SSRuntimeContext, SSRuntimeResource };
