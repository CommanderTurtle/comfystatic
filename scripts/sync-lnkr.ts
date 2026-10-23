import { resolve, join } from 'node:path'

const repository = 'CommanderTurtle/ln.kr'
const paths = ['docs/alphabets.js', 'docs/compress.js', 'docs/link-runtime.js',
  'docs/viewer-runtime.js', 'docs/payload.js', 'docs/text-compress.js',
  'docs/make-resource.js', 'docs/vendor/pako.esm.min.js',
  'docs/vendor/licenses/pako-NOTICE.txt', 'LICENSE']

// Import the upstream library verbatim, not its UI or a second implementation.
export async function syncLnkr() {
  const get = async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw Error(`ln.kr sync: HTTP ${response.status} (${url})`)
    return response
  }
  const commit = await (await get(`https://api.github.com/repos/${repository}/commits/main`)).json() as { sha: string }
  if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw Error('ln.kr sync: invalid commit')
  // Fetch everything before updating the committed snapshot.
  const entries = await Promise.all(paths.map(async path => {
    const bytes = new Uint8Array(await (await get(`https://raw.githubusercontent.com/${repository}/${commit.sha}/${path}`)).arrayBuffer())
    return { path: path.replace(/^docs\//, ''), bytes, sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex') }
  }))
  const destination = resolve(import.meta.dir, '../src/vendor/lnkr')
  for (const entry of entries) await Bun.write(join(destination, entry.path), entry.bytes)
  await Bun.write(join(destination, 'upstream.json'), JSON.stringify({ repository, commit: commit.sha,
    files: Object.fromEntries(entries.map(entry => [entry.path, entry.sha256])) }, null, 2) + '\n')
  console.log(`Synced ln.kr library ${commit.sha.slice(0, 7)} (unchanged source)`)
}

if (import.meta.main) await syncLnkr()
