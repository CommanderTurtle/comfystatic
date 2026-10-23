import { mkdir, rename, rm, cp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { unzipSync } from 'fflate'
import { syncLnkr } from './sync-lnkr'

const root = resolve(import.meta.dir, '..')
const args = process.argv.slice(2)
function option(name: string) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
async function get(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!r.ok) throw new Error(`${r.status}: ${url}`)
  return r
}
await mkdir(join(root, 'source'), { recursive: true })
const frontendDir = option('--frontend-dir')
if (frontendDir) {
  const native = resolve(frontendDir)
  if (!await Bun.file(join(native, 'index.html')).exists()) throw new Error('--frontend-dir must contain the native index.html')
  const pending = join(root, 'source', `pending-${Date.now()}`)
  await cp(native, pending, { recursive: true })
  await rm(join(root, 'source/native'), { recursive: true, force: true })
  await rename(pending, join(root, 'source/native'))
  await Bun.write(join(root, 'source/frontend.json'), JSON.stringify({ version: option('--version') ?? 'local', source: 'Local ComfyUI frontend' }, null, 2) + '\n')
} else {
const requirementsUrl = 'https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/requirements.txt'
const version = option('--version') ?? (await (await get(requirementsUrl)).text()).match(/^comfyui-frontend-package==([^\s]+)$/m)?.[1]
if (!version || !/^\d+\.\d+\.\d+(?:[a-z\d.]*)?$/.test(version)) throw new Error('Cannot resolve portable frontend version; specify --version X.Y.Z')
const metadata = await (await get(`https://pypi.org/pypi/comfyui-frontend-package/${version}/json`)).json() as any
const wheel = metadata.urls.find((f: any) => f.filename.endsWith('.whl'))
if (!wheel) throw new Error(`No native frontend wheel for ${version}`)
console.log(`Downloading native ComfyUI frontend ${version}`)
const bytes = new Uint8Array(await (await get(wheel.url)).arrayBuffer())
const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
if (hash !== wheel.digests.sha256) throw new Error('Frontend checksum mismatch')
const pending = join(root, 'source', `pending-${Date.now()}`)
await mkdir(pending)
for (const [path, content] of Object.entries(unzipSync(bytes))) {
  const prefix = 'comfyui_frontend_package/static/'
  if (!path.startsWith(prefix) || path.endsWith('/')) continue
  const rel = path.slice(prefix.length)
  if (rel.split(/[\\/]/).includes('..')) throw new Error('Unsafe archive path')
  await Bun.write(join(pending, rel), content)
}
if (!await Bun.file(join(pending, 'index.html')).exists()) throw new Error('Native index missing')
// Only replace our generated cache after the download has been verified/extracted.
await rm(join(root, 'source/native'), { recursive: true, force: true })
await rename(pending, join(root, 'source/native'))
await Bun.write(join(root, 'source/frontend.json'), JSON.stringify({ version, wheel: wheel.url, sha256: hash,
  source: `https://github.com/Comfy-Org/ComfyUI_frontend/tree/v${version}` }, null, 2) + '\n')
}

const comfyUrl = option('--comfy-url')
if (comfyUrl) {
  const origin = new URL(comfyUrl.endsWith('/') ? comfyUrl : comfyUrl + '/')
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('--comfy-url must be HTTP(S)')
  const defs = await (await get(new URL('object_info', origin).href)).json() as Record<string, unknown>
  if (!Object.keys(defs).length) throw new Error('ComfyUI returned no node definitions')
  const extensions = await (await get(new URL('extensions', origin).href)).json() as string[]
  const snapshot = join(root, 'source/snapshot')
  const stage = join(root, 'source', `snapshot-${Date.now()}`)
  const queue = extensions.filter(p => !p.includes('/extensions/core/'))
  const seen = new Set<string>()
  const failures: string[] = []
  for (let i = 0; i < queue.length; i++) {
    const url = new URL(queue[i]!, origin)
    if (url.origin !== origin.origin) { failures.push(`External extension asset: ${url.href}`); continue }
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (path.split('/').includes('..') || path.includes('\\') || path.includes(':')) throw new Error('Unsafe extension asset path')
    if (seen.has(path) || !path.startsWith('extensions/')) continue
    seen.add(path)
    try {
      const file = await get(url.href)
      const data = new Uint8Array(await file.arrayBuffer())
      await Bun.write(join(stage, 'web', path), data)
      if (/\.(?:js|mjs|css)$/.test(path)) {
        const text = new TextDecoder().decode(data)
        // Follow static/literal imports, re-exports, dynamic imports and URL assets.
        const refs = /(?:from\s*|import\s*\(?\s*|new\s+URL\(\s*|url\(\s*)["']([^"']+)["']/g
        for (const m of text.matchAll(refs)) {
          if (m[1]!.startsWith('.') || m[1]!.startsWith('/extensions/')) queue.push(new URL(m[1]!, url).href)
        }
      }
    } catch (e) { failures.push(String(e)) }
  }
  if (failures.length) throw new Error(`Snapshot incomplete; previous snapshot preserved.\n${failures.join('\n')}`)
  await Bun.write(join(stage, 'nodes.json'), JSON.stringify(defs))
  await Bun.write(join(stage, 'extensions.json'), JSON.stringify(extensions.filter(p => !p.includes('/extensions/core/'))))
  await rm(snapshot, { recursive: true, force: true })
  await rename(stage, snapshot)
  console.log(`Captured ${Object.keys(defs).length} node definitions and ${seen.size} frontend assets`)
}
// For extensions with computed asset paths, copy the complete WEB_DIRECTORY.
for (let i = 0; i < args.length; i++) if (args[i] === '--custom-web') {
  const value = args[++i] ?? ''; const split = value.indexOf('=')
  const name = value.slice(0, split); const dir = value.slice(split + 1)
  if (split < 1 || !/^[\w.-]+$/.test(name) || name === '..') throw new Error('--custom-web expects extension-name=directory')
  await cp(resolve(dir), join(root, 'source/snapshot/web/extensions', name), { recursive: true })
}
await syncLnkr()
console.log('Source ready. Run bun run build. Existing node snapshots are retained unless --comfy-url replaces them.')
