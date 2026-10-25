import { parseWorkflow, graphs, filename, mergeExtra } from './workflow'
import { isWorkflowLink, workflowViewerURL } from './links'
import { readWorkflowLink } from './link-client'
import { workflowFragment, hoistWorkflowURL } from './share'
import { fallbackWidgets, fallbackWidgetSpec, subgraphTypes } from './fallback-widgets'

// The same public instance exposed by native Comfy's scripts/app.js shim.
const app = (window as any).comfyAPI.app.app

const state = (window as any).comfystatic
const originals = new WeakMap<object, any>()
const templates = new Map<string, any>()
let downloadCount = 0
let importingLink = false
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
function publish(data: any) {
  if (!state.readyEditor || importingLink) return
  try { state.shareRoute.set(workflowFragment(data, active()?.filename)) }
  catch (error) { notice(`Could not create workflow link: ${error}`, 'error') }
}
async function copyWorkflowLink() {
  const fragment = workflowFragment(serialize(), active()?.filename)
  state.shareRoute.set(fragment)
  const url = workflowViewerURL(fragment, location.href)
  try { await navigator.clipboard.writeText(url); notice('Workflow link copied.') }
  catch { linkDialog(url) }
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
let linkController: AbortController | undefined
async function openLink(input: string) {
  linkController?.abort()
  const controller = linkController = new AbortController()
  const result = await readWorkflowLink(input, state.base, controller.signal)
  controller.signal.throwIfAborted()
  importingLink = true
  try {
    if (result.workflow) await importText(JSON.stringify(result.workflow), result.name)
    else await app.handleFile(new File([result.bytes], result.name, { type: result.mime }))
    controller.signal.throwIfAborted()
    // A successful import becomes a self-contained snapshot, not a local UUID
    // or a pointer whose remote source can subsequently disappear.
    state.shareRoute.set(workflowFragment(result.workflow ?? serialize(), result.name))
  } finally { importingLink = false }
  return result
}
function linkDialog(viewerURL?: string) {
  const dialog = document.createElement('dialog'); dialog.className = 'cs-dialog cs-link-dialog'
  const title = document.createElement('h2'); title.textContent = 'Open workflow link'
  const form = document.createElement('form')
  const input = document.createElement('input'); input.type = 'text'; input.setAttribute('aria-label', 'Workflow URL or ln.kr fragment')
  input.placeholder = 'https://… or #ss:…'; input.spellcheck = false
  const output = document.createElement('input'); output.readOnly = true; output.hidden = true; output.setAttribute('aria-label', 'Comfystatic viewer URL')
  if (viewerURL) { output.value = viewerURL; output.hidden = false }
  const status = document.createElement('p'); status.setAttribute('role', 'status')
  const actions = document.createElement('footer')
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.onclick = () => dialog.close()
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy viewer link'
  const open = document.createElement('button'); open.type = 'submit'; open.textContent = 'Open workflow'
  let controller: AbortController | undefined
  const run = async (load: boolean) => {
    controller?.abort(); controller = new AbortController()
    input.disabled = open.disabled = copy.disabled = true; status.textContent = 'Reading link…'; output.hidden = true
    try {
      if (load) { await openLink(input.value); dialog.close() }
      else {
        const result = await readWorkflowLink(input.value, state.base, controller.signal)
        if (!result.workflow) throw Error('Open this metadata file first, then use Copy link to share its workflow JSON.')
        output.value = workflowViewerURL(workflowFragment(result.workflow), location.href); output.hidden = false
        try { await navigator.clipboard.writeText(output.value); status.textContent = 'Viewer link copied.' }
        catch { status.textContent = 'Copy the viewer URL below.'; output.focus(); output.select() }
      }
    } catch (error) { if (dialog.open) status.textContent = String(error) }
    finally { input.disabled = open.disabled = copy.disabled = false }
  }
  form.onsubmit = e => { e.preventDefault(); void run(true) }; copy.onclick = () => void run(false)
  actions.append(cancel, copy, open); form.append(input, status, output, actions); dialog.append(title, form)
  dialog.onclose = () => { controller?.abort(); linkController?.abort(); dialog.remove() }
  document.body.append(dialog); dialog.showModal(); input.focus()
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
  const nativeWidgets = (window as any).comfyAPI.widgets?.ComfyWidgets
  const widgetInputs = (window as any).comfyAPI.widgetInputs
  const subgraphs = subgraphTypes(data)
  let count = 0
  for (const graph of graphs(data)) for (const n of graph.nodes ?? []) {
    if (subgraphs.has(n.type) || LG.registered_node_types[n.type]) continue
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
        for (const widget of [...(this.widgets ?? [])]) this.removeWidget(widget)
        this.raw = structuredClone(raw); this.widgets = []; this.inputs = []; this.outputs = []
        for (const slot of raw.inputs ?? []) this.addInput(slot.name, slot.type, { ...slot, link: null })
        for (const slot of raw.outputs ?? []) this.addOutput(slot.name, slot.type, { ...slot, links: null })
        for (const { name, type, value, multiline, slot } of fallbackWidgets(raw)) {
          const spec = fallbackWidgetSpec(value, multiline)
          const w = multiline && nativeWidgets?.STRING
            ? nativeWidgets.STRING(this, name, spec, app).widget
            : this.addWidget(type, name, typeof value === 'object' ? JSON.stringify(value) : value,
              () => this.graph?.change(), type === 'number' ? { precision: 6, step: 10 } : {})
          w.value = typeof value === 'object' ? JSON.stringify(value) : value
          if (slot) {
            const input = this.inputs.find((input: any) => input.widget?.name === name)
            if (input) widgetInputs?.setWidgetConfig?.(input, spec)
          }
          if (typeof value === 'object') w.serializeValue = () => { try { return JSON.parse(w.value) } catch { return value } }
        }
        this.size = raw.size ? [...raw.size] : [300, Math.max(80, 55 + this.widgets.length * 26)]
      }
      configure(raw: any) {
        this.prepare(raw); super.configure(raw)
        // Native configure restores slot metadata; reattach its nonserialized
        // widget-config getter afterwards for native subgraph promotion.
        for (const { name, value, multiline, slot } of fallbackWidgets(raw)) if (slot) {
          const input = this.inputs.find((input: any) => input.widget?.name === name)
          if (input) widgetInputs?.setWidgetConfig?.(input, fallbackWidgetSpec(value, multiline))
        }
      }
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
    const handleFile = app.handleFile.bind(app)
    app.handleFile = async (file: File, ...args: any[]) => {
      // JSON is workflow data, not media metadata. Use the same importer as
      // pasted/shared JSON regardless of the browser's file MIME detection.
      if (/\.json$/i.test(file.name) || /(?:application|text)\/(?:[^;]+\+)?json/i.test(file.type)) {
        return importText(await file.text(), file.name.replace(/\.json$/i, ''))
      }
      return handleFile(file, ...args)
    }
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
      publish(args[0])
    }
    const load = app.loadGraphData.bind(app)
    app.loadGraphData = async (data: any, clean: any, view: any, workflow: any, options: any) => {
      const result = await load(data, clean, view, workflow, { ...options, skipAssetScans: true })
      if (result === false) throw new Error('Native ComfyUI could not load this workflow.')
      if (data) originals.set(active() ?? app.graph, structuredClone(data))
      if (data) publish(data)
      return result
    }
    // Run/queue shortcuts cannot accidentally execute even when a custom extension exposes one.
    app.queuePrompt = async () => { notice('Static editor only. Save JSON and run it in your own ComfyUI.'); return false }
  },
  beforeConfigureGraph(data: any) {
    state.loadingWorkflow = structuredClone(data)
    const count = registerFallback(data)
    if (count) {
      notice(`${count} node type${count === 1 ? '' : 's'} use workflow-derived fallback widgets, not full definitions. Capture /object_info from your ComfyUI for exact controls and choices.`)
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
    const button = (label: string, run: () => void) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => run(); bar.append(b) }
    button('Open workflow', () => chooseFile('.json,.png,.webp,.avif,.flac,.mp4,.webm', f => app.handleFile(f)))
    button('Open link', linkDialog)
    button('Paste JSON', pasteDialog)
    button('Download JSON', () => download(active()?.filename ?? 'workflow.json', serialize()))
    button('Copy link', () => void copyWorkflowLink().catch(e => notice(String(e), 'error')))
    button('Hoist to Make', () => {
      const fragment = workflowFragment(serialize(), active()?.filename)
      state.shareRoute.set(fragment)
      window.open(hoistWorkflowURL(fragment), '_blank', 'noopener,noreferrer')
    })
    button('Link compressor', () => window.open(new URL('links.html', state.base), '_blank', 'noopener,noreferrer'))
    button('Node definitions', () => chooseFile('.json', async f => {
      const defs = JSON.parse(await f.text())
      if (!defs || !Object.values(defs).every((v: any) => v?.input && Array.isArray(v.output))) throw new Error('Expected an /object_info node-definition JSON file.')
      const current = serialize()
      Object.assign(state.nodes, defs); await state.files.put('@nodes', JSON.stringify(state.nodes))
      await app.registerNodes(); await app.loadGraphData(current, true, true, active())
      notice(`Loaded ${Object.keys(defs).length} native node definitions.`)
    }))
    const badge = document.createElement('span'); badge.textContent = `ComfyUI ${state.frontend} · ${state.capturedNodes ? 'captured nodes' : 'starter nodes'}`; badge.title = 'Native frontend version. Source details: comfystatic/upstream.json. No execution backend.'; bar.append(badge)
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
      if (isWorkflowLink(text)) {
        e.preventDefault(); e.stopImmediatePropagation(); void openLink(text).catch(e => notice(String(e), 'error')); return
      }
      try { parseWorkflow(text) } catch { return }
      e.preventDefault(); e.stopImmediatePropagation(); void importText(text).catch(e => notice(String(e), 'error'))
    }, true)
    document.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('text/uri-list')) e.preventDefault() }, true)
    document.addEventListener('drop', e => {
      if (e.dataTransfer?.files.length) return
      const target = e.target as HTMLElement
      if (target.closest('input,textarea,[contenteditable]:not([contenteditable="false"])')) return
      const text = e.dataTransfer?.getData('text/uri-list').split(/\r?\n/).find(line => line && !line.startsWith('#')) || e.dataTransfer?.getData('text/plain') || ''
      if (!isWorkflowLink(text)) return
      e.preventDefault(); e.stopImmediatePropagation(); void openLink(text).catch(e => notice(String(e), 'error'))
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
    state.editor = { importText, openLink, serialize, save, fallbackTypes: templates }
    state.readyEditor = true
    document.documentElement.dataset.comfystaticReady = 'true'
    const openFragment = (fragment: string) => {
      state.pendingLink = undefined
      void openLink(fragment).catch(e => notice(String(e), 'error'))
    }
    window.addEventListener('comfystatic:open-link', (e: any) => openFragment(e.detail))
    if (state.pendingLink) openFragment(state.pendingLink)
  }
})
