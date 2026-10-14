import { describe, expect, it } from 'vitest'
import { crc32, toCsv, zip } from './export'

describe('toCsv', () => {
  it('writes a header, then one row per record in column order, CRLF', () => {
    const csv = toCsv({
      columns: ['id', 'minutes', 'notes'],
      rows: [
        { notes: 'easy', minutes: 45, id: 'a' },
        { id: 'b', minutes: null, notes: null },
      ],
    })
    expect(csv).toBe('id,minutes,notes\r\na,45,easy\r\nb,,\r\n')
  })

  it('quotes a field with a comma, a quote or a line break', () => {
    const csv = toCsv({ columns: ['notes'], rows: [{ notes: 'Hard, but "fine"\nreally' }] })
    expect(csv).toBe('notes\r\n"Hard, but ""fine""\nreally"\r\n')
  })

  it('writes the header alone for an empty table', () => {
    expect(toCsv({ columns: ['date', 'score'], rows: [] })).toBe('date,score\r\n')
  })
})

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('stores each file uncompressed, with a central directory that finds them', () => {
    const files = [
      { name: 'a.csv', content: 'id\r\n1\r\n' },
      { name: 'b.csv', content: 'Pâté' },
    ]
    const bytes = zip(files)
    const view = new DataView(bytes.buffer)
    const end = bytes.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    let central = view.getUint32(end + 16, true)
    for (const file of files) {
      expect(view.getUint32(central, true)).toBe(0x02014b50)
      const nameLength = view.getUint16(central + 28, true)
      const local = view.getUint32(central + 42, true)
      const size = view.getUint32(local + 18, true)
      const start = local + 30 + view.getUint16(local + 26, true)
      expect(new TextDecoder().decode(bytes.slice(central + 46, central + 46 + nameLength))).toBe(file.name)
      expect(new TextDecoder().decode(bytes.slice(start, start + size))).toBe(file.content)
      expect(view.getUint32(local + 14, true)).toBe(crc32(bytes.slice(start, start + size)))
      central += 46 + nameLength
    }
  })
})
