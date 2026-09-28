export type Stored = { key: string; text: string; modified: number; blob?: Blob }
export class LocalFiles {
  private db: Promise<IDBDatabase>
  constructor(namespace: string) {
    this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open(`comfystatic:${namespace}`, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'key' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  async op<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', mode)
      const req = fn(tx.objectStore('files'))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error ?? req.error)
      tx.onabort = () => reject(tx.error ?? new Error('Local storage transaction aborted'))
    })
  }
  get(key: string) { return this.op<Stored | undefined>('readonly', s => s.get(key)) }
  list() { return this.op<Stored[]>('readonly', s => s.getAll()) }
  put(key: string, text: string) { return this.op('readwrite', s => s.put({ key, text, modified: Date.now() })) }
  putMedia(key: string, blob: Blob) { return this.op('readwrite', s => s.put({ key, blob, text: '', modified: Date.now() })) }
  delete(key: string) { return this.op('readwrite', s => s.delete(key)) }
  async move(from: string, to: string, overwrite: boolean) {
    const db = await this.db
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite'); const s = tx.objectStore('files')
      let status = 200
      const read = s.get(from)
      read.onsuccess = () => {
        if (!read.result) { status = 404; return }
        const dest = s.get(to)
        dest.onsuccess = () => {
          if (dest.result && !overwrite) { status = 409; return }
          s.put({ ...read.result, key: to, modified: Date.now() }); s.delete(from)
        }
      }
      tx.oncomplete = () => resolve(status)
      tx.onerror = () => reject(tx.error)
    })
  }
}
