// A small ZIP writer for "Download all (ZIP)": files are *stored* (no compression: JPG, PNG and
// WebP are compressed already), with CRC-32, UTF-8 file names (general purpose flag bit 11),
// a local header per file, the central directory and the end record. No Zip64: the total is kept
// well below 4 GB by MAX_ZIP_BYTES. Format: PKWARE APPNOTE.TXT (sections 4.3–4.4).

/** `data` on its own ArrayBuffer, so the parts can go into a Blob. */
export type ZipEntry = { name: string; data: Uint8Array<ArrayBuffer> }

/** Far below the 4 GB limit of a ZIP without Zip64 (and below what a browser tab should hold). */
export const MAX_ZIP_BYTES = 1024 * 1024 * 1024

export class ZipTooLargeError extends Error {}

const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** CRC-32 (IEEE 802.3, as in ZIP and PNG). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** MS-DOS time and date of `date` (local time, 2-second steps; years 1980–2107). */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()))
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** Bytes a ZIP of these entries takes. */
export function zipSize(entries: readonly { name: string; size: number }[]): number {
  const encoder = new TextEncoder()
  return entries.reduce((total, e) => total + 30 + 46 + 2 * encoder.encode(e.name).length + e.size, 22)
}

/** The ZIP file as parts for a Blob (`new Blob(zipStore(...), { type: 'application/zip' })`). */
export function zipStore(entries: readonly ZipEntry[], modified = new Date()): Uint8Array<ArrayBuffer>[] {
  if (zipSize(entries.map((e) => ({ name: e.name, size: e.data.length }))) > MAX_ZIP_BYTES) throw new ZipTooLargeError(`ZIP larger than ${MAX_ZIP_BYTES} bytes`)
  const encoder = new TextEncoder()
  const { time, date } = dosDateTime(modified)
  const UTF8 = 1 << 11
  const VERSION = 20 // 2.0: the version a reader needs (stored files, folders)
  const parts: Uint8Array<ArrayBuffer>[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true) // local file header signature
    local.setUint16(4, VERSION, true)
    local.setUint16(6, UTF8, true)
    local.setUint16(8, 0, true) // method: stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, size, true) // compressed size
    local.setUint32(22, size, true) // uncompressed size
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true) // extra field length
    parts.push(new Uint8Array(local.buffer), name, entry.data)

    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true) // central directory header signature
    dir.setUint16(4, VERSION, true) // version made by (MS-DOS attributes)
    dir.setUint16(6, VERSION, true) // version needed to extract
    dir.setUint16(8, UTF8, true)
    dir.setUint16(10, 0, true)
    dir.setUint16(12, time, true)
    dir.setUint16(14, date, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, size, true)
    dir.setUint32(24, size, true)
    dir.setUint16(28, name.length, true)
    // extra length, comment length, disk number start, internal and external attributes: 0
    dir.setUint32(42, offset, true) // offset of the local header
    central.push(new Uint8Array(dir.buffer), name)
    offset += 30 + name.length + size
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true) // end of central directory signature
  end.setUint16(8, entries.length, true) // entries on this disk
  end.setUint16(10, entries.length, true) // entries in total
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true) // offset of the central directory
  return [...parts, ...central, new Uint8Array(end.buffer)]
}
