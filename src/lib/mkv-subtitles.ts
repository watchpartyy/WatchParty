/**
 * Robust MKV/EBML parser for extracting embedded subtitle tracks.
 * Fetches minimal data via HTTP Range requests.
 */

export interface MKVTrack {
  number: number
  type: number
  codecId: string
  language?: string
  name?: string
}

export interface MKVSubtitleCue {
  trackNumber: number
  startTime: number
  endTime: number
  text: string
}

// ── VINT (variable-length integer) reader ──
function vint(data: Uint8Array, off: number): [number, number] {
  if (off >= data.length) return [-1, off]
  const b0 = data[off]
  if (b0 === 0) return [0, off + 1] // invalid but handle gracefully

  // Determine length from leading zeros
  let len = 1
  let mask = 0x80
  while (len < 8 && !(b0 & mask)) { len++; mask >>= 1 }

  let val = b0 & (mask - 1)
  for (let i = 1; i < len; i++) {
    if (off + i >= data.length) return [-1, off + i]
    val = (val << 8) | data[off + i]
  }
  return [val, off + len]
}

// ── Element reader: returns [id, dataStart, dataSize] or null ──
function readElem(data: Uint8Array, off: number): [number, number, number] | null {
  if (off >= data.length) return null
  const [id, idEnd] = vint(data, off)
  if (id <= 0 || idEnd >= data.length) return null
  const [size, sizeEnd] = vint(data, idEnd)
  if (size < 0) return null
  return [id, sizeEnd, size]
}

// ── Scan for element by ID within a byte range ──
function scanFor(data: Uint8Array, start: number, end: number, targetId: number): [number, number] | null {
  let off = start
  while (off < end - 4) {
    const r = readElem(data, off)
    if (!r) break
    const [id, dataStart, dataSize] = r
    const dataEnd = dataStart + dataSize
    if (dataEnd > end) break
    if (id === targetId) return [dataStart, dataSize]
    off = dataEnd
  }
  return null
}

// ── Scan for ALL elements by ID ──
function scanAll(data: Uint8Array, start: number, end: number, targetId: number): Array<[number, number]> {
  const results: Array<[number, number]> = []
  let off = start
  while (off < end - 4) {
    const r = readElem(data, off)
    if (!r) break
    const [id, dataStart, dataSize] = r
    const dataEnd = dataStart + dataSize
    if (dataEnd > end) break
    if (id === targetId) results.push([dataStart, dataSize])
    off = dataEnd
  }
  return results
}

// ── Read unsigned BE integer ──
function readUint(data: Uint8Array, off: number, len: number): number {
  let v = 0
  for (let i = 0; i < len && off + i < data.length; i++) v = (v << 8) | data[off + i]
  return v
}

// ── Read signed 16-bit BE ──
function readInt16(data: Uint8Array, off: number): number {
  const v = readUint(data, off, 2)
  return v >= 0x8000 ? v - 0x10000 : v
}

// ── Read UTF-8 string ──
function readStr(data: Uint8Array, off: number, len: number): string {
  return new TextDecoder().decode(data.slice(off, off + len))
}

// ── EBML Element IDs ──
const ID_SEGMENT = 0x18538067
const ID_TRACKS = 0x1654ae6b
const ID_TRACK_ENTRY = 0xae
const ID_TRACK_NUM = 0xd7
const ID_TRACK_TYPE = 0x83
const ID_CODEC_ID = 0x86
const ID_LANGUAGE = 0x22b59c
const ID_TRACK_NAME = 0x536e
const ID_SIMPLE_BLOCK = 0xa3
const ID_BLOCK_GROUP = 0xa0
const ID_BLOCK = 0xa1
const ID_SEGMENT_INFO = 0x1549a966
const ID_TIMESTAMP_SCALE = 0xe7
const ID_CUES = 0x1c53bb6c
const ID_CUE_TIME = 0xb3
const ID_CUE_TRACK_POSITIONS = 0xb7
const ID_CUE_CLUSTER_POSITION = 0xf1
const ID_CUE_TRACK = 0xf7

// ── Parse track entries from a Tracks element ──
function parseTracks(data: Uint8Array, tracksStart: number, tracksSize: number): MKVTrack[] {
  const tracks: MKVTrack[] = []
  const end = tracksStart + tracksSize
  const entries = scanAll(data, tracksStart, end, ID_TRACK_ENTRY)

  for (const [entryStart, entrySize] of entries) {
    const entryEnd = entryStart + entrySize
    let num = 0, type = 0, codec = '', lang = '', name = ''
    let off = entryStart

    while (off < entryEnd) {
      const r = readElem(data, off)
      if (!r) break
      const [id, dStart, dSize] = r
      const dEnd = dStart + dSize

      if (id === ID_TRACK_NUM && dSize >= 1) num = readUint(data, dStart, dSize)
      else if (id === ID_TRACK_TYPE && dSize >= 1) type = readUint(data, dStart, dSize)
      else if (id === ID_CODEC_ID && dSize >= 1) codec = readStr(data, dStart, dSize)
      else if (id === ID_LANGUAGE && dSize >= 1) lang = readStr(data, dStart, dSize)
      else if (id === ID_TRACK_NAME && dSize >= 1) name = readStr(data, dStart, dSize)

      off = dEnd
    }

    if (num > 0 && type > 0) {
      tracks.push({ number: num, type, codecId: codec, language: lang || undefined, name: name || undefined })
    }
  }
  return tracks
}

/**
 * Detect subtitle tracks by fetching only the first 128KB of the MKV file.
 */
export async function detectSubtitleTracks(url: string, signal?: AbortSignal): Promise<MKVTrack[]> {
  const resp = await fetch(url, {
    headers: { Range: 'bytes=0-131071' },
    signal,
    redirect: 'follow',
  })
  if (!resp.ok && resp.status !== 206) return []

  const buf = await resp.arrayBuffer()
  const data = new Uint8Array(buf)

  // Find Segment
  const seg = scanFor(data, 0, data.length, ID_SEGMENT)
  if (!seg) return []
  const [segStart, segSize] = seg
  const segEnd = segStart + Math.min(segSize, data.length - segStart)

  // Find Tracks inside Segment
  const tracks = scanFor(data, segStart, segEnd, ID_TRACKS)
  if (!tracks) return []
  const [tracksStart, tracksSize] = tracks

  return parseTracks(data, tracksStart, tracksSize).filter(t => t.type === 0x11)
}

/**
 * Extract subtitle cues from an MKV file.
 * Strategy: fetch header for track info + cues index, then fetch subtitle clusters.
 */
export async function extractSubtitles(
  url: string,
  trackNumber: number,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void,
): Promise<MKVSubtitleCue[]> {
  const cues: MKVSubtitleCue[] = []

  // ── Step 1: Get file size and parse header ──
  const headResp = await fetch(url, {
    headers: { Range: 'bytes=0-131071' },
    signal,
    redirect: 'follow',
  })
  if (!headResp.ok && headResp.status !== 206) return []

  const totalSize = parseInt(headResp.headers.get('content-range')?.split('/')[1] || '0') || 0
  const headBuf = await headResp.arrayBuffer()
  const head = new Uint8Array(headBuf)

  // Find Segment
  const seg = scanFor(head, 0, head.length, ID_SEGMENT)
  if (!seg) return []
  const [segStart] = seg

  // Find Tracks
  const tracks = scanFor(head, segStart, head.length, ID_TRACKS)
  if (!tracks) return []

  // Get TimestampScale
  let timestampScale = 1000000
  const info = scanFor(head, segStart, head.length, ID_SEGMENT_INFO)
  if (info) {
    const tsEl = scanFor(head, info[0], info[0] + info[1], ID_TIMESTAMP_SCALE)
    if (tsEl) timestampScale = readUint(head, tsEl[0], tsEl[1] || 4)
  }

  // ── Step 2: Try to find Cues element (index of all clusters) ──
  // Cues are usually near the end of the file, before the Segment
  let cuePositions: Array<{ time: number; clusterPos: number }> = []

  if (totalSize > 0) {
    // Fetch last 256KB to find Cues
    const tailStart = Math.max(0, totalSize - 262144)
    const tailResp = await fetch(url, {
      headers: { Range: `bytes=${tailStart}-${totalSize - 1}` },
      signal,
      redirect: 'follow',
    })
    if (tailResp.ok || tailResp.status === 206) {
      const tailBuf = await tailResp.arrayBuffer()
      const tail = new Uint8Array(tailBuf)
      const tailOffset = tailStart

      // Find Cues in tail
      const cuesEl = scanFor(tail, 0, tail.length, ID_CUES)
      if (cuesEl) {
        const [cuesStart, cuesSize] = cuesEl
        const cuesEnd = cuesStart + cuesSize
        const cueTimes = scanAll(tail, cuesStart, cuesEnd, ID_CUE_TIME)
        const cueTPs = scanAll(tail, cuesStart, cuesEnd, ID_CUE_TRACK_POSITIONS)

        for (let i = 0; i < Math.min(cueTimes.length, cueTPs.length); i++) {
          const [ctStart, ctSize] = cueTimes[i]
          const [ctpStart, ctpSize] = cueTPs[i]
          const time = readUint(tail, ctStart, ctSize)
          const cueClusterEl = scanFor(tail, ctpStart, ctpStart + ctpSize, ID_CUE_CLUSTER_POSITION)
          if (cueClusterEl) {
            const clusterPos = readUint(tail, cueClusterEl[0], cueClusterEl[1])
            cuePositions.push({ time, clusterPos })
          }
        }
      }
    }
  }

  // ── Step 3: Extract subtitle blocks ──
  if (cuePositions.length > 0) {
    // Use Cues to fetch specific clusters
    // Group nearby cluster positions to minimize requests
    const clusterPositions = [...new Set(cuePositions.map(c => c.clusterPos))].sort((a, b) => a - b)

    // Fetch clusters in batches
    const BATCH_SIZE = 512 * 1024 // 512KB batches
    for (let i = 0; i < clusterPositions.length && cues.length < 10000; i++) {
      const clusterPos = clusterPositions[i]
      const fetchStart = Math.max(0, clusterPos)
      const fetchEnd = Math.min(fetchStart + BATCH_SIZE, totalSize)

      const resp = await fetch(url, {
        headers: { Range: `bytes=${fetchStart}-${fetchEnd - 1}` },
        signal,
        redirect: 'follow',
      })
      if (!resp.ok && resp.status !== 206) continue

      const buf = await resp.arrayBuffer()
      const chunk = new Uint8Array(buf)
      const offset = fetchStart

      onProgress?.(i + 1, clusterPositions.length)

      // Parse subtitle blocks from this chunk
      parseSubtitleBlocks(chunk, 0, chunk.length, trackNumber, timestampScale, cues)
    }
  } else {
    // No Cues found — scan sequentially (slower)
    if (totalSize === 0) return cues

    const CHUNK = 1024 * 1024 // 1MB
    const maxScan = Math.min(totalSize, 10 * 1024 * 1024) // scan up to 10MB
    const totalChunks = Math.ceil(maxScan / CHUNK)

    for (let i = 0; i < totalChunks && cues.length < 10000; i++) {
      const start = i * CHUNK
      const end = Math.min(start + CHUNK - 1, maxScan - 1)

      const resp = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        signal,
        redirect: 'follow',
      })
      if (!resp.ok && resp.status !== 206) continue

      const buf = await resp.arrayBuffer()
      const chunk = new Uint8Array(buf)

      onProgress?.(i + 1, totalChunks)

      parseSubtitleBlocks(chunk, 0, chunk.length, trackNumber, timestampScale, cues)
    }
  }

  return cues
}

/**
 * Parse SimpleBlock and Block elements to extract subtitle data.
 */
function parseSubtitleBlocks(
  data: Uint8Array,
  start: number,
  end: number,
  trackNumber: number,
  timestampScale: number,
  out: MKVSubtitleCue[],
) {
  // Find SimpleBlocks
  const blocks = scanAll(data, start, end, ID_SIMPLE_BLOCK)
  for (const [bStart, bSize] of blocks) {
    const bEnd = bStart + bSize
    if (bEnd > data.length) continue

    let off = bStart

    // Track number (VINT)
    const [tn, tnEnd] = vint(data, off)
    if (tn !== trackNumber) continue
    off = tnEnd

    // Timestamp (signed 16-bit relative to cluster)
    if (off + 2 > bEnd) continue
    const _relTs = readInt16(data, off)
    off += 2

    // Flags byte
    if (off >= bEnd) continue
    off++ // skip flags

    // Remaining bytes = subtitle text
    const textBytes = data.slice(off, bEnd)
    const text = new TextDecoder('utf-8').decode(textBytes).trim()
    if (!text) continue

    // Parse S_TEXT format: "HH:MM:SS,mmm\nHH:MM:SS,mmm\nText\n"
    const lines = text.split('\n')
    if (lines.length < 2) continue

    const startTime = parseTime(lines[0].trim())
    const endTime = parseTime(lines[1].trim())
    const subtitleText = lines.slice(2).join('\n').trim()

    if (startTime >= 0 && endTime > startTime && subtitleText) {
      out.push({ trackNumber, startTime, endTime, text: subtitleText })
    }
  }

  // Also check BlockGroup > Block
  const blockGroups = scanAll(data, start, end, ID_BLOCK_GROUP)
  for (const [bgStart, bgSize] of blockGroups) {
    const bgEnd = bgStart + bgSize
    const blockEl = scanFor(data, bgStart, bgEnd, ID_BLOCK)
    if (!blockEl) continue
    const [bStart, bSize] = blockEl
    const bEnd = bStart + bSize
    if (bEnd > data.length) continue

    let off = bStart
    const [tn, tnEnd] = vint(data, off)
    if (tn !== trackNumber) continue
    off = tnEnd
    if (off + 2 > bEnd) continue
    off += 2 // timestamp
    if (off >= bEnd) continue
    off++ // flags

    const textBytes = data.slice(off, bEnd)
    const text = new TextDecoder('utf-8').decode(textBytes).trim()
    if (!text) continue

    const lines = text.split('\n')
    if (lines.length < 2) continue
    const startTime = parseTime(lines[0].trim())
    const endTime = parseTime(lines[1].trim())
    const subtitleText = lines.slice(2).join('\n').trim()
    if (startTime >= 0 && endTime > startTime && subtitleText) {
      out.push({ trackNumber, startTime, endTime, text: subtitleText })
    }
  }
}

/**
 * Parse time string to milliseconds.
 * Supports: "HH:MM:SS,mmm", "HH:MM:SS.mmm", "H:MM:SS,mmm"
 */
function parseTime(s: string): number {
  if (!s) return -1
  const m = s.match(/^(\d+):(\d{2}):(\d{2})[.,](\d{3})$/)
  if (m) return (+m[1]) * 3600000 + (+m[2]) * 60000 + (+m[3]) * 1000 + (+m[4])

  // Try plain milliseconds
  const ms = parseInt(s)
  if (!isNaN(ms) && s.length <= 6 && ms >= 0) return ms

  return -1
}
