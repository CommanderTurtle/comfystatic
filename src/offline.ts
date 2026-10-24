import { LocalFiles } from './storage'
import { isWorkflowFragment } from './links'

const base = new URL('../', (document.currentScript as HTMLScriptElement).src)
const realFetch = window.fetch.bind(window)
const files = new LocalFiles(base.pathname)
const defaults: Record<string, unknown> = {
  'Comfy.UseNewMenu': 'Top', 'Comfy.Workflow.WorkflowTabsPosition': 'Topbar',
  'Comfy.DevMode': false, 'Comfy.TutorialCompleted': true,
  'Comfy.NodeSearchBoxImpl': 'default', 'Comfy.Settings.Persisted': true,
  'Comfy.Notification.ShowVersionUpdates': false
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const state: any = { files, base: base.href, capturedNodes: false, requests: [], blocked: [] }
;(window as any).comfystatic = state
// Comfy owns UUID hashes for subgraphs. Consume import routes before its router
// starts, including later same-document navigation, without patching native JS.
const initialImport = isWorkflowFragment(location.hash)
let nativeHash = initialImport ? '' : location.hash
if (initialImport) {
  state.pendingLink = location.hash
  history.replaceState(history.state, '', location.pathname + location.search)
}
const captureImportRoute = (event: Event) => {
  const hash = location.hash
  if (!isWorkflowFragment(hash)) { nativeHash = hash; return }
  event.stopImmediatePropagation()
  state.pendingLink = hash
  history.replaceState(history.state, '', location.pathname + location.search + nativeHash)
  if (state.readyEditor) window.dispatchEvent(new CustomEvent('comfystatic:open-link', { detail: hash }))
}
window.addEventListener('hashchange', captureImportRoute, true)
window.addEventListener('popstate', captureImportRoute, true)
state.ready = Promise.all([
  realFetch(new URL('comfystatic/config.json', base)).then(r => r.json()),
  realFetch(new URL('comfystatic/nodes.json', base)).then(r => r.json()),
  files.get('@nodes')
]).then(([config, nodes, saved]) => {
  Object.assign(state, config, { nodes: { ...nodes, ...(saved ? JSON.parse(saved.text) : {}) } })
})
async function settings() { const saved = await files.get('@settings'); return { ...defaults, ...(saved ? JSON.parse(saved.text) : {}) } }
function route(url: URL) {
  let p = url.pathname
  if (p.startsWith(base.pathname)) p = p.slice(base.pathname.length - 1)
  return p.replace(/^\/api(?=\/|$)/, '')
}
const endpoints = /^\/(?:api(?:\/|$)|internal(?:\/|$)|upload(?:\/|$)|view$|object_info(?:\/|$)|users$|settings(?:\/|$)|userdata(?:\/|$)|extensions$|features$|system_stats$|prompt$|queue$|history(?:\/|$)|jobs(?:\/|$)|workflow_templates$|embeddings$|global_subgraphs(?:\/|$)|experiment(?:\/|$)|models(?:\/|$)|manager(?:\/|$))/
function isApi(url: URL) {
  const rel = url.pathname.startsWith(base.pathname) ? '/' + url.pathname.slice(base.pathname.length) : url.pathname
  return endpoints.test(rel)
}
async function api(req: Request): Promise<Response> {
  await state.ready
  const url = new URL(req.url), path = route(url), method = req.method
  state.requests.push(`${method} ${path}`)
  if (state.requests.length > 250) state.requests.shift()
  if (path === '/features') return json({})
  if (path.startsWith('/upload/') && method === 'POST') {
    const form = await req.formData(), image = form.get('image')
    if (!(image instanceof Blob)) return json({ error: 'No image provided' }, 400)
    const type = String(form.get('type') ?? 'input'), subfolder = String(form.get('subfolder') ?? '')
    let name = ((image as File).name ?? 'image.png').split(/[\\/]/).pop()!
    const key = () => `@media/${type}/${subfolder}/${name}`
    if (form.get('overwrite') !== 'true' && await files.get(key())) name = `${Date.now()}-${name}`
    await files.putMedia(key(), image)
    return json({ name, subfolder, type })
  }
  if (path === '/view' && method === 'GET') {
    const q = url.searchParams
    const f = await files.get(`@media/${q.get('type') ?? 'input'}/${q.get('subfolder') ?? ''}/${q.get('filename')}`)
    return f?.blob ? new Response(f.blob) : new Response('Media is not stored in this browser.', { status: 404 })
  }
  if (path === '/i18n') return json({})
  if (path === '/users') return json({ storage: 'server', migrated: true })
  if (path === '/extensions') return json(state.extensions)
  if (path === '/object_info') return json(state.nodes)
  if (path.startsWith('/object_info/')) { const key = decodeURIComponent(path.slice(13)); return json({ [key]: state.nodes[key] }) }
  if (path === '/system_stats') return json({ system: { os: 'comfystatic', python_version: '', embedded_python: false,
    comfyui_version: 'static', comfyui_frontend_version: state.frontend, required_frontend_version: state.frontend,
    pytorch_version: '', argv: [], ram_total: 0, ram_free: 0 }, devices: [] })
  if (path === '/settings' || path.startsWith('/settings/')) {
    const data = await settings(), key = decodeURIComponent(path.slice(10))
    if (method === 'GET') return json(key ? data[key] ?? null : data)
    if (method === 'POST') {
      const value = await req.json(); if (key) data[key] = value; else Object.assign(data, value)
      await files.put('@settings', JSON.stringify(data)); return json(data)
    }
  }
  if (path === '/userdata' && method === 'GET') {
    const dir = url.searchParams.get('dir') ?? ''
    const full = url.searchParams.get('full_info') === 'true'
    const split = url.searchParams.get('split') === 'true'
    const prefix = dir ? dir.replace(/\/$/, '') + '/' : ''
    return json((await files.list()).filter(f => !f.key.startsWith('@') && f.key.startsWith(prefix)).map(f => {
      const rel = f.key.slice(prefix.length)
      return full ? { path: rel, size: new TextEncoder().encode(f.text).length, modified: f.modified } : split ? rel.split('/') : rel
    }))
  }
  if (path.startsWith('/userdata/')) {
    const parts = path.slice(10).split('/move/')
    const key = decodeURIComponent(parts[0]!)
    if (parts[1] && method === 'POST') {
      const to = decodeURIComponent(parts[1])
      const status = await files.move(key, to, url.searchParams.get('overwrite') === 'true')
      const item = status === 200 ? await files.get(to) : null
      return json(item ? { path: to, modified: item.modified, size: new TextEncoder().encode(item.text).length } : {}, status)
    }
    if (method === 'GET') { const f = await files.get(key); return f ? new Response(f.text) : new Response('', { status: 404 }) }
    if (method === 'POST') {
      if (url.searchParams.get('overwrite') === 'false' && await files.get(key)) return json({ error: 'Exists' }, 409)
      const text = await req.text(); await files.put(key, text)
      window.dispatchEvent(new CustomEvent('comfystatic:saved', { detail: { key, text } }))
      return json({ path: key, size: new TextEncoder().encode(text).length, modified: Date.now() })
    }
    if (method === 'DELETE') { await files.delete(key); return new Response(null, { status: 204 }) }
  }
  if (path === '/prompt' && method === 'GET') return json({ exec_info: { queue_remaining: 0 } })
  if (path === '/queue' && method === 'GET') return json({ queue_running: [], queue_pending: [] })
  if (/^\/jobs/.test(path) && method === 'GET') return json({ jobs: [], pagination: { total: 0, offset: 0, limit: 100, has_more: false } })
  if (path === '/history' && method === 'GET') return json({})
  if (path === '/global_subgraphs') {
    const items = (await files.list()).filter(f => f.key.startsWith('subgraphs/'))
    return json(Object.fromEntries(items.map(f => [f.key.slice(10), { data: f.text }])))
  }
  if (path.startsWith('/global_subgraphs/')) {
    const key = 'subgraphs/' + decodeURIComponent(path.slice(18))
    if (method === 'GET') { const f = await files.get(key); return f ? json({ data: f.text }) : json({}, 404) }
    if (method === 'POST') { const body = await req.json() as any; await files.put(key, body.data ?? JSON.stringify(body)); return json({}) }
    if (method === 'DELETE') { await files.delete(key); return json({}) }
  }
  if (['/embeddings', '/experiment/models', '/models'].includes(path)) return json([])
  if (path.startsWith('/experiment/models/')) return json([])
  if (['/workflow_templates', '/node_replacements'].includes(path)) return json({})
  state.blocked.push(`${method} ${path}`)
  return json({ error: 'This operation requires a ComfyUI server and is unavailable in the static editor.' }, 501)
}
window.fetch = async (input, init) => {
  const req = new Request(input instanceof Request ? input : new URL(String(input), location.href), init)
  const url = new URL(req.url)
  if (['blob:', 'data:'].includes(url.protocol)) return realFetch(req)
  if (url.origin !== location.origin) {
    state.blocked.push(url.href); throw new TypeError('External requests are disabled in comfystatic')
  }
  return isApi(url) ? api(req) : realFetch(req)
}
// Axios and older custom nodes use XHR. Route these through the same local API.
class LocalXHR extends EventTarget {
  readyState = 0; status = 0; statusText = ''; response: any = null; responseText = ''; responseType: XMLHttpRequestResponseType = ''
  responseURL = ''; timeout = 0; withCredentials = false; upload = new EventTarget(); headers = new Headers(); resultHeaders = new Headers()
  onreadystatechange: any; onload: any; onerror: any; onabort: any; onloadend: any; onprogress: any; ontimeout: any
  private method = 'GET'; private url = ''; private controller = new AbortController()
  open(method: string, url: string, async = true) { if (!async) throw new Error('Synchronous XHR is not supported'); this.method = method; this.url = url; this.readyState = 1; this.fire('readystatechange') }
  setRequestHeader(k: string, v: string) { this.headers.set(k, v) }
  getAllResponseHeaders() { return [...this.resultHeaders].map(([k, v]) => `${k}: ${v}\r\n`).join('') }
  getResponseHeader(k: string) { return this.resultHeaders.get(k) }
  overrideMimeType() {}
  fire(type: string) { const event = new Event(type); this.dispatchEvent(event); (this as any)['on' + type]?.call(this, event) }
  abort() { this.controller.abort(); this.fire('abort') }
  async send(body?: BodyInit) {
    const timer = this.timeout ? setTimeout(() => { this.controller.abort(); this.fire('timeout') }, this.timeout) : undefined
    try {
      const r = await fetch(this.url, { method: this.method, headers: this.headers, body, signal: this.controller.signal })
      this.status = r.status; this.statusText = r.statusText; this.responseURL = this.url; this.resultHeaders = r.headers
      this.readyState = 2; this.fire('readystatechange')
      if (this.responseType === 'arraybuffer') this.response = await r.arrayBuffer()
      else if (this.responseType === 'blob') this.response = await r.blob()
      else { this.responseText = await r.text(); this.response = this.responseType === 'json' ? JSON.parse(this.responseText) : this.responseText }
      this.readyState = 4; this.fire('readystatechange'); this.fire('load')
    } catch { this.fire('error') } finally { clearTimeout(timer); this.fire('loadend') }
  }
  static UNSENT = 0; static OPENED = 1; static HEADERS_RECEIVED = 2; static LOADING = 3; static DONE = 4
}
window.XMLHttpRequest = LocalXHR as any
class LocalSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3; readyState = 0; binaryType = 'arraybuffer'; bufferedAmount = 0
  protocol = ''; extensions = ''; onopen: any; onmessage: any; onclose: any; onerror: any
  constructor(public url: string) {
    super()
    const target = new URL(url)
    if (target.host !== location.host || !target.pathname.endsWith('/ws')) throw new Error('WebSockets are disabled')
    setTimeout(() => { this.readyState = 1; this.emit('open', new Event('open'))
      this.message('status', { sid: crypto.randomUUID(), status: { exec_info: { queue_remaining: 0 } } })
    }, 0)
  }
  emit(type: string, event: Event) { this.dispatchEvent(event); (this as any)['on' + type]?.call(this, event) }
  message(type: string, data: unknown) { this.emit('message', new MessageEvent('message', { data: JSON.stringify({ type, data }) })) }
  send() {} close() { this.readyState = 3 }
}
window.WebSocket = LocalSocket as any
Object.defineProperty(navigator, 'sendBeacon', { value: () => false, configurable: true })
// Do not let custom-node links navigate a workflow out to an external service.
document.addEventListener('click', e => {
  const a = (e.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (a && !a.download && !['blob:', 'data:'].includes(new URL(a.href).protocol) && new URL(a.href).origin !== location.origin) {
    e.preventDefault(); window.dispatchEvent(new CustomEvent('comfystatic:notice', { detail: 'External links are disabled in this static editor.' }))
  }
}, true)
