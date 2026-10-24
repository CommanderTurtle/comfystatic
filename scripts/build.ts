import { cp, mkdir, rm, rename } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { coreNodes } from '../src/core-nodes'

const root = resolve(import.meta.dir, '..')
const source = join(root, 'source')
const metadata = Bun.file(join(source, 'frontend.json'))
if (!await metadata.exists()) throw new Error('Run bun run sync first.')
const version = await metadata.json()
const stage = join(root, `.work/build-${Date.now()}`)
await mkdir(stage, { recursive: true })
await cp(join(source, 'native'), stage, { recursive: true })
const nodes = Bun.file(join(source, 'snapshot/nodes.json'))
const extensions = Bun.file(join(source, 'snapshot/extensions.json'))
const custom = await extensions.exists() ? await extensions.json() : []
if (custom.length) await cp(join(source, 'snapshot/web'), stage, { recursive: true })
await Bun.write(join(stage, 'comfystatic/nodes.json'), JSON.stringify(await nodes.exists() ? await nodes.json() : coreNodes))
await Bun.write(join(stage, 'comfystatic/config.json'), JSON.stringify({ frontend: version.version,
  extensions: [...custom, '/extensions/comfystatic/editor.js'], capturedNodes: await nodes.exists() }))
for (const [entry, output, format] of [['src/offline.ts', 'comfystatic/offline.js', 'iife'],
  ['src/link-frame.ts', 'comfystatic/link-import.js', 'iife'],
  ['src/editor.ts', 'extensions/comfystatic/editor.js', 'esm']] as const) {
  const result = await Bun.build({ entrypoints: [join(root, entry)], target: 'browser', format,
    minify: false, external: ['../../scripts/app.js'] })
  if (!result.success) throw new Error(result.logs.join('\n'))
  await Bun.write(join(stage, output), result.outputs[0]!)
}
await cp(join(root, 'src/editor.css'), join(stage, 'comfystatic/editor.css'))
await cp(join(root, 'src/link-import.html'), join(stage, 'comfystatic/link-import.html'))
for (const [input, output] of [['LICENSE', 'lnkr-LICENSE'], ['upstream.json', 'lnkr-upstream.json'],
  ['vendor/licenses/pako-NOTICE.txt', 'pako-NOTICE.txt']]) {
  await cp(join(root, 'src/vendor/lnkr', input!), join(stage, 'comfystatic', output!))
}
const csp = "default-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'"
let html = await Bun.file(join(stage, 'index.html')).text()
html = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><script src="./comfystatic/offline.js"></script><link rel="stylesheet" href="./comfystatic/editor.css">`)
html = html.replace(/<title>[^<]*<\/title>/, '<title>comfystatic</title>')
// Native splash cleanup uses inline JS. Move it to a same-origin file for CSP.
let inline = 0
const inlineWrites: Promise<number>[] = []
html = html.replace(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g, (_, attrs, code) => {
  const name = `comfystatic/native-inline-${inline++}.js`
  inlineWrites.push(Bun.write(join(stage, name), code))
  return `<script${attrs} src="./${name}"></script>`
})
await Promise.all(inlineWrites)
await Bun.write(join(stage, 'index.html'), html)
await Bun.write(join(stage, 'user.css'), '')
await Bun.write(join(stage, 'api/userdata/user.css'), '')
await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'))
await Bun.write(join(stage, 'comfystatic/upstream.json'), JSON.stringify(version, null, 2))
// Preserve prior dist if compilation fails; replace only a complete generated build.
await rm(join(root, 'dist'), { recursive: true, force: true })
await rename(stage, join(root, 'dist'))
console.log(`Built dist using native ComfyUI ${version.version}. Static files only; no Python/server runtime.`)
