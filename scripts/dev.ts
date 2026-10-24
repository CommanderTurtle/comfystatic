import { resolve } from 'node:path'
import { syncOptions, syncHelp } from './source-options'

const args = process.argv.slice(2)
const cached = args.includes('--cached')
const syncArgs = args.filter(arg => arg !== '--cached')
const options = syncOptions(syncArgs, process.env)
if (options.help) {
  console.log(syncHelp + '\nDev only: --cached builds the existing cache without sync. HOST, PORT and BASE_PATH configure the static server.')
  process.exit(0)
}
if (cached && syncArgs.some(arg => arg !== '--')) throw Error('--cached cannot be combined with sync options; omit it to update/copy a source.')
const root = resolve(import.meta.dir, '..')
for (const script of [...(cached ? [] : ['sync']), 'build', 'serve']) {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, script + '.ts'), ...(script === 'sync' ? syncArgs : [])],
    { cwd: root, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', env: process.env })
  const stop = () => child.kill()
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
  const code = await child.exited
  process.off('SIGINT', stop); process.off('SIGTERM', stop)
  if (code !== 0) process.exit(code)
}
