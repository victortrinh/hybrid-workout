/**
 * Data export: every table as it is stored, so the athlete owns the data
 * whatever happens to the app. One JSON file with all of it, or one CSV per
 * table in a zip, since a browser won't take ten downloads from one tap.
 */

/** Every table the app writes, parents before children. */
export const EXPORT_TABLES = [
  'session_logs',
  'interval_logs',
  'station_logs',
  'set_logs',
  'suggestion_decisions',
  'pain_reports',
  'recovery_nights',
  'activities',
  'activity_answers',
  'starting_point',
] as const

export type ExportTable = (typeof EXPORT_TABLES)[number]

export interface TableDump {
  columns: string[]
  rows: Record<string, unknown>[]
}

/** Each table's columns and rows, in the order they were written. */
export async function readTables(db: D1Database): Promise<Record<ExportTable, TableDump>> {
  const results = await db.batch<Record<string, unknown>>(
    EXPORT_TABLES.flatMap((table) => [
      db.prepare(`select name from pragma_table_info('${table}') order by cid`),
      db.prepare(`select * from ${table} order by rowid`),
    ]),
  )
  return Object.fromEntries(
    EXPORT_TABLES.map((table, i) => [
      table,
      { columns: results[2 * i].results.map((c) => String(c.name)), rows: results[2 * i + 1].results },
    ]),
  ) as Record<ExportTable, TableDump>
}

/** RFC 4180: a header row, CRLF line ends, a field quoted when it holds a comma, quote or line break. Null is empty. */
export function toCsv({ columns, rows }: TableDump): string {
  const field = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [columns, ...rows.map((row) => columns.map((c) => row[c]))].map((r) => r.map(field).join(',') + '\r\n').join('')
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * A zip of these files, stored without compression: the files are small and
 * every unzip reads it. Names are ASCII; the timestamp is the DOS epoch.
 */
export function zip(files: { name: string; content: string }[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = encoder.encode(file.content)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length + data.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true)
    l.setUint16(4, 20, true) // version needed
    l.setUint16(8, 0, true) // stored
    l.setUint16(12, 0x21, true) // 1980-01-01
    l.setUint32(14, crc, true)
    l.setUint32(18, data.length, true)
    l.setUint32(22, data.length, true)
    l.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    const central = new Uint8Array(46 + name.length)
    const c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true) // version made by
    c.setUint16(6, 20, true) // version needed
    c.setUint16(10, 0, true) // stored
    c.setUint16(14, 0x21, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, files.length, true)
  e.setUint16(10, files.length, true)
  e.setUint32(12, centralSize, true)
  e.setUint32(16, offset, true)
  const out = new Uint8Array(offset + centralSize + end.length)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}
