// The page's content security policy is a meta tag, and a meta tag is a rule for the page. A worker
// file gets its policy from the headers it is served with, and a static host sends none. So the
// browser would let this worker open connections that the page itself may not.
//
// The worker's code has no use for the network: it is handed File objects and hands back counts.
// To make that a fact and not only a habit, the worker gives the network up itself, before the
// first file reaches it.
//
// One way stays open: `import()` of an address. It is syntax, not a name, and cannot be taken away
// here. Only a policy that the host sends as a header with the worker's file closes it. Nothing in
// the worker runs text from a file as code, so nothing in a file can reach it.

/**
 * The names through which a worker's script could open a connection or start more code from an
 * address. `FontFace` and `caches` are among them: a font can be loaded from an address, and a
 * cache can be told to fetch one.
 */
export const NETWORK = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'importScripts', 'Worker', 'SharedWorker',
  'FontFace', 'caches',
] as const;

/**
 * Takes the names of NETWORK out of a global scope, for good. Returns the names that could not be
 * taken out, which is none in the browsers this was tried in.
 */
export function goOffline(scope: object): string[] {
  const left: string[] = [];
  for (const name of NETWORK) {
    // A name can sit on the scope itself or on what it inherits from, where a call could still reach it.
    for (let holder: object | null = scope; holder !== null; holder = Object.getPrototypeOf(holder) as object | null) {
      if (!Object.hasOwn(holder, name)) continue;
      try {
        Object.defineProperty(holder, name, { value: undefined, writable: false, configurable: false });
      } catch {
        // Fixed in place by the browser. The check below reports it.
      }
    }
    if (Reflect.get(scope, name) !== undefined) left.push(name);
  }
  return left;
}
