# comfystatic

The native ComfyUI editor, packaged for a static host. No Python, GPU, model downloads, accounts, or Comfy server are needed to view and edit workflows.

## Build and open

Requires [Bun](https://bun.sh).

```sh
bun install --frozen-lockfile
bun run sync
bun run build
bun start
```

Open **http://127.0.0.1:8190/**. `bun start` is just a static file server, not an application backend. Set `PORT` or `HOST` if needed. Deploy the contents of `dist/` on an ordinary HTTPS static host; subdirectory hosting is supported. Use HTTP(S), not a `file://` URL.

## Use

- Drop a workflow JSON or a Comfy-generated PNG onto the canvas. The native importer also supports workflow metadata in other media formats supported by that frontend version.
- Focus the canvas and press **Ctrl+V** to paste workflow JSON or a clipboard file with embedded workflow metadata. Native node copy/paste remains intact. **Paste JSON** is an optional convenience, not a required import step.
- **Open workflow** uses the same native metadata importer as drag-and-drop. Copying a rendered picture through some apps strips metadata; use the original PNG file in that case.
- Drag, connect, resize, group, copy, undo/redo, and double-click to add nodes using native Comfy controls. Workflows open in native tabs.
- **Download JSON**, **Ctrl+S**, native Save/Save As, and **Save workflow JSON** in the canvas context menu download ordinary workflow JSON. A local copy is also kept in the native workflow sidebar.
- Settings, workflows, and drafts live in this browser's local storage/IndexedDB. Export JSON for portable backups; clearing site data removes the local library.

Generation is deliberately unavailable. The run controls and backend-only sidebar pages are removed; queue requests cannot execute. The native editor's external fetch/XHR/WebSocket/beacon traffic is blocked, with a same-origin Content Security Policy as a backstop. Explicit workflow-link imports use a separate sandboxed static document for public file reads, not a proxy or application backend. The static host still serves the application files; this is not a service-worker offline installation.

## Workflow links

**Open link** accepts public workflow JSON/media URLs, shortened ln.kr links, and bare fragments such as `#s:…` or `#ss:…`. Pasting a link onto the focused canvas or dropping a URL works too. GitHub file links and Hugging Face model/dataset/Space file links use ln.kr's raw/resolve handling.

Imports (including dropped/uploaded files and pasted JSON) update the address bar with a self-contained workflow. **Copy link** shares the current graph, including edits. Embedded links use Make's existing `#share:` file envelope with level-9 DEFLATE; **Hoist to Make** opens that exact same hashtag under `https://app.shel.sh/make/`. Native graph UUIDs stay internal instead of replacing the share URL.

**Link compressor** opens `links.html`, a lightweight link-only page. Enter a JSON URL or hashtag code to create a short source pointer, choose **Embedded JSON** for a self-contained snapshot, or upload JSON. Source pointers fetch on open; embedded links need no original file host. A one-line pointer file produces the matching `#ss:` superlink; nested bare hashtags, Markdown links and anchors use the unchanged ln.kr parser. ln.kr v1–v4 text payloads and Make file shares containing workflows are also supported. JSON is treated as data; linked JavaScript/HTML is never executed. PNG and other supported metadata files go through Comfy's native importer.

Reads omit credentials and referrers. Sources must allow CORS; HTTPS pages cannot read insecure HTTP sources. Failed/circular pointers report an error without navigating away. Imports have a 30-second, 12-hop and 32-MiB total limit. Ordinary editor traffic remains blocked and no telemetry is added.

## Native version and updates

`sync` downloads the **official packaged frontend used by ComfyUI portable**, not a recreated editor. It resolves the version pinned in ComfyUI's requirements and verifies the PyPI wheel SHA-256. The large portable Python/CUDA distribution is unnecessary for its browser assets. Native JS/CSS assets are copied without source patches.

```sh
# Refresh the native build, then rebuild the site.
bun run sync
bun run build

# Or use a particular native frontend release.
bun run sync --version 1.53.6
bun run build
```

`source/` contains the ignored native cache and optional node snapshot. `dist/` is the generated static site. Rebuilding alone never downloads anything. The resulting `dist/comfystatic/upstream.json` records the exact version and checksum. `sync` also refreshes the unchanged ln.kr library from its current remote `main`; `src/vendor/lnkr/upstream.json` pins the commit and individual file hashes. No ln.kr checkout is modified or needed to build.

To use assets from an existing portable installation instead of downloading them:

```sh
bun run sync --frontend-dir "D:/ComfyUI_windows_portable/python_embeded/Lib/site-packages/comfyui_frontend_package/static" --version 1.53.6
bun run build
```

## Custom nodes

Workflow JSON does not necessarily contain widget names, enum choices, defaults or custom frontend code. Without those definitions, unknown nodes are preserved as editable generic nodes, including their ports, values, links and extra metadata. Generic widgets are explicitly labelled as such; they are not invented Python definitions. A small core starter catalog is included.

For your actual node library, start your own ComfyUI once and capture it:

```sh
bun run sync --comfy-url http://127.0.0.1:8188
bun run build
```

This records `/object_info` and the custom frontend modules listed by `/extensions`, following their literal relative imports and assets. The source snapshot is retained across normal frontend refreshes. After installing/updating custom nodes in ComfyUI, capture again and rebuild. No running ComfyUI is needed by visitors to the resulting static site.

For extensions which construct asset paths dynamically, include their complete `WEB_DIRECTORY` too. The name must match the directory served under `/extensions/` by your ComfyUI:

```sh
bun run sync --comfy-url http://127.0.0.1:8188 --custom-web "my_nodes=D:/ComfyUI/custom_nodes/my_nodes/web"
bun run build
```

Alternatively, **Node definitions** imports a previously saved `/object_info` JSON into the current browser. That restores native widgets without installing code; capture and rebuild when you want definitions included for every visitor.

Only capture frontend code you trust. Python execution, server-driven widgets, remote services, manager installs, and missing model/media previews cannot be reproduced on a static host. Such calls are blocked rather than redirected. Installing a node's Python package alone does not magically embed it in the static site. API-format prompts lack saved layout and load through Comfy's native API importer; workflow-format JSON is the lossless editing format.

## Development

```sh
bun test
bun run build
```

The adapter consists of a browser-local API/storage layer, a native Comfy extension, and a small stylesheet. No production framework or Playwright dependency is added. A major future native frontend release may change API contracts; verify paste, PNG import, tabs and JSON saving after refreshing versions.

ComfyUI frontend is GPL-3.0-only; this project's adapter is distributed under the same license. The unchanged ln.kr library is AGPL-3.0; its license, pako notice and source provenance are included in the build. Native source: [Comfy-Org/ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend), link library: [CommanderTurtle/ln.kr](https://github.com/CommanderTurtle/ln.kr). Upstream notices remain in the native assets.
