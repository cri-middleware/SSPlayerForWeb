import { GeometryBuilder } from './GeometryBuilder.js';
import { SSRuntimeManager } from './SSRuntimeManager.js';
import { InternalPlayerBase } from './InternalPlayerBase.js';

export class DirectInternalPlayer extends InternalPlayerBase<DirectInternalPlayer> {
    public geometryBuilder: GeometryBuilder;

    constructor(runtimeManager: SSRuntimeManager) {
        super(runtimeManager);
        this.geometryBuilder = new GeometryBuilder(this.runtimeManager);
    }

    protected createChildPlayer(manager: SSRuntimeManager): DirectInternalPlayer {
        return new DirectInternalPlayer(manager);
    }
}
