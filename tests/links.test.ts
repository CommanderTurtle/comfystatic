import { expect, test } from 'bun:test'
import { resolveWorkflowLink, workflowViewerURL, isWorkflowLink, isWorkflowFragment } from '../src/links'
import { encodeLinkTarget } from '../src/vendor/lnkr/link-runtime.js'
import { outputAlphabetASCII, outputAlphabetEmoji } from '../src/vendor/lnkr/alphabets.js'
import { compressTextV1, compressTextV2, compressTextV3, compressTextV4 } from '../src/vendor/lnkr/text-compress.js'
import { deflate } from '../src/vendor/lnkr/vendor/pako.esm.min.js'
import provenance from '../src/vendor/lnkr/upstream.json'

const graph = { nodes: [], links: [], version: 0.4, extra: { marker: '🐢' } }
const text = JSON.stringify(graph)
const link = (url: string, mode = 's', emoji = false) => '#' + mode + ':' + encodeLinkTarget(url, emoji ? outputAlphabetEmoji : outputAlphabetASCII).payload
function fixture(files: Record<string, string | Response>) {
  const calls: { url: string; options?: RequestInit }[] = []
  const fetcher = (async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input); calls.push({ url, options })
    if (!(url in files)) throw Error('Unexpected request: ' + url)
    const value = files[url]
    return typeof value === 'string' ? new Response(value) : value!.clone()
  }) as typeof fetch
  return { calls, fetcher }
}
test('vendored ln.kr files are unchanged at their recorded remote commit', async () => {
  expect(provenance.commit).toMatch(/^[a-f0-9]{40}$/)
  for (const [path, sha] of Object.entries(provenance.files)) {
    const bytes = await Bun.file(new URL('../src/vendor/lnkr/' + path, import.meta.url)).arrayBuffer()
    expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')).toBe(sha)
  }
})
test('GitHub and HF presentation URLs reuse ln.kr raw/resolve mappings, including datasets and spaces', async () => {
  const pairs = [
    ['https://github.com/example/repo/blob/main/workflow.json', 'https://raw.githubusercontent.com/example/repo/main/workflow.json'],
    ['https://huggingface.co/example/repo/blob/main/workflow.json', 'https://huggingface.co/example/repo/resolve/main/workflow.json'],
    ['https://huggingface.co/datasets/example/repo/raw/main/workflow.json', 'https://huggingface.co/datasets/example/repo/resolve/main/workflow.json'],
    ['https://huggingface.co/spaces/example/repo/blob/main/workflow.json', 'https://huggingface.co/spaces/example/repo/resolve/main/workflow.json'],
    ['https://elsewhere.example/workflow.json?exact=1', 'https://elsewhere.example/workflow.json?exact=1']
  ]
  for (const [input, raw] of pairs) {
    const f = fixture({ [raw!]: text }), result = await resolveWorkflowLink(input!, f.fetcher)
    expect(result.workflow).toEqual(graph); expect(f.calls.map(c => c.url)).toEqual([raw!])
    expect(f.calls[0]!.options).toMatchObject({ method: 'GET', credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer' })
  }
})
test('all link-mode prefixes, ASCII/emoji and URL-escaped payloads load the same workflow', async () => {
  const url = 'https://cdn.example/workflow.json'
  for (const mode of ['l', 'lr', 'lf', 's', 'sm', 'sj', 'sh', 'hs', 'i', 'media', 'pdf']) {
    for (const emoji of [false, true]) {
      const f = fixture({ [url]: text })
      const fragment = link(url, mode, emoji)
      for (const value of [fragment, 'https://a.shel.sh/' + fragment, '#' + mode + ':' + encodeURIComponent(fragment.slice(mode.length + 2))]) {
        expect((await resolveWorkflowLink(value, f.fetcher)).workflow).toEqual(graph)
      }
    }
  }
  const legacy = await resolveWorkflowLink('#' + encodeLinkTarget(url).payload, fixture({ [url]: text }).fetcher)
  expect(legacy.fragment).toBe(link(url, 'l'))
  expect(isWorkflowFragment(legacy.fragment)).toBe(true)
})
test('exact one-line bare, markdown, anchor and nested hashtag superlinks resolve without executing anything', async () => {
  const outer = 'https://raw.githubusercontent.com/example/repo/main/pointer.txt', raw = 'https://cdn.example/workflow.json'
  const inner = link(raw)
  for (const pointer of [inner, `https://a.shel.sh/${inner}`, `[workflow](https://a.shel.sh/${inner})`, `<a href="https://a.shel.sh/${inner}">workflow</a>`]) {
    const f = fixture({ [outer]: pointer, [raw]: text })
    const result = await resolveWorkflowLink(link(outer, 'ss'), f.fetcher)
    expect(result.workflow).toEqual(graph); expect(result.sources).toEqual([outer, raw])
    expect((await resolveWorkflowLink(outer, f.fetcher)).fragment).toBe(link(outer, 'ss'))
  }
})
test('ln.kr text versions and executable wrappers decode JSON as data, not code', async () => {
  for (const compress of [compressTextV1, compressTextV2, compressTextV3, compressTextV4]) {
    for (const alphabet of [outputAlphabetASCII, outputAlphabetEmoji]) {
      const payload = compress(text, alphabet, 'text').payload
      for (const prefix of ['', 'r:', 'm:', 'h:']) {
        const f = fixture({})
        expect((await resolveWorkflowLink('#' + prefix + payload, f.fetcher)).workflow).toEqual(graph)
        expect(f.calls).toHaveLength(0)
      }
    }
  }
})
test('Make JSON share envelopes survive a superlink and never require the Make site', async () => {
  const metadata = new TextEncoder().encode(JSON.stringify({ name: 'workflow.json', mime: 'application/json' }))
  const data = new TextEncoder().encode(text), record = new Uint8Array(9 + metadata.length + data.length)
  record.set([77, 75, 73, 84, 1]); new DataView(record.buffer).setUint32(5, metadata.length, false)
  record.set(metadata, 9); record.set(data, 9 + metadata.length)
  const make = 'https://app.shel.sh/make/#p:' + Buffer.from(deflate(record)).toString('base64url')
  const pointer = 'https://cdn.example/pointer.txt', f = fixture({ [pointer]: make })
  expect((await resolveWorkflowLink(link(pointer, 'ss'), f.fetcher)).workflow).toEqual(graph)
  expect(f.calls.map(c => c.url)).toEqual([pointer])
  for (const fragment of [new URL(make).hash, new URL(make).hash.replace(/^#p:/, '#share:')]) {
    const bare = fixture({ [pointer]: fragment })
    expect((await resolveWorkflowLink(link(pointer, 'ss'), bare.fetcher)).workflow).toEqual(graph)
    expect(bare.calls.map(c => c.url)).toEqual([pointer])
  }
})
test('metadata media stays binary for Comfy’s native importer', async () => {
  const url = 'https://cdn.example/workflow.png', bytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
  const f = fixture({ [url]: new Response(bytes, { headers: { 'content-type': 'image/png' } }) })
  const result = await resolveWorkflowLink(link(url, 'i'), f.fetcher)
  expect(result.bytes).toEqual(bytes); expect(result.workflow).toBeUndefined(); expect(result.name).toBe('workflow.png')
})
test('invalid workflows, failed reads, circular pointers, oversized responses and cancellation fail cleanly', async () => {
  const url = 'https://cdn.example/file.txt'
  for (const value of ['not a workflow', '<script>globalThis.bad = true</script>', 'https://cdn.example/one\nhttps://cdn.example/two']) {
    await expect(resolveWorkflowLink(url, fixture({ [url]: value }).fetcher)).rejects.toThrow()
  }
  await expect(resolveWorkflowLink(link(url, 'ss'), fixture({ [url]: text }).fetcher)).rejects.toThrow('one-line')
  await expect(resolveWorkflowLink(url, fixture({ [url]: url }).fetcher)).rejects.toThrow('circular')
  await expect(resolveWorkflowLink(url, fixture({ [url]: new Response('', { status: 404 }) }).fetcher)).rejects.toThrow('404')
  await expect(resolveWorkflowLink(url, fixture({ [url]: new Response('', { headers: { 'content-length': '33554433' } }) }).fetcher)).rejects.toThrow('32 MiB')
  await expect(resolveWorkflowLink('file:///private', fixture({}).fetcher)).rejects.toThrow()
  await expect(resolveWorkflowLink('https://user:password@cdn.example/file', fixture({}).fetcher)).rejects.toThrow('Credentials')
  await expect(resolveWorkflowLink(url, fixture({}).fetcher, AbortSignal.abort())).rejects.toThrow()
})
test('viewer URLs use the current deployment, including nested paths, with no hardcoded host', () => {
  expect(workflowViewerURL('#ss:example', 'https://app.example/comfy/?old=1#old')).toBe('https://app.example/comfy/#ss:example')
  expect(isWorkflowLink('#ss:example')).toBe(true); expect(isWorkflowLink('https://cdn.example/a.json')).toBe(true)
  expect(isWorkflowLink('{"nodes":[]}')).toBe(false)
  expect(isWorkflowFragment('#ss:example')).toBe(true)
  expect(isWorkflowFragment('#91f6bbe2-ed41-4fd6-bac7-71d5b5864ecb')).toBe(false)
  expect(isWorkflowFragment('#ordinary-native-navigation')).toBe(false)
})
