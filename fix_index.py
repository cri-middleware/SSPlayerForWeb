import re

with open("packages/ssplayer-core/src/index.ts", "r") as f:
    content = f.read()

if "InternalPlayerBase" not in content:
    content += "\nexport * from './InternalPlayerBase.js';\n"

with open("packages/ssplayer-core/src/index.ts", "w") as f:
    f.write(content)

