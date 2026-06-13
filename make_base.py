import re

with open("packages/ssplayer-core/src/DirectInternalPlayer.ts", "r") as f:
    content = f.read()

# 1. Rename to InternalPlayerBase and add <T>
content = content.replace("export class DirectInternalPlayer", "export abstract class InternalPlayerBase<T extends InternalPlayerBase<T>>")

# 2. Add InstanceChildState<T>
content = content.replace("export interface InstanceChildState {", "export interface InstanceChildState<T> {")
content = content.replace("player: DirectInternalPlayer;", "player: T;")
content = content.replace("private _instanceChildren: Map<number, InstanceChildState> = new Map();", "protected _instanceChildren: Map<number, InstanceChildState<T>> = new Map();")
content = content.replace("getInstanceChild(partIndex: number): InstanceChildState | undefined", "getInstanceChild(partIndex: number): InstanceChildState<T> | undefined")

# 3. Add abstract createChildPlayer
content = content.replace(
    "    public destroy() {",
    "    protected abstract createChildPlayer(manager: SSRuntimeManager): T;\n\n    public destroy() {"
)

# 4. Remove geometryBuilder (it's Direct-specific)
content = re.sub(r'    public geometryBuilder: GeometryBuilder;\n', '', content)
content = content.replace(", geometryBuilder: GeometryBuilder", "")
content = content.replace("this.geometryBuilder = geometryBuilder;", "")
content = content.replace("this.geometryBuilder = new GeometryBuilder(this.runtimeManager);", "")

# 5. Fix instantiation in loadInstancePacks
content = content.replace("const childPlayer = new DirectInternalPlayer(manager);", "const childPlayer = this.createChildPlayer(manager);")

# Write base class
with open("packages/ssplayer-core/src/InternalPlayerBase.ts", "w") as f:
    f.write(content)

# Now, rewrite DirectInternalPlayer
direct_content = """import { GeometryBuilder } from './GeometryBuilder.js';
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
"""
with open("packages/ssplayer-core/src/DirectInternalPlayer.ts", "w") as f:
    f.write(direct_content)

