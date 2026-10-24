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
      clearTimeout(timer); clearTimeout(bootTimer); window.removeEventListener('message', message); signal?.removeEventListener('abort', abort); frame.remove()
      if (error) reject(error); else resolve(value!)
    }
    let sent = false
    const send = () => {
      if (sent) return
      sent = true
      clearTimeout(bootTimer)
      frame.contentWindow?.postMessage({ type: 'comfystatic:resolve-link', id, input }, location.origin)
    }
    const message = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== location.origin) return
      if (event.data?.type === 'comfystatic:link-ready') {
        send()
        return
      }
      if (event.data?.type !== 'comfystatic:link-result' || event.data.id !== id) return
      if (event.data.error) finish(Error(event.data.error))
      else if (event.data.result?.bytes instanceof Uint8Array && typeof event.data.result.fragment === 'string') finish(undefined, event.data.result)
      else finish(Error('Invalid workflow-link response.'))
    }
    const abort = () => finish(new DOMException('Workflow import cancelled.', 'AbortError'))
    const timer = setTimeout(() => finish(Error('Workflow link timed out.')), 35_000)
    const bootTimer = setTimeout(() => finish(Error('Workflow importer did not start. Deploy the complete dist, including comfystatic/link-import.html and its scripts.')), 10_000)
    frame.onerror = () => finish(Error('Could not load the static workflow importer.'))
    window.addEventListener('message', message); signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    document.body.append(frame)
  })
}
