type Listener = () => void

const listeners = new Set<Listener>()

export function subscribeVerifiedCountChanged(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function notifyVerifiedCountChanged(): void {
  listeners.forEach((fn) => fn())
}
