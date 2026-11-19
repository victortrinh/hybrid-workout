import initSqlJs from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi } from './api'
import { d1 } from './d1'
import { openDatabase } from './database'
import { SLOW_MS, throughNetwork } from './network'

const SQL = await initSqlJs()

let api: ReturnType<typeof mockApi>
beforeEach(() => {
  api = mockApi(d1(openDatabase(SQL)))
})

describe('the network control', () => {
  const request = () => new Request('http://localhost/api/state')

  it('passes requests through when Online', async () => {
    expect((await throughNetwork('online', request(), api)).status).toBe(200)
  })

  it('fails every request with a network error when Offline', async () => {
    const response = await throughNetwork('offline', request(), api)
    expect(response.type).toBe('error')
  })

  it('answers 500 on a Server error', async () => {
    expect((await throughNetwork('server-error', request(), api)).status).toBe(500)
  })

  it('waits 3 seconds before each answer when Slow', async () => {
    const waited: number[] = []
    const response = await throughNetwork('slow', request(), api, async (ms) => void waited.push(ms))
    expect(waited).toEqual([SLOW_MS])
    expect(SLOW_MS).toBe(3_000)
    expect(response.status).toBe(200)
  })
})
