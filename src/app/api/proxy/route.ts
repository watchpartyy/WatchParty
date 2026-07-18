import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

function getBrowserMimeType(originalType: string, url: string): string {
  if (originalType && (originalType.startsWith('video/mp4') || originalType.startsWith('video/webm') || originalType.startsWith('video/ogg'))) {
    return originalType
  }
  const ext = url.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'mkv': case 'mk3d': return 'video/mp4'
    case 'mp4': case 'm4v': return 'video/mp4'
    case 'webm': return 'video/webm'
    case 'ogv': case 'ogg': return 'video/ogg'
    case 'avi': case 'mov': case 'flv': return 'video/mp4'
    case 'ts': return 'video/mp2t'
    default: return 'video/mp4'
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')

  if (!url) {
    return new Response(JSON.stringify({ error: 'URL is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Validate URL
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const range = request.headers.get('range')

  // AbortController with 60s timeout for initial connection
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)

  try {
    const fetchHeaders: HeadersInit = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
    }

    if (range) {
      fetchHeaders['Range'] = range
    }

    const response = await fetch(url, {
      headers: fetchHeaders,
      redirect: 'follow',
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Upstream returned ${response.status}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const headers = new Headers()
    const originalContentType = response.headers.get('content-type') || ''
    headers.set('Content-Type', getBrowserMimeType(originalContentType, url))

    const contentLength = response.headers.get('content-length')
    if (contentLength) headers.set('Content-Length', contentLength)

    const contentRange = response.headers.get('content-range')
    if (contentRange) headers.set('Content-Range', contentRange)

    headers.set('Accept-Ranges', 'bytes')
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Range, Content-Type')
    headers.set('Cache-Control', 'public, max-age=3600')

    return new Response(response.body, { status: response.status, headers })
  } catch (error: unknown) {
    clearTimeout(timeout)

    if (error instanceof Error && error.name === 'AbortError') {
      return new Response(JSON.stringify({ error: 'Connection timed out. The video server is too slow or unreachable.' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    console.error('Proxy error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch video from upstream server' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
    },
  })
}
