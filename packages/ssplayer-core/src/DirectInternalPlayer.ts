import { GeometryBuilder } from './GeometryBuilder.js';
import { IResourceManager } from './IResourceManager.js';
import { InternalPlayerBase } from './InternalPlayerBase.js';

export class DirectInternalPlayer extends InternalPlayerBase<DirectInternalPlayer> {
    public geometryBuilder: GeometryBuilder;

    constructor(resourceManager?: IResourceManager) {
        super(resourceManager);
        this.geometryBuilder = new GeometryBuilder(this.runtimeManager);
    }

    protected createChildPlayer(resourceManager?: IResourceManager): DirectInternalPlayer {
        return new DirectInternalPlayer(resourceManager);
    }
}
