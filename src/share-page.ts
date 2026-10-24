import { readWorkflowLink } from './link-client'
import { workflowViewerURL } from './links'
import { workflowFragment, hoistWorkflowURL } from './share'
import { parseWorkflow, filename } from './workflow'

const base = new URL('./', location.href)
const source = document.querySelector<HTMLTextAreaElement>('#source')!
const mode = document.querySelector<HTMLSelectElement>('#mode')!
const status = document.querySelector<HTMLElement>('#status')!
const output = document.querySelector<HTMLTextAreaElement>('#viewer-url')!
const result = document.querySelector<HTMLElement>('#result')!
const submit = document.querySelector<HTMLButtonElement>('button[type=submit]')!
let data: any, name = 'workflow.json', controller: AbortController | undefined

async function generate() {
  controller?.abort(); controller = new AbortController()
  const current = controller
  submit.disabled = true; result.hidden = true; status.textContent = 'Reading workflow…'; delete status.dataset.error
  try {
    const input = source.value.trim()
    if (!input) throw Error('Enter a workflow link or JSON.')
    const literal = input.startsWith('{') || input.startsWith('```')
    let sourceRoute: string | undefined
    if (literal) data = parseWorkflow(input)
    else {
      const linked = await readWorkflowLink(input, base.href, current.signal)
      if (!linked.workflow) throw Error('Use a workflow JSON here. Metadata images can be opened in the editor.')
      data = linked.workflow; name = linked.name; sourceRoute = linked.fragment
    }
    current.signal.throwIfAborted()
    const embedded = workflowFragment(data, name)
    const fragment = sourceRoute && mode.value === 'source' ? sourceRoute : embedded
    output.value = workflowViewerURL(fragment, base.href)
    document.querySelector<HTMLAnchorElement>('#open')!.href = output.value
    document.querySelector<HTMLAnchorElement>('#make')!.href = hoistWorkflowURL(embedded)
    result.hidden = false
    const bytes = new TextEncoder().encode(JSON.stringify(data)).length
    status.textContent = `${bytes.toLocaleString()} bytes JSON · ${output.value.length.toLocaleString()} characters in link`
  } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); status.dataset.error = '' }
  finally { if (current === controller) submit.disabled = false }
}
document.querySelector<HTMLFormElement>('#share-form')!.onsubmit = event => { event.preventDefault(); void generate() }
document.querySelector<HTMLInputElement>('#upload')!.onchange = async event => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  name = file.name; source.value = await file.text(); mode.value = 'embed'; void generate()
}
document.querySelector<HTMLButtonElement>('#copy')!.onclick = async () => {
  try { await navigator.clipboard.writeText(output.value); status.textContent = 'Link copied.' }
  catch { output.focus(); output.select(); status.textContent = 'Copy the selected URL.' }
}
document.querySelector<HTMLButtonElement>('#download')!.onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = filename(name); a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
