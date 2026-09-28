import { parseWorkflow, graphs, filename, mergeExtra } from './workflow'

// The same public instance exposed by native Comfy's scripts/app.js shim.
const app = (window as any).comfyAPI.app.app

const state = (window as any).comfystatic
const originals = new WeakMap<object, any>()
const templates = new Map<string, any>()
let downloadCount = 0
function notice(detail: string, severity = 'info') {
  app.extensionManager.toast.add({ severity, summary: 'comfystatic', detail, life: 6500 })
}
function download(name: string, data: any) {
  downloadCount++
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = filename(name); a.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
function active() { return app.extensionManager.workflow.activeWorkflow }
function serialize() {
  const data = app.rootGraph.serialize()
  return mergeExtra(originals.get(active() ?? app.graph), data)
}
async function save() {
  // Native Save/Save As keeps tabs and local files consistent; its successful
  // write event also downloads the JSON. Cancelling the dialog saves nothing.
  if (state.nativeSave) {
    const count = downloadCount, wasSaved = active()?.isPersisted
    await state.nativeSave()
    if (wasSaved && count === downloadCount) download(active()?.filename ?? 'workflow.json', serialize())
  }
  else download(active()?.filename ?? 'workflow.json', serialize())
}
async function importText(text: string, name = 'workflow.json') {
  const data = parseWorkflow(text)
  if (Array.isArray(data.nodes)) await app.loadGraphData(data, true, true, name, { skipAssetScans: true })
  else { await app.loadApiJson(data, name); notice('Imported API prompt. API JSON has no saved layout; the editor arranges its nodes.') }
}
function chooseFile(accept: string, action: (file: File) => Promise<void>) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = accept
  input.onchange = () => { if (input.files?.[0]) void action(input.files[0]).catch(e => notice(String(e), 'error')) }
  input.click()
}
function pasteDialog() {
  const dialog = document.createElement('dialog'); dialog.className = 'cs-dialog'
  const title = document.createElement('h2'); title.textContent = 'Paste workflow JSON'
  const textarea = document.createElement('textarea'); textarea.setAttribute('aria-label', 'Workflow JSON'); textarea.placeholder = '{ "nodes": […] }'
  const status = document.createElement('p'); status.setAttribute('role', 'alert')
  const actions = document.createElement('footer')
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.onclick = () => dialog.close()
  const open = document.createElement('button'); open.textContent = 'Open workflow'; open.onclick = async () => {
    try { await importText(textarea.value); dialog.close() } catch (e) { status.textContent = String(e) }
  }
  actions.append(cancel, open); dialog.append(title, textarea, status, actions)
  dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal(); textarea.focus()
}
function registerFallback(data: any) {
  const LG = (window as any).LiteGraph
  const Base = (window as any).LGraphNode ?? LG.LGraphNode
  let count = 0
  for (const graph of graphs(data)) for (const n of graph.nodes ?? []) {
    if (LG.registered_node_types[n.type]) continue
    // Subgraph definitions are registered by native Comfy before this hook.
    templates.set(n.type, structuredClone(n))
    class WorkflowNode extends Base {
      static title = n.title ?? n.type
      static category = 'Imported workflow'
      static description = 'Workflow-only node. Import object_info for native widget definitions.'
      private raw: any
      constructor() {
        super(n.title ?? n.type)
        this.properties = {}; this.serialize_widgets = true
        this.prepare(templates.get(n.type))
      }
      prepare(raw: any) {
        this.raw = structuredClone(raw); this.widgets = []; this.inputs = []; this.outputs = []
        for (const slot of raw.inputs ?? []) this.addInput(slot.name, slot.type, { ...slot, link: null })
        for (const slot of raw.outputs ?? []) this.addOutput(slot.name, slot.type, { ...slot, links: null })
        const values = raw.widgets_values ?? []
        for (const [i, value] of Object.entries(values)) {
          const type = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'toggle' : 'text'
          const w = this.addWidget(type, Array.isArray(values) ? `value ${Number(i) + 1}` : i,
            typeof value === 'object' ? JSON.stringify(value) : value, () => this.graph?.change(), type === 'number' ? { precision: 6, step: 10 } : {})
          if (value !== null && typeof value === 'object') w.serializeValue = () => { try { return JSON.parse(w.value) } catch { return value } }
        }
        this.size = raw.size ? [...raw.size] : [300, Math.max(80, 55 + this.widgets.length * 26)]
      }
      configure(raw: any) { this.prepare(raw); super.configure(raw) }
      onSerialize(out: any) {
        for (const [key, value] of Object.entries(this.raw ?? {})) if (!(key in out)) out[key] = structuredClone(value)
        if (this.raw?.widgets_values && !Array.isArray(this.raw.widgets_values)) {
          out.widgets_values = Object.fromEntries(Object.keys(this.raw.widgets_values).map((k, i) => [k, this.widgets[i]?.value]))
        }
      }
    }
    LG.registerNodeType(n.type, WorkflowNode)
    count++
  }
  return count
}

app.registerExtension({
  name: 'comfystatic.local-editor',
  async init() {
    await state.ready
    const clean = app.clean.bind(app)
    app.clean = () => {
      const graph = app.graph
      if (graph?.onSerialize && Object.hasOwn(graph.onSerialize, 'comfystaticOriginal')) graph.onSerialize = graph.onSerialize.comfystaticOriginal
      state.loadingWorkflow = undefined
      return clean()
    }
    const loadApi = app.loadApiJson.bind(app)
    app.loadApiJson = async (...args: any[]) => {
      await loadApi(...args)
      originals.delete(active() ?? app.graph)
    }
    const load = app.loadGraphData.bind(app)
    app.loadGraphData = async (data: any, clean: any, view: any, workflow: any, options: any) => {
      const result = await load(data, clean, view, workflow, { ...options, skipAssetScans: true })
      if (result === false) throw new Error('Native ComfyUI could not load this workflow.')
      if (data) originals.set(active() ?? app.graph, structuredClone(data))
      return result
    }
    // Run/queue shortcuts cannot accidentally execute even when a custom extension exposes one.
    app.queuePrompt = async () => { notice('Static editor only. Save JSON and run it in your own ComfyUI.'); return false }
  },
  beforeConfigureGraph(data: any) {
    state.loadingWorkflow = structuredClone(data)
    const count = registerFallback(data)
    if (count) {
      notice(`${count} custom node type${count === 1 ? '' : 's'} preserved with generic widgets. Capture /object_info to restore their exact controls.`)
      setTimeout(() => app.updateVueAppNodeDefs?.(state.nodes), 0)
    }
  },
  getCanvasMenuItems() {
    return [null, { content: 'Save workflow JSON', callback: () => void save().catch(e => notice(String(e), 'error')) }]
  },
  afterConfigureGraph() {
    // Native autosave and tab switching must retain extension-specific metadata,
    // not just the explicit download button.
    const root = app.rootGraph
    const original = state.loadingWorkflow
    if (!original) return
    const preserve = (graph: any, raw: any) => {
      const previous = graph.onSerialize
      // Replace our prior wrapper on reuse, retaining the upstream hook only.
      const upstream = previous && Object.hasOwn(previous, 'comfystaticOriginal') ? previous.comfystaticOriginal : previous
      const hook: any = (out: any) => { upstream?.call(graph, out); Object.assign(out, mergeExtra(raw, out)) }
      hook.comfystaticOriginal = upstream ?? null
      graph.onSerialize = hook
    }
    preserve(root, original)
    for (const raw of graphs(original).slice(1)) {
      const graph = root.subgraphs?.get(raw.id)
      if (graph) preserve(graph, raw)
    }
  },
  async setup() {
    const bar = document.createElement('nav'); bar.id = 'comfystatic-toolbar'; bar.setAttribute('aria-label', 'Static workflow tools')
    const brand = document.createElement('strong'); brand.textContent = 'comfystatic'; bar.append(brand)
    const button = (label: string, run: () => void) => { const b = document.createElement('button'); b.textContent = label; b.onclick = run; bar.append(b) }
    button('Open workflow', () => chooseFile('.json,.png,.webp,.avif,.flac,.mp4,.webm', f => app.handleFile(f)))
    button('Paste JSON', pasteDialog)
    button('Save JSON', () => void save().catch(e => notice(String(e), 'error')))
    button('Node definitions', () => chooseFile('.json', async f => {
      const defs = JSON.parse(await f.text())
      if (!defs || !Object.values(defs).every((v: any) => v?.input && Array.isArray(v.output))) throw new Error('Expected an /object_info node-definition JSON file.')
      const current = serialize()
      Object.assign(state.nodes, defs); await state.files.put('@nodes', JSON.stringify(state.nodes))
      await app.registerNodes(); await app.loadGraphData(current, true, true, active())
      notice(`Loaded ${Object.keys(defs).length} native node definitions.`)
    }))
    const badge = document.createElement('span'); badge.textContent = `LOCAL · ${state.frontend}`; badge.title = 'No backend. Workflows stay in this browser.'; bar.append(badge)
    document.body.append(bar)
    document.addEventListener('paste', e => {
      const target = e.target as HTMLElement
      if (target.closest('input,textarea,[contenteditable]:not([contenteditable="false"])')) return
      // Native selected-node clipboard data has priority over workflow import.
      if (e.clipboardData?.getData('text/html').includes('data-metadata=')) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) {
        e.preventDefault(); e.stopImmediatePropagation()
        // Reuse native Comfy's image/video metadata parser, also used by drop.
        void (async () => { for (const file of files) await app.handleFile(file) })().catch(e => notice(String(e), 'error'))
        return
      }
      const text = e.clipboardData?.getData('text/plain') ?? ''
      try { parseWorkflow(text) } catch { return }
      e.preventDefault(); e.stopImmediatePropagation(); void importText(text).catch(e => notice(String(e), 'error'))
    }, true)
    window.addEventListener('comfystatic:notice', (e: any) => notice(e.detail))
    // Native Save/Save As write to our local API; download their successful writes.
    window.addEventListener('comfystatic:saved', (e: any) => {
      if (/^workflows\/.+\.json$/i.test(e.detail.key)) {
        download(e.detail.key, JSON.parse(e.detail.text))
      }
    })
    const commands = app.extensionManager.command.commands
    for (const command of commands) {
      if (command.id === 'Comfy.SaveWorkflow') { state.nativeSave = command.function.bind(command); command.function = save }
      if (command.id === 'Comfy.ExportWorkflow') command.function = () => download(active()?.filename ?? 'workflow.json', serialize())
    }
    // Remove backend-only sidebar pages, retaining native workflows, nodes and settings.
    for (const tab of app.extensionManager.getSidebarTabs()) {
      if (/queue|model|template|asset|manager|download/i.test(tab.id)) app.extensionManager.unregisterSidebarTab(tab.id)
    }
    state.editor = { importText, serialize, save, fallbackTypes: templates }
    state.readyEditor = true
    document.documentElement.dataset.comfystaticReady = 'true'
  }
})
