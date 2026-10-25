// Comfy's /extensions API returns routes appended to its deployment base, not
// URLs relative to the JSON file. Static packagers may rebase that JSON's URLs.
export function extensionRoutes(paths: string[], base: string) {
  const root = new URL(base), manifest = new URL('comfystatic/config.json', root)
  return paths.map(path => {
    const url = new URL(path, manifest)
    if (url.origin !== root.origin) throw Error('External ComfyUI extensions are not supported.')
    const route = url.pathname.startsWith(root.pathname)
      ? '/' + url.pathname.slice(root.pathname.length) : url.pathname
    if (!route.startsWith('/extensions/')) throw Error(`Invalid ComfyUI extension route: ${path}`)
    return route + url.search + url.hash
  })
}
