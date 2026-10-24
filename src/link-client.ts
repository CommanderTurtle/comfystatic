import type { LinkedWorkflow } from './links'

// A separate static document owns explicit import GETs. The native editor keeps
// its original same-origin CSP and network/telemetry guards unchanged.
export function readWorkflowLink(input: string, base: string, signal?: AbortSignal): Promise<LinkedWorkflow> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe'), id = crypto.randomUUID()
    frame.hidden = true; frame.title = 'Workflow link importer'
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    frame.referrerPolicy = 'no-referrer'
    frame.src = new URL('comfystatic/link-import.html', base).href
    const finish = (error?: Error, value?: LinkedWorkflow) => {
      clearTimeout(timer); window.removeEventListener('message', message); signal?.removeEventListener('abort', abort); frame.remove()
      if (error) reject(error); else resolve(value!)
    }
    const message = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'comfystatic:link-result' || event.data.id !== id) return
      if (event.data.error) finish(Error(event.data.error))
      else if (event.data.result?.bytes instanceof Uint8Array && typeof event.data.result.fragment === 'string') finish(undefined, event.data.result)
      else finish(Error('Invalid workflow-link response.'))
    }
    const abort = () => finish(new DOMException('Workflow import cancelled.', 'AbortError'))
    const timer = setTimeout(() => finish(Error('Workflow link timed out.')), 35_000)
    frame.onload = () => frame.contentWindow?.postMessage({ type: 'comfystatic:resolve-link', id, input }, '*')
    frame.onerror = () => finish(Error('Could not load the static workflow importer.'))
    window.addEventListener('message', message); signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    document.body.append(frame)
  })
}
