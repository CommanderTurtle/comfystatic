import { deflate } from './vendor/lnkr/vendor/pako.esm.min.js'
import { encodeLinkTarget } from './vendor/lnkr/link-runtime.js'
import { parseWorkflow, filename } from './workflow'

// Make's existing file payload uses level-9 DEFLATE, like ln.kr's v4 codec.
// The exact same fragment opens in either app; ln.kr v1–v4 remain importable.
export function workflowFragment(data: unknown, name = 'workflow.json'): string {
  return new URL(makeWorkflowURL(data, name)).hash
}

export function hoistWorkflowURL(fragment: string, base = 'https://app.shel.sh/make/'): string {
  if (!/^#(?:share|p):/.test(fragment)) throw Error('Expected a Make-compatible workflow fragment.')
  const url = new URL(base); url.hash = fragment
  return url.href
}

export function sourceFragment(input: string): string {
  const value = input.trim()
  if (value.startsWith('#')) return value
  if (/^(?:ss|s|sm|sj|sh|hs|lr|l|lf|i|media|pdf|share|p):/.test(value)) return '#' + value
  // Keep supplied compressed documents/pointers rather than wrapping their host.
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Enter a public HTTP(S) URL or workflow fragment.')
  return url.hash || '#s:' + encodeLinkTarget(url.href).payload
}

export function makeWorkflowURL(data: unknown, name = 'workflow.json', base = 'https://app.shel.sh/make/'): string {
  const content = new TextEncoder().encode(JSON.stringify(parseWorkflow(typeof data === 'string' ? data : JSON.stringify(data))))
  if (content.length > 32 * 1024 * 1024 - 4096) throw Error('Workflow exceeds 32 MiB.')
  const metadata = new TextEncoder().encode(JSON.stringify({ name: filename(name), mime: 'application/json' }))
  const record = new Uint8Array(9 + metadata.length + content.length)
  record.set([77, 75, 73, 84, 1]) // Make's MKIT/1 file envelope, not a new codec.
  new DataView(record.buffer).setUint32(5, metadata.length, false)
  record.set(metadata, 9); record.set(content, 9 + metadata.length)
  const bytes = deflate(record, { level: 9 })
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  const url = new URL(base)
  url.hash = 'share:' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  return url.href
}
