/**
 * IndexedDB persistence for stores.
 *
 * Lives here rather than in `src/lib` on purpose: localForage is browser-only,
 * and `tsconfig.worker.json` compiles everything under `src/lib`. Anything with
 * a DOM or storage dependency has to stay out of that directory.
 */
import localforage from 'localforage'

const store = localforage.createInstance({
  name: 'stagescape',
  storeName: 'state',
  description: 'Persisted panel state and cached hiscores snapshots',
})

export async function read<T>(key: string): Promise<T | null> {
  try {
    return await store.getItem<T>(key)
  } catch {
    // A private window, cleared site data, or a browser blocking storage all
    // land here. Missing state is recoverable; a thrown read is not.
    return null
  }
}

export async function write(key: string, value: unknown): Promise<void> {
  try {
    // IndexedDB's structured clone chokes on Vue's reactive proxies, so
    // snapshot to plain data first. Every persisted value goes through this.
    await store.setItem(key, JSON.parse(JSON.stringify(value)))
  } catch {
    // Storage full, or unavailable. Losing a write is survivable; the export
    // in the About panel is the real safety net.
  }
}

export async function remove(key: string): Promise<void> {
  try {
    await store.removeItem(key)
  } catch {
    // Same reasoning as write.
  }
}
