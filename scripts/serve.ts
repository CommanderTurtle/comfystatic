import { resolve, sep } from 'node:path'
const root = resolve(import.meta.dir, '../dist')
const port = Number(process.env.PORT ?? 8190)
const base = '/' + (process.env.BASE_PATH ?? '').replace(/^\/+|\/+$/g, '')
const mount = base === '/' ? '/' : base + '/'
if (!await Bun.file(resolve(root, 'index.html')).exists()) throw new Error('Run bun run build first.')
Bun.serve({ hostname: process.env.HOST ?? '127.0.0.1', port, async fetch(req) {
  let path: string
  try { path = decodeURIComponent(new URL(req.url).pathname) } catch { return new Response('Bad path', { status: 400 }) }
  if (path === base && mount !== base) return Response.redirect(new URL(mount, req.url), 301)
  if (!path.startsWith(mount)) return new Response('Not found', { status: 404 })
  path = '/' + path.slice(mount.length)
  const full = resolve(root, '.' + path, path.endsWith('/') ? 'index.html' : '')
  if (!full.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })
  const file = Bun.file(full)
  return await file.exists() ? new Response(file, { headers: { 'Cache-Control': 'no-cache' } }) : new Response('Not found', { status: 404 })
} })
console.log(`comfystatic: http://${process.env.HOST ?? '127.0.0.1'}:${port}${mount} (static files only)`)
