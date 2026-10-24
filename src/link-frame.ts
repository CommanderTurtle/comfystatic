import { resolveWorkflowLink } from './links'

window.addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'comfystatic:resolve-link') return
  const { id, input } = event.data
  if (typeof id !== 'string' || typeof input !== 'string') return
  try {
    const result = await resolveWorkflowLink(input)
    parent.postMessage({ type: 'comfystatic:link-result', id, result }, location.origin, [result.bytes.buffer])
  } catch (error) {
    parent.postMessage({ type: 'comfystatic:link-result', id, error: error instanceof Error ? error.message : String(error) }, location.origin)
  }
})
parent.postMessage({ type: 'comfystatic:link-ready' }, location.origin)
