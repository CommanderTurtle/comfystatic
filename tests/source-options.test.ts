import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile, readFile, copyFile, symlink, unlink, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { localSource, syncOptions } from '../scripts/source-options'

test('sync options are explicit, strict and allow environment defaults', () => {
  expect(syncOptions([], { COMFY_DIR: '/local/comfy', COMFY_URL: 'http://localhost:8188' }).comfyDir).toBe('/local/comfy')
  expect(syncOptions(['--frontend-dir', '/assets'], { COMFY_DIR: '/ignored' }).comfyDir).toBeUndefined()
  expect(syncOptions(['--custom-web', 'a=/web', '--skip-lnkr']).customWeb).toEqual(['a=/web'])
  for (const args of [['--typo'], ['--version'], ['--version', 'latest'], ['--comfy-dir', 'a', '--frontend-dir', 'b']]) expect(() => syncOptions(args)).toThrow()
})
test('finds native assets in a portable root or a built frontend clone, never its dev entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'comfystatic-source-'))
  try {
    await mkdir(join(dir, 'python_embeded/Lib/site-packages/comfyui_frontend_package/static'), { recursive: true })
    await writeFile(join(dir, 'python_embeded/Lib/site-packages/comfyui_frontend_package/static/index.html'), '<script type="module" src="./assets/native.js"></script>')
    await mkdir(join(dir, 'python_embeded/Lib/site-packages/comfyui_frontend_package-1.57.1.dist-info'))
    await writeFile(join(dir, 'python_embeded/Lib/site-packages/comfyui_frontend_package-1.57.1.dist-info/METADATA'), 'Name: comfyui_frontend_package\nVersion: 1.57.1\n')
    const portable = await localSource(syncOptions(['--comfy-dir', dir]))
    expect(portable?.directory).toContain('comfyui_frontend_package')
    expect(portable?.version).toBe('1.57.1')
    await mkdir(join(dir, 'clone/dist'), { recursive: true })
    await writeFile(join(dir, 'clone/index.html'), '<script type="module" src="/src/main.ts"></script>')
    await writeFile(join(dir, 'clone/dist/index.html'), '<script src="./assets/native.js"></script>')
    await writeFile(join(dir, 'clone/package.json'), '{"name":"comfyui-frontend","version":"1.58.0"}')
    const clone = await localSource(syncOptions(['--comfy-dir', join(dir, 'clone')]))
    expect(clone?.directory).toEndWith('dist')
    expect(clone?.version).toBe('1.58.0')
    await expect(localSource(syncOptions(['--frontend-dir', join(dir, 'clone')]))).rejects.toThrow('No built ComfyUI frontend')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('a backend checkout selects its requirements pin without executing Python', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'comfystatic-requirements-'))
  try {
    await writeFile(join(dir, 'requirements.txt'), 'torch\ncomfyui-frontend-package==1.56.4\n')
    const source = await localSource(syncOptions(['--comfy-dir', dir]))
    expect(source?.version).toBe('1.56.4')
    expect(source?.directory).toBeUndefined()
    expect(source?.requirements).toEndWith('requirements.txt')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('local sync copies assets, records provenance and retains node captures without network or installs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'comfystatic-local-sync-'))
  const dependencies = join(dir, 'node_modules')
  let linked = false
  try {
    await mkdir(join(dir, 'scripts'))
    for (const name of ['sync.ts', 'sync-lnkr.ts', 'source-options.ts']) await copyFile(resolve(import.meta.dir, '../scripts', name), join(dir, 'scripts', name))
    await symlink(resolve(import.meta.dir, '../node_modules'), dependencies, process.platform === 'win32' ? 'junction' : 'dir')
    linked = true
    await mkdir(join(dir, 'native/assets'), { recursive: true })
    await mkdir(join(dir, 'source/snapshot'), { recursive: true })
    await writeFile(join(dir, 'native/index.html'), '<script type="module" src="./assets/native.js"></script>')
    await writeFile(join(dir, 'native/assets/native.js'), '/* original native bytes */')
    await writeFile(join(dir, 'source/snapshot/nodes.json'), '{"ExistingCapture":{}}')
    const result = spawnSync(process.execPath, ['scripts/sync.ts', '--frontend-dir', join(dir, 'native'), '--version', '1.57.1', '--skip-lnkr'],
      { cwd: dir, encoding: 'utf8', windowsHide: true, env: { ...process.env, COMFY_URL: '', COMFY_DIR: '' } })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const metadata = JSON.parse(await readFile(join(dir, 'source/frontend.json'), 'utf8'))
    expect(metadata.version).toBe('1.57.1')
    expect(metadata.directory).toBeUndefined()
    const selection = JSON.parse(await readFile(join(dir, 'source/selection.json'), 'utf8'))
    expect(selection.directory).toBe(await realpath(join(dir, 'native')))
    expect(metadata.indexSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(await readFile(join(dir, 'source/native/assets/native.js'), 'utf8')).toBe('/* original native bytes */')
    expect(await readFile(join(dir, 'source/snapshot/nodes.json'), 'utf8')).toBe('{"ExistingCapture":{}}')
  } finally {
    if (linked) await unlink(dependencies)
    await rm(dir, { recursive: true, force: true })
  }
})
