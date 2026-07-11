# Third-Party Notices

This file contains the license notices for third-party libraries used in **SSPlayerForWeb**.

We would like to thank the authors and contributors of these open-source projects.

---

## FlatBuffers

This project depends on FlatBuffers for binary data serialization.

Copyright (c) 2014 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

---

## SpriteStudio-SDK

This project integrates `SpriteStudio-SDK` (`libssruntime` and `libssconverter`), compiled to WebAssembly and shipped inside the renderer / converter packages.

Copyright (c) CRI Middleware Co., Ltd. All rights reserved.

`SpriteStudio-SDK` is licensed under the BSD-3-Clause License.

### Rust Runtime Dependencies

`libssruntime` and `libssconverter` are written in Rust and depend on various third-party open-source crates.

**License Location:**
Because the WebAssembly binaries are generated artifacts and are **not** checked into this repository, the corresponding license documents for the Rust dependencies are fetched or generated during setup (`pnpm run download:wasm` or `pnpm run build:wasm`). They are bundled alongside the WASM inside the published packages:

- `@spritestudio/ssplayer-core/wasm/` — `THIRD-PARTY-LICENSES.ssruntime.md` and `LICENSE.md` (also re-exported by the `ssplayer-pixi` / `ssplayer-webgl` renderers)
- `@spritestudio/ssconverter-core/wasm/` — `THIRD-PARTY-LICENSES.ssconverter.md` and `LICENSE.md`

**Distribution Note:**
If you distribute an application or bundle that includes `libssruntime` / `libssconverter` (via any of the packages above), please ensure you also retain and distribute the bundled license files (`THIRD-PARTY-LICENSES.ssruntime.md` / `THIRD-PARTY-LICENSES.ssconverter.md` and `LICENSE.md`) to comply with the open-source licenses of the underlying Rust crates.
