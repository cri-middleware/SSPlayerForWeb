import re

with open("packages/ssplayer-core/src/InternalPlayerBase.ts", "r") as f:
    content = f.read()

# Remove the broken createChildPlayer from InstanceSlotHandle
content = content.replace("    protected abstract createChildPlayer(manager: SSRuntimeManager): T;\n\n    public destroy() {\n        if (this.raw) {\n            finalizationRegistry.unregister(this);\n            this.raw.free();\n            // @ts-ignore\n            this.raw = null;\n        }\n    }", "    public destroy() {\n        if (this.raw) {\n            finalizationRegistry.unregister(this);\n            this.raw.free();\n            // @ts-ignore\n            this.raw = null;\n        }\n    }")

# Also from EffectSlotHandle
content = content.replace("    protected abstract createChildPlayer(manager: SSRuntimeManager): T;\n\n    public destroy() {\n        if (this.raw) {\n            finalizationRegistry.unregister(this);\n            this.raw.free();\n            // @ts-ignore\n            this.raw = null;\n        }\n    }", "    public destroy() {\n        if (this.raw) {\n            finalizationRegistry.unregister(this);\n            this.raw.free();\n            // @ts-ignore\n            this.raw = null;\n        }\n    }")

# Fix the class declaration if it didn't work
content = re.sub(r'export class DirectInternalPlayer\s*\{', 'export abstract class InternalPlayerBase<T extends InternalPlayerBase<T>> {', content)

# Insert createChildPlayer properly
content = re.sub(r'    public destroy\(\) \{\n        this.pause\(\);', '    protected abstract createChildPlayer(manager: SSRuntimeManager): T;\n\n    public destroy() {\n        this.pause();', content)

with open("packages/ssplayer-core/src/InternalPlayerBase.ts", "w") as f:
    f.write(content)

