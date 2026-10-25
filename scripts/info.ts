import { resolve, join } from 'node:path'
import { coreNodes } from '../src/core-nodes'
import { sourceConfig } from './project-source'

const root = resolve(import.meta.dir, '../source')
const metadata = Bun.file(join(root, 'frontend.json'))
if (!await metadata.exists()) throw Error('No cached frontend. Run bun run dev, or bun run sync --help for source options.')
const frontend = await metadata.json()
const nodes = Bun.file(join(root, 'snapshot/nodes.json'))
const capture = Bun.file(join(root, 'snapshot/capture.json'))
const selection = Bun.file(join(root, 'selection.json'))
const report = { frontend,
  rememberedSource: await Bun.file(resolve(root, '..', sourceConfig)).exists()
    ? await Bun.file(resolve(root, '..', sourceConfig)).json() : null,
  selection: await selection.exists() ? await selection.json() : 'Older sync; source details are in frontend metadata above.',
  nodeDefinitions: await nodes.exists() ? { source: 'captured /object_info', count: Object.keys(await nodes.json()).length,
    capture: await capture.exists() ? await capture.json() : 'Older snapshot; capture origin not recorded.' }
    : { source: 'small starter catalog, NOT the complete ComfyUI/custom-node library', count: Object.keys(coreNodes).length },
  cache: root, build: resolve(root, '../dist'),
  note: 'Build copies native JS/CSS unchanged; the separate Comfystatic adapter supplies browser-local storage/API stubs. No Python execution backend.' }
console.log(JSON.stringify(report, null, 2))
