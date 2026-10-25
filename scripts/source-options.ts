import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { resolve, join, dirname, basename } from 'node:path'

export const syncHelp = `Sync native ComfyUI browser assets (never runs Python or git pull).

bun run sync [options]
bun run build [options]        import/remember a local source and build dist; no server
bun run dev [options]          sync, build, then serve; no Vitality needed

  --comfy-dir PATH             ComfyUI installation/portable folder or built frontend clone
  --frontend-dir PATH          Exact built browser-assets folder containing index.html
  --version X.Y.Z              Pin a published frontend, or label local assets
  --comfy-url URL              Capture actual /object_info and custom frontend modules
  --custom-web NAME=PATH       Include a complete trusted extension web directory
  --skip-lnkr                  Leave the vendored ln.kr library unchanged
  --upstream                   Forget the saved local source and follow upstream
  --help                      Show this help without downloading/building anything

Without an explicit or remembered source, sync reads upstream ComfyUI master/requirements.txt and
downloads its pinned official frontend wheel, verifying the PyPI SHA-256.
COMFY_DIR and COMFY_URL can supply local defaults. Local directories are read,
not updated or built. If only a backend checkout is found, its requirements.txt
selects the official wheel. Custom Python node definitions require --comfy-url.
`
export function syncOptions(args: string[], env: Record<string, string | undefined> = {}) {
  const values = new Map<string, string>(), customWeb: string[] = []
  const flags = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const name = args[i]!
    if (name === '--') continue
    if (['--help', '--skip-lnkr', '--upstream'].includes(name)) { flags.add(name); continue }
    if (!['--comfy-dir', '--frontend-dir', '--comfy-url', '--version', '--custom-web'].includes(name)) throw Error(`Unknown option: ${name}. Use --help.`)
    const value = args[++i]
    if (!value || value.startsWith('--')) throw Error(`${name} requires a value.`)
    if (name === '--custom-web') customWeb.push(value)
    else if (values.has(name)) throw Error(`Specify ${name} only once.`)
    else values.set(name, value)
  }
  const frontendDir = values.get('--frontend-dir')
  const comfyDir = values.get('--comfy-dir') ?? (frontendDir || flags.has('--upstream') ? undefined : env.COMFY_DIR)
  if (flags.has('--upstream') && (frontendDir || comfyDir)) throw Error('--upstream cannot be combined with a local source.')
  if (frontendDir && comfyDir) throw Error('Choose --comfy-dir or --frontend-dir, not both.')
  const version = values.get('--version')
  if (version && !/^\d+\.\d+\.\d+(?:[a-z\d.]*)?$/.test(version)) throw Error('--version expects a frontend release such as 1.57.1.')
  const comfyUrl = values.get('--comfy-url') ?? env.COMFY_URL
  if (comfyUrl && !['http:', 'https:'].includes(new URL(comfyUrl).protocol)) throw Error('--comfy-url must be HTTP(S).')
  for (const value of customWeb) if (!/^(?!\.\.=)[\w.-]+=.+$/.test(value)) throw Error('--custom-web expects extension-name=directory.')
  return { frontendDir, comfyDir, comfyUrl, version,
    customWeb, upstream: flags.has('--upstream'), skipLnkr: flags.has('--skip-lnkr'), help: flags.has('--help') }
}
async function isFile(path: string) { try { return (await stat(path)).isFile() } catch { return false } }
async function requirements(dir: string) {
  for (const file of [join(dir, 'requirements.txt'), join(dir, 'ComfyUI/requirements.txt')]) {
    if (!await isFile(file)) continue
    const version = (await readFile(file, 'utf8')).match(/^[ \t]*comfyui-frontend-package[ \t]*==[ \t]*([^\s;#]+)/m)?.[1]
    if (version) return { version, file }
  }
}
async function localVersion(frontend: string, requested: string) {
  for (const dir of [requested, dirname(frontend)]) {
    try { const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')); if (/comfy.*frontend/i.test(pkg.name ?? '') && typeof pkg.version === 'string') return pkg.version } catch {}
  }
  const site = dirname(dirname(frontend))
  if (basename(dirname(frontend)) === 'comfyui_frontend_package') {
    for (const entry of await readdir(site)) if (/^comfyui_frontend_package-.+\.dist-info$/i.test(entry)) {
      const match = (await readFile(join(site, entry, 'METADATA'), 'utf8')).match(/^Version:\s*(\S+)/m)
      if (match) return match[1]
    }
  }
  return (await requirements(requested))?.version ?? 'local'
}
async function builtFrontend(dir: string) {
  const index = join(dir, 'index.html')
  if (!await isFile(index)) return false
  // Do not mistake the frontend repository's Vite development entry for a build.
  const html = await readFile(index, 'utf8')
  return !await isFile(join(dir, 'comfystatic/config.json')) && !/<script\b[^>]*src=["'](?:\.?\/)?src\/[^"']+\.(?:ts|tsx)(?:[?#][^"']*)?["']/i.test(html)
}
interface LocalSource { directory?: string; version: string; requested: string; requirements?: string }
export async function localSource(options: ReturnType<typeof syncOptions>): Promise<LocalSource | undefined> {
  if (!options.frontendDir && !options.comfyDir) return undefined
  const requested = await realpath(resolve(options.frontendDir ?? options.comfyDir!))
  if (!(await stat(requested)).isDirectory()) throw Error('Comfy source must be a directory.')
  const candidates = options.frontendDir ? [requested] : [
    join(requested, 'dist'), join(requested, 'comfyui_frontend_package/static'),
    ...['python_embeded', 'python_embedded', '.venv', 'venv', 'ComfyUI/.venv', 'ComfyUI/venv']
      .map(env => join(requested, env, 'Lib/site-packages/comfyui_frontend_package/static')),
  ]
  if (!options.frontendDir) {
    for (const env of ['.venv', 'venv', 'ComfyUI/.venv', 'ComfyUI/venv']) {
      const lib = join(requested, env, 'lib')
      try { for (const entry of await readdir(lib)) if (/^python\d+\.\d+$/.test(entry)) candidates.push(join(lib, entry, 'site-packages/comfyui_frontend_package/static')) } catch {}
    }
    candidates.push(join(requested, 'web'), requested)
  }
  for (const candidate of candidates) if (await builtFrontend(candidate)) {
    return { directory: await realpath(candidate), version: options.version ?? await localVersion(candidate, requested), requested }
  }
  const pin = options.frontendDir ? undefined : await requirements(requested)
  if (pin) return { version: options.version ?? pin.version, requirements: pin.file, requested }
  throw Error(`No built ComfyUI frontend found in ${requested}. Build a frontend clone first, or use --frontend-dir for its built assets. A backend checkout must pin comfyui-frontend-package in requirements.txt.`)
}
