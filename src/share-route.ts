import { isWorkflowFragment } from './links'

// Comfy's router owns #<graph UUID>. Keep its history state intact, but expose
// the portable workflow instead of that browser-local ID in the address bar.
export function installShareRoute(win: Window, onImport: (fragment: string) => void) {
  const history = win.history
  const replace = history.replaceState.bind(history), push = history.pushState.bind(history)
  const nativeGraph = /^#[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
  const initial = isWorkflowFragment(win.location.hash) ? win.location.hash : ''
  let share = ''
  if (initial) replace(history.state, '', win.location.pathname + win.location.search)
  const exposed = (url?: string | URL | null) => {
    if (url == null || !share) return url
    const next = new URL(String(url), win.location.href)
    if (next.origin === win.location.origin && next.pathname === win.location.pathname && (!next.hash || nativeGraph.test(next.hash))) {
      next.hash = share
      return next.href
    }
    return url
  }
  history.replaceState = (data, unused, url) => replace(data, unused, exposed(url))
  history.pushState = (data, unused, url) => push(data, unused, exposed(url))
  const capture = (event: Event) => {
    const hash = win.location.hash
    if (!isWorkflowFragment(hash)) return
    event.stopImmediatePropagation()
    if (hash === share) return
    share = hash
    onImport(hash)
  }
  win.addEventListener('hashchange', capture, true)
  win.addEventListener('popstate', capture, true)
  return {
    initial,
    set(fragment: string) {
      share = fragment
      const url = new URL(win.location.href); url.hash = fragment
      replace(history.state, '', url.href)
    }
  }
}
