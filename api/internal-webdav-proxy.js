import http from 'http'
import https from 'https'
import { URL } from 'url'

export const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'MKCOL', 'PROPFIND', 'OPTIONS'])

const DIRECTORY_METHODS = new Set(['HEAD', 'MKCOL', 'PROPFIND'])
const FILE_METHODS = new Set(['GET', 'HEAD', 'PUT'])
const BACKUP_FILE_METHODS = new Set([...FILE_METHODS, 'DELETE'])

const FIXED_RESOURCES = new Map([
  ['/glance-directory', { upstreamPath: '/GLANCE/', directory: true, methods: DIRECTORY_METHODS }],
  ['/sync-directory', { upstreamPath: '/GLANCE/lastglance/', directory: true, methods: DIRECTORY_METHODS }],
  ['/sync', { upstreamPath: '/GLANCE/lastglance/lastglance-sync.json', directory: false, methods: FILE_METHODS }],
  ['/backups-directory', { upstreamPath: '/GLANCE/lastglance/backups/', directory: true, methods: DIRECTORY_METHODS }],
  ['/users-directory', { upstreamPath: '/GLANCE/users/', directory: true, methods: DIRECTORY_METHODS }],
  ['/users', { upstreamPath: '/GLANCE/users/glance-users.json', directory: false, methods: FILE_METHODS }],
])
const BACKUP_ROUTE_RE = /^\/backups\/(lastglance-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json)$/

function resolveResource(endpointPath) {
  const fixed = FIXED_RESOURCES.get(endpointPath)
  if (fixed) return fixed

  const backup = BACKUP_ROUTE_RE.exec(endpointPath)
  if (!backup) throw new Error('Unknown managed WebDAV resource')
  return {
    upstreamPath: `/GLANCE/lastglance/backups/${encodeURIComponent(backup[1])}`,
    directory: false,
    methods: BACKUP_FILE_METHODS,
  }
}

export function resolveManagedTarget(endpointPath, baseUrlValue) {
  let base
  try {
    base = new URL(baseUrlValue)
  } catch {
    throw new Error('Invalid internal WebDAV URL')
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Invalid internal WebDAV URL')
  }

  const resource = resolveResource(endpointPath)
  const basePath = base.pathname.replace(/\/$/, '')
  base.pathname = `${basePath}${resource.upstreamPath}`
  base.search = ''
  base.hash = ''
  return { target: base, ...resource }
}

function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : null))
    req.on('error', reject)
  })
}

function requestUpstream(method, target, headers, body) {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http
    const requestHeaders = { ...headers, host: target.host }
    if (body) requestHeaders['content-length'] = String(body.length)
    else delete requestHeaders['content-length']

    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: target.pathname,
      method,
      headers: requestHeaders,
      agent: new transport.Agent({ keepAlive: false }),
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode ?? 502,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
      response.on('error', reject)
    })
    upstream.on('error', reject)
    upstream.setTimeout(30_000, () => upstream.destroy(new Error('Upstream request timed out')))
    if (body) upstream.write(body)
    upstream.end()
  })
}

async function createCollectionTree(target, upstreamPath, headers) {
  const basePath = target.pathname.slice(0, target.pathname.length - upstreamPath.length).replace(/\/$/, '')
  const segments = upstreamPath.split('/').filter(Boolean)
  let current = basePath
  let response = null
  for (const segment of segments) {
    current += `/${encodeURIComponent(decodeURIComponent(segment))}`
    const collectionUrl = new URL(target)
    collectionUrl.pathname = `${current}/`
    response = await requestUpstream('MKCOL', collectionUrl, headers, null)
    if (!(response.status >= 200 && response.status < 300) && response.status !== 405) return response
  }
  return response
}

export default async function internalWebdavHandler(req, res) {
  res.setHeader('X-Webdav-Proxy', 'lastglance')
  res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Webdav-Proxy')
  res.setHeader('Cache-Control', 'no-store')

  if (!ALLOWED_METHODS.has(req.method)) {
    res.setHeader('Allow', [...ALLOWED_METHODS].join(', '))
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (req.method === 'OPTIONS') return res.status(204).end()

  const baseUrl = process.env.INTERNAL_WEBDAV_ROOT_URL || process.env.INTERNAL_WEBDAV_BASE_URL
  const username = process.env.INTERNAL_WEBDAV_USERNAME
  const password = process.env.INTERNAL_WEBDAV_PASSWORD
  if (!baseUrl || username === undefined || password === undefined) {
    return res.status(503).json({ error: 'Managed WebDAV is not configured' })
  }

  let resolved
  try {
    const requestUrl = new URL(req.url, 'http://localhost')
    const endpointPath = requestUrl.pathname.slice('/api/internal-webdav'.length)
    resolved = resolveManagedTarget(endpointPath, baseUrl)
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request' })
  }

  if (!resolved.methods.has(req.method)) {
    res.setHeader('Allow', [...resolved.methods, 'OPTIONS'].join(', '))
    return res.status(405).json({ error: 'Method not allowed for this resource' })
  }

  const headers = {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`,
  }
  for (const name of ['content-type', 'depth', 'if-match', 'if-none-match']) {
    if (req.headers[name] !== undefined) headers[name] = req.headers[name]
  }

  try {
    const body = await readBody(req)
    const response = req.method === 'MKCOL' && resolved.directory
      ? await createCollectionTree(resolved.target, resolved.upstreamPath, headers)
      : await requestUpstream(req.method, resolved.target, headers, body)

    const contentType = response?.headers['content-type']
    if (contentType) res.setHeader('Content-Type', contentType)
    if (response?.headers.etag) res.setHeader('ETag', response.headers.etag)
    if (response?.headers['last-modified']) res.setHeader('Last-Modified', response.headers['last-modified'])
    res.statusCode = response?.status ?? 502
    if (req.method === 'HEAD') return res.end()
    return res.end(response?.body)
  } catch (error) {
    console.error('[internal-webdav] proxy error:', error instanceof Error ? error.message : error)
    return res.status(502).json({ error: 'Failed to proxy WebDAV request' })
  }
}
