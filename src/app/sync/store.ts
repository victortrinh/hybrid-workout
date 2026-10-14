import type { SessionLog } from '../../domain/log'

/**
 * Where Session logs live on the device. Every log is written here before the
 * server hears of it; the outbox holds the edits the server hasn't taken yet.
 */
export interface LocalStore {
  load(): Promise<{ logs: SessionLog[]; outbox: SessionLog[] }>
  /** Stores a log written on this device and queues it for the server, together. */
  write(log: SessionLog): Promise<void>
  /**
   * Takes the server's answer: stores `logs` (already merged, later edit wins),
   * and clears outbox entries the server took, unless a newer edit replaced them meanwhile.
   */
  settle(logs: SessionLog[], taken: SessionLog[]): Promise<void>
  /** Forgets logs the server refused, from both the logs and the outbox. */
  drop(refused: SessionLog[]): Promise<void>
}

const DB_NAME = 'compromised'
const LOGS = 'sessionLogs'
const OUTBOX = 'outbox'

/** The device's IndexedDB. Rejects where IndexedDB isn't available. */
export async function openIndexedDbStore(): Promise<LocalStore> {
  const db = await promised<IDBDatabase>(() => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LOGS, { keyPath: 'id' })
      request.result.createObjectStore(OUTBOX, { keyPath: 'id' })
    }
    return request
  })

  /** Runs `work` in one transaction over both stores and resolves once it commits. */
  function transact<T>(mode: IDBTransactionMode, work: (logs: IDBObjectStore, outbox: IDBObjectStore) => T) {
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction([LOGS, OUTBOX], mode)
      const result = work(tx.objectStore(LOGS), tx.objectStore(OUTBOX))
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    })
  }

  return {
    async load() {
      const [logs, outbox] = await transact('readonly', (logs, outbox) => [logs.getAll(), outbox.getAll()])
      return { logs: logs.result as SessionLog[], outbox: outbox.result as SessionLog[] }
    },
    write: (log) =>
      transact('readwrite', (logs, outbox) => {
        logs.put(log)
        outbox.put(log)
      }),
    settle: (merged, taken) =>
      transact('readwrite', (logs, outbox) => {
        for (const log of merged) logs.put(log)
        for (const log of taken) {
          const queued = outbox.get(log.id)
          queued.onsuccess = () => {
            if ((queued.result as SessionLog | undefined)?.updatedAt === log.updatedAt) outbox.delete(log.id)
          }
        }
      }),
    drop: (refused) =>
      transact('readwrite', (logs, outbox) => {
        for (const log of refused) {
          logs.delete(log.id)
          outbox.delete(log.id)
        }
      }),
  }
}

/** A store that forgets on reload: for tests, and for browsers that block IndexedDB. */
export function memoryStore(): LocalStore {
  const logs = new Map<string, SessionLog>()
  const outbox = new Map<string, SessionLog>()
  return {
    async load() {
      return { logs: [...logs.values()], outbox: [...outbox.values()] }
    },
    async write(log) {
      logs.set(log.id, log)
      outbox.set(log.id, log)
    },
    async settle(merged, taken) {
      for (const log of merged) logs.set(log.id, log)
      for (const log of taken) if (outbox.get(log.id)?.updatedAt === log.updatedAt) outbox.delete(log.id)
    },
    async drop(refused) {
      for (const log of refused) {
        logs.delete(log.id)
        outbox.delete(log.id)
      }
    },
  }
}

function promised<T>(open: () => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = open()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
