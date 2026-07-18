import { NextRequest } from 'next/server'
import { detectSubtitleTracks, extractSubtitles } from '@/lib/mkv-subtitles'

export const dynamic = 'force-dynamic'

// In-memory cache for extracted subtitles (keyed by URL)
const subtitleCache = new Map<string, { cues: Array<{ startTime: number; endTime: number; text: string }>; timestamp: number }>()
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

// Clean up expired cache entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of subtitleCache) {
    if (now - val.timestamp > CACHE_TTL) subtitleCache.delete(key)
  }
}, 60000)

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  const action = request.nextUrl.searchParams.get('action') || 'detect'
  const trackNum = request.nextUrl.searchParams.get('track')

  if (!url) {
    return Response.json({ error: 'url is required' }, { status: 400 })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)

  try {
    if (action === 'detect') {
      const tracks = await detectSubtitleTracks(url, controller.signal)
      clearTimeout(timeout)
      return Response.json({ tracks })
    }

    if (action === 'extract' && trackNum) {
      const trackNumber = parseInt(trackNum)
      if (isNaN(trackNumber)) {
        clearTimeout(timeout)
        return Response.json({ error: 'Invalid track number' }, { status: 400 })
      }

      // Check cache
      const cacheKey = `${url}#${trackNumber}`
      const cached = subtitleCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        clearTimeout(timeout)
        return Response.json({ cues: cached.cues, count: cached.cues.length, cached: true })
      }

      const cues = await extractSubtitles(url, trackNumber, controller.signal)

      // Cache result
      if (cues.length > 0) {
        subtitleCache.set(cacheKey, { cues, timestamp: Date.now() })
      }

      clearTimeout(timeout)
      return Response.json({ cues, count: cues.length })
    }

    // Cleanup action (called when room is deleted)
    if (action === 'cleanup') {
      const prefix = url
      let count = 0
      for (const key of subtitleCache.keys()) {
        if (key.startsWith(prefix)) { subtitleCache.delete(key); count++ }
      }
      clearTimeout(timeout)
      return Response.json({ cleaned: count })
    }

    clearTimeout(timeout)
    return Response.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: unknown) {
    clearTimeout(timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      return Response.json({ error: 'Request timed out' }, { status: 504 })
    }
    console.error('Subtitle API error:', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
