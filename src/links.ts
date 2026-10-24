import { decodeLinkTarget, decodeQRLinkTarget, encodeLinkTarget, extractSingleLinkDocument, sourceResourceURL,
  splitLinkFragment, validateLinkTarget } from './vendor/lnkr/link-runtime.js'
import { decodeDocumentPayload } from './vendor/lnkr/payload.js'
import { splitExecutableFragment } from './vendor/lnkr/viewer-runtime.js'
import { decodeMakeFile, isMakeLink } from './vendor/lnkr/make-resource.js'
import { parseWorkflow } from './workflow'

export type LinkedWorkflow = { bytes: Uint8Array; name: string; mime: string; fragment: string; sources: string[]; workflow?: any }
const maxBytes = 32 * 1024 * 1024
const maxHops = 12
const modes = /^(?:ss|s|sm|sj|sh|hs|lr|l|lf|i|media|pdf|share|p):/
const base = 'https://comfystatic.invalid/' // Only a base for bare fragment pointers, never fetched.

export function isWorkflowLink(input: string) {
  return /^(?:https?:\/\/\S+|#[^\s]+|(?:ss|s|sm|sj|sh|hs|lr|l|lf|i|media|pdf|share|p):\S+)$/i.test(input.trim())
}

function locator(input: string): { target?: string; fragment?: string; text?: string; superlink?: boolean } {
  const value = input.trim()
  if (!value) throw Error('Enter a workflow URL or ln.kr fragment.')
  if (/^#?(?:share|p):/.test(value)) return { target: 'https://app.shel.sh/make/' + (value.startsWith('#') ? value : '#' + value), fragment: value.startsWith('#') ? value : '#' + value }
  const bare = value.startsWith('#') || modes.test(value)
  const url = bare ? new URL(value.startsWith('#') ? value : '#' + value, base) : new URL(validateLinkTarget(value))
  const fragment = url.hash.slice(1)
  if (/^(?:share|p):/.test(fragment)) return { target: 'https://app.shel.sh/make/#' + fragment, fragment: '#' + fragment }
  const route = splitLinkFragment(fragment)
  if (route.mode) return { target: decodeLinkTarget(route.payload).target, fragment: '#' + fragment, superlink: route.mode === 'super-source' }
  if (fragment) {
    const executable = splitExecutableFragment(fragment)
    try {
      const text = decodeDocumentPayload(executable.payload).decoded.text
      return { text, fragment: '#' + fragment }
    } catch (error) {
      if (bare && !executable.executableKind) {
        for (const decode of [decodeLinkTarget, decodeQRLinkTarget]) {
          try {
            const target = decode(fragment).target
            return { target, fragment: '#l:' + encodeLinkTarget(target).payload }
          } catch { /* Try the next upstream alphabet. */ }
        }
      }
      if (bare || executable.executableKind) throw Error('Invalid ln.kr document payload.', { cause: error })
    }
  }
  if (bare) throw Error('Invalid ln.kr fragment.')
  return { target: url.href }
}

export function isWorkflowFragment(fragment: string) {
  if (!fragment.startsWith('#') || fragment.length < 2 || /^#[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(fragment)) return false
  if (/^#(?:ss|s|sm|sj|sh|hs|lr|l|lf|i|media|pdf|r|m|h|share|p):/.test(fragment)) return true
  // Unprefixed text has an upstream magic/checksum. Legacy URL digits do not;
  // do not misclassify arbitrary native navigation as a compressed URL.
  try { decodeDocumentPayload(fragment.slice(1)); return true } catch { return false }
}

function fileName(target: string) {
  try { return decodeURIComponent(new URL(target).pathname.split('/').pop() || 'workflow.json') } catch { return 'workflow.json' }
}

async function read(response: Response, budget: number) {
  if (Number(response.headers.get('content-length')) > budget) throw Error('Workflow link exceeds 32 MiB.')
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > budget) throw Error('Workflow link exceeds 32 MiB.')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

// Only public GETs and data decoding; remote HTML/JavaScript is never executed.
export async function resolveWorkflowLink(input: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<LinkedWorkflow> {
  if (input.length > maxBytes) throw Error('Workflow link exceeds 32 MiB.')
  const first = locator(input)
  let fragment = first.fragment ?? '#s:' + encodeLinkTarget(first.target!).payload
  let pending = input, used = 0
  const seen = new Set<string>(), sources: string[] = []
  const lifetime = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
  for (let hop = 0; hop < maxHops; hop++) {
    lifetime.throwIfAborted()
    if (pending.length > maxBytes) throw Error('Workflow link exceeds 32 MiB.')
    if (seen.has(pending)) throw Error('Workflow link contains a circular pointer.')
    seen.add(pending)
    let bytes: Uint8Array, name = 'workflow.json', mime = 'application/json', text: string | undefined
    // Make's existing binary envelope is also understood by ln.kr superlinks.
    if (isMakeLink(pending)) {
      const file = decodeMakeFile(pending, maxBytes - used)
      bytes = file.bytes; name = file.name; mime = file.mime; text = file.text ?? undefined
    } else {
      const item = locator(pending)
      if (item.text !== undefined) {
        text = item.text; bytes = new TextEncoder().encode(text)
      } else {
        if (isMakeLink(item.target!)) { pending = item.target!; continue }
        const target = sourceResourceURL(item.target!)
        const resource = new URL(target); resource.hash = ''
        const key = 'fetch:' + resource.href
        if (seen.has(key)) throw Error('Workflow link contains a circular pointer.')
        seen.add(key); sources.push(resource.href)
        let response: Response
        try { response = await fetchImpl(resource.href, { method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: lifetime }) }
        catch (error) { lifetime.throwIfAborted(); throw Error('Cannot read workflow link. The source must permit browser CORS access (and HTTPS on an HTTPS page).', { cause: error }) }
        if (!response.ok) throw Error(`Workflow link: HTTP ${response.status}`)
        bytes = await read(response, maxBytes - used)
        name = fileName(response.url || target)
        mime = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream'
        const binary = /^(?:image|audio|video)\//.test(mime) || /\.(?:png|webp|avif|flac|mp4|webm)$/i.test(name)
        if (!binary) text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        if (item.superlink && (!text || !extractSingleLinkDocument(text, base))) throw Error('A superlink must point to an exact one-line link document.')
      }
    }
    used += bytes.length
    if (used > maxBytes) throw Error('Workflow link exceeds 32 MiB.')
    if (text !== undefined) {
      const pointer = extractSingleLinkDocument(text, base)
      if (pointer) {
        if (hop === 0 && !first.fragment) fragment = '#ss:' + encodeLinkTarget(first.target!).payload
        pending = pointer; continue
      }
      const workflow = parseWorkflow(text)
      return { bytes, name: /\.json$/i.test(name) ? name : 'workflow.json', mime: 'application/json', workflow, fragment, sources }
    }
    if (!/\.(?:png|webp|avif|flac|mp4|webm)$/i.test(name) && !/^(?:image|audio|video)\//.test(mime)) throw Error('This link is not a workflow JSON or supported workflow-metadata file.')
    return { bytes, name, mime, fragment, sources }
  }
  throw Error(`Workflow link exceeds ${maxHops} pointer hops.`)
}

export function workflowViewerURL(fragment: string, page: string) {
  const url = new URL(page); url.search = ''; url.hash = fragment
  return url.href
}
