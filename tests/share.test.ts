import { expect, test } from 'bun:test'
import { workflowFragment, sourceFragment, makeWorkflowURL, hoistWorkflowURL } from '../src/share'
import { resolveWorkflowLink, isWorkflowFragment, workflowViewerURL } from '../src/links'
import { decodeMakeFile } from '../src/vendor/lnkr/make-resource.js'
import { installShareRoute } from '../src/share-route'

const graph = { nodes: [{ id: 1, type: 'Custom', widgets_values: ['🐢\n{}', 'text '.repeat(1000)] }], links: [], version: 0.4, extra: { unknown: true } }
const noFetch = (async () => { throw Error('Embedded links must not fetch') }) as typeof fetch

test('uploaded JSON uses Make DEFLATE and reloads with no server/source dependency', async () => {
  const fragment = workflowFragment(JSON.stringify(graph, null, 2))
  expect(fragment.startsWith('#share:')).toBe(true)
  expect(new URL(hoistWorkflowURL(fragment)).hash).toBe(fragment)
  expect(JSON.parse(decodeMakeFile(hoistWorkflowURL(fragment)).text!)).toEqual(graph)
  expect(fragment.length).toBeLessThan(JSON.stringify(graph).length / 2)
  const url = workflowViewerURL(fragment, 'https://app.example/comfy/')
  expect(isWorkflowFragment(new URL(url).hash)).toBe(true)
  expect((await resolveWorkflowLink(url, noFetch)).workflow).toEqual(graph)
})

test('Make JSON envelopes roundtrip directly, as bare hashtags and as Comfystatic URLs', async () => {
  const make = makeWorkflowURL(graph, 'my workflow.json')
  expect(decodeMakeFile(make).name).toBe('my workflow.json')
  expect(JSON.parse(decodeMakeFile(make).text!)).toEqual(graph)
  for (const input of [make, new URL(make).hash, new URL(make).hash.slice(1), workflowViewerURL(new URL(make).hash, 'https://app.example/comfy/')]) {
    expect((await resolveWorkflowLink(input, noFetch)).workflow).toEqual(graph)
  }
})

test('source links are short, preserve supplied hashtag codes, and fetch the same JSON', async () => {
  const source = 'https://huggingface.co/sHEL1562/shelling/raw/main/src/1-5%20Latest%20Gen%20Pipeline.json'
  const fragment = sourceFragment(source)
  expect(fragment.startsWith('#s:')).toBe(true)
  expect((await resolveWorkflowLink(fragment, (async () => new Response(JSON.stringify(graph))) as typeof fetch)).workflow).toEqual(graph)
  for (const code of [fragment, '#lr:' + fragment.slice(3), '#ss:' + fragment.slice(3), workflowFragment(graph)]) {
    expect(sourceFragment('https://a.shel.sh/' + code)).toBe(code)
    expect(sourceFragment(code)).toBe(code)
  }
})

function browser(url: string) {
  const events = new EventTarget(), location = new URL(url)
  const history: any = { state: null }
  for (const method of ['pushState', 'replaceState']) history[method] = (state: any, _title: string, value?: string | URL | null) => {
    history.state = state
    if (value != null) location.href = new URL(String(value), location).href
  }
  return { location, history, addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) } as unknown as Window
}

test('native UUID writes cannot erase the imported workflow; native history state is retained', () => {
  const fragment = workflowFragment(graph), win = browser('https://app.example/comfy/' + fragment)
  const imports: string[] = [], route = installShareRoute(win, value => imports.push(value))
  expect(route.initial).toBe(fragment); expect(win.location.hash).toBe('')
  const uuid = '#91f6bbe2-ed41-4fd6-bac7-71d5b5864ecb'
  win.history.replaceState({ current: uuid }, '', uuid) // Native bootstrap sees only its own route.
  expect(win.location.hash).toBe(uuid)
  route.set(fragment)
  for (const method of ['pushState', 'replaceState'] as const) {
    win.history[method]({ current: uuid, position: 2 }, '', uuid)
    expect(win.location.hash).toBe(fragment)
    expect(win.history.state).toEqual({ current: uuid, position: 2 })
  }
  const other = sourceFragment('https://example.test/next.json')
  win.location.hash = other
  win.dispatchEvent(new Event('hashchange'))
  expect(imports).toEqual([other])
  win.dispatchEvent(new Event('popstate'))
  expect(imports).toHaveLength(1) // Hashchange/popstate must not dispatch twice.
})

test('invalid JSON and non-HTTP sources fail without fabricating a share link', () => {
  expect(() => workflowFragment('{broken')).toThrow()
  expect(() => sourceFragment('file:///private')).toThrow()
  expect(() => sourceFragment('https://name:secret@example.test/a.json')).toThrow()
})
