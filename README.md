# comfystatic

The native ComfyUI editor, packaged for a static host. No Python, GPU, model downloads, accounts, or Comfy server are needed to view and edit workflows.

## Run it directly — no wrapper needed

Requires [Bun](https://bun.sh).

```sh
bun install --frozen-lockfile
bun run dev
```

After the one-time install, **`bun run dev` is the one-command update, build and server flow**. Open **http://127.0.0.1:8190/**. It downloads the frontend version currently pinned by upstream ComfyUI, refreshes the vendored ln.kr library, builds `dist/`, then serves it. It does not launch Python, install models, clone/pull repositories, or require Vitality. Ctrl+C stops the server.

To use your own installation **and its actual node definitions** instead:

```sh
bun run dev --comfy-dir "/path/to/ComfyUI" --comfy-url http://127.0.0.1:8188
```

The local ComfyUI must already be running for `--comfy-url`; the directory by itself does not expose Python node definitions. Omit the URL if you only want its frontend assets. On Windows, the directory can be the portable root, e.g. `D:/ComfyUI_windows_portable`.

| Command | What it does |
| --- | --- |
| `bun run dev [sync options]` | Update/copy sources → build → serve |
| `bun run dev --cached` | Build the existing cache → serve; no downloads |
| `bun start` / `bun run serve` | Serve an already-built `dist/`; no sync or build |
| `bun run sync [options]` | Update/copy sources only |
| `bun run build` | Build the existing source cache only |
| `bun run info` | Print exact source/version/checksum and node-catalog status |
| `bun run dev --help` | List source options without starting anything |

`HOST`, `PORT`, and `BASE_PATH` configure the static server (defaults: `127.0.0.1`, `8190`, `/`). `COMFY_DIR` and `COMFY_URL` can supply local source defaults; explicit CLI flags override them. Directory/URL flags apply to that invocation, not an implicit saved configuration. Add `--skip-lnkr` to keep the existing vendored link library. No update polling happens in the web page or while the static server runs; syncing is an explicit command.

Deploy the **complete contents** of `dist/` on an ordinary HTTPS static host, including `comfystatic/link-import.html` and `links.html`. Subdirectory hosting is supported. Use HTTP(S), not a `file://` URL. Vitality is optional packaging, not Comfystatic's build or runtime.

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

### What “native ComfyUI” means here

The default sync reads [`Comfy-Org/ComfyUI`'s current `master/requirements.txt`](https://github.com/Comfy-Org/ComfyUI/blob/master/requirements.txt), extracts `comfyui-frontend-package==…`, then downloads that release's official PyPI wheel and verifies its published SHA-256 before replacing the cache. **The version is not hardcoded.** This follows the backend's chosen frontend release, not bleeding-edge frontend `main`. There is no background git checkout, remote polling service, or recreated canvas renderer.

Only the wheel's `comfyui_frontend_package/static/` browser files are needed; the portable Python/CUDA distribution is not downloaded. The native JS/CSS files are copied unchanged. Comfystatic modifies the HTML entry to install its separate local API/storage adapter, adds its own toolbar/styles, and blocks generation/network backend calls. “Native frontend” does **not** mean that Python execution or your complete custom-node library is included.

`bun run info` prints the selected source and node-catalog status. The toolbar identifies **ComfyUI's version** and **starter vs captured nodes**. The deployed `comfystatic/upstream.json` records the source release and verified wheel checksum, or a local-source label and its index checksum. Full local paths stay in the local `info` report, not published provenance. A local copy is trusted as supplied; it is not falsely labelled as a verified official download.

```sh
# Follow upstream ComfyUI's current pin and open the result.
bun run dev

# Or use a particular native frontend release.
bun run dev --version 1.57.1
```

`source/` contains the ignored native cache and optional node snapshot. `dist/` is the generated static site. Rebuilding alone never downloads anything. The resulting `dist/comfystatic/upstream.json` records the exact version and checksum. `sync` also refreshes the unchanged ln.kr library from its current remote `main`; `src/vendor/lnkr/upstream.json` pins the commit and individual file hashes. No ln.kr checkout is modified or needed to build.

### Use a local installation or frontend clone

`--comfy-dir` checks a portable Python installation, Windows/Linux `.venv` or `venv`, a built frontend clone's `dist/` or `comfyui_frontend_package/static/`, and a legacy `web/` directory. It logs the exact directory selected. It never executes Python or modifies/builds your checkout. If a backend checkout has no installed frontend assets, its local `requirements.txt` selects the official wheel to download instead of using upstream master's pin.

```sh
bun run dev --comfy-dir "/path/to/ComfyUI"
bun run dev --comfy-dir "/path/to/ComfyUI_frontend"
```

A frontend **source** clone must already have been built using its own upstream build instructions. Its development `index.html` is not a browser distribution and is rejected. For an unusual layout, point directly to the built assets:

```sh
bun run sync --frontend-dir "D:/ComfyUI_windows_portable/python_embeded/Lib/site-packages/comfyui_frontend_package/static" --version 1.53.6
bun run build
```

`--version` is optional for local assets: sync reads installed package/frontend metadata where available and otherwise reports `local`. It cannot infer custom Python node schemas from files; use the running server capture below for those.

## Custom nodes

**The default catalog has only a small core starter set, not all ComfyUI nodes.** Updating the frontend does not populate `/object_info`. Workflow JSON does not necessarily contain complete widget names, enum choices, defaults or custom frontend code. Without real definitions, unknown nodes use editable fallback widgets, preserving their ports, saved values, links and extra metadata. Saved widget names are retained when their positional mapping is unambiguous, and multiline strings use native textareas. Native subgraph types are not replaced by generic nodes. These hints are not invented Python definitions and cannot supply absent enum choices or custom behavior.

Missing promoted controls or values appearing under the wrong labels are a **node-definition/widget-mapping issue**, not necessarily missing CSS. The workflow-derived fallback helps, but capture your actual node library for faithful custom controls.

For your actual node library, start your own ComfyUI once and capture it:

```sh
bun run dev --comfy-dir "/path/to/ComfyUI" --comfy-url http://127.0.0.1:8188
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
