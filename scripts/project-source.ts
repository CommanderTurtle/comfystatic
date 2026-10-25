import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { syncOptions } from './source-options'

export const sourceConfig = 'comfystatic.local.json'
export async function projectOptions(root: string, args: string[], env = process.env) {
  let saved: { comfyDir?: string; frontendDir?: string; version?: string } = {}
  try { saved = JSON.parse(await readFile(join(root, sourceConfig), 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error(`Invalid ${sourceConfig}`, { cause: error }) }
  const explicitSource = args.some(arg => ['--comfy-dir', '--frontend-dir', '--version', '--upstream'].includes(arg)) || env.COMFY_DIR
  const defaults = explicitSource ? [] : [saved.comfyDir && ['--comfy-dir', saved.comfyDir],
    saved.frontendDir && ['--frontend-dir', saved.frontendDir], saved.version && ['--version', saved.version]].filter(Boolean).flat() as string[]
  return syncOptions([...defaults, ...args], env)
}
