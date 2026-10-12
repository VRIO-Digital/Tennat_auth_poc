// Minimal static server for the built app (dist/) with SPA fallback.
// Used by `npm start` on hosts that need a long-running process (e.g. Render web service).
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('./dist', import.meta.url)))
const port = Number(process.env.PORT) || 3000

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^([/\\])+/, '')
  const file = resolve(join(root, clean))
  if (file !== root && !file.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) return null
  if (existsSync(file) && statSync(file).isFile()) return file
  return null
}

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end()
    return
  }

  let file
  try {
    file = resolveFile(req.url ?? '/')
  } catch {
    res.writeHead(400).end()
    return
  }

  const isAsset = file !== null && file.includes(`${root}${process.platform === 'win32' ? '\\' : '/'}assets`)
  // Unknown paths are client-side routes: serve the app shell.
  file ??= join(root, 'index.html')

  res.writeHead(200, {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  })
  if (req.method === 'HEAD') res.end()
  else createReadStream(file).pipe(res)
}).listen(port, '0.0.0.0', () => console.log(`Serving dist on http://0.0.0.0:${port}`))
