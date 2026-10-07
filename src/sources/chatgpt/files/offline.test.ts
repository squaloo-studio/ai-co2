import { describe, expect, it } from 'vitest';
import { goOffline, NETWORK } from './offline';

/** A stand-in for a worker's scope: some names on the scope itself, some on what it inherits from. */
function fakeScope(): { scope: Record<string, unknown>; parent: Record<string, unknown>; grandparent: Record<string, unknown> } {
  const grandparent: Record<string, unknown> = { fetch: () => 'sent', addEventListener: () => {} };
  const parent: Record<string, unknown> = Object.create(grandparent) as Record<string, unknown>;
  parent.importScripts = () => 'loaded';
  const scope: Record<string, unknown> = Object.create(parent) as Record<string, unknown>;
  for (const name of ['XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'Worker', 'SharedWorker', 'FontFace']) scope[name] = class {};
  // In a browser `caches` is not a value but a getter, two levels up.
  Object.defineProperty(grandparent, 'caches', { get: () => ({ open: () => 'opened' }), configurable: true, enumerable: true });
  scope.postMessage = () => 'posted';
  scope.DecompressionStream = class {};
  return { scope, parent, grandparent };
}

describe('a worker that gives up the network', () => {
  it('names every way a worker could connect or start code from an address', () => {
    expect([...NETWORK].sort()).toEqual(['EventSource', 'FontFace', 'SharedWorker', 'WebSocket', 'WebSocketStream', 'WebTransport', 'Worker', 'XMLHttpRequest', 'caches', 'fetch', 'importScripts']);
  });

  it('takes each of them away, on the scope and on everything it inherits from', () => {
    const { scope, parent, grandparent } = fakeScope();
    expect(goOffline(scope)).toEqual([]);
    for (const name of NETWORK) {
      expect(scope[name], name).toBeUndefined();
      expect(Reflect.get(parent, name), name).toBeUndefined();
      expect(Reflect.get(grandparent, name), name).toBeUndefined();
    }
    // A call that goes round the scope finds nothing either.
    expect(Object.getOwnPropertyDescriptor(grandparent, 'fetch')).toEqual({ value: undefined, writable: false, enumerable: true, configurable: false });
  });

  it('cannot be undone by the code that runs afterwards', () => {
    const { scope, grandparent } = fakeScope();
    goOffline(scope);
    expect(() => {
      scope.XMLHttpRequest = class {};
    }).toThrow(TypeError);
    expect(() => {
      grandparent.fetch = () => 'sent again';
    }).toThrow(TypeError);
    expect(() => Object.defineProperty(scope, 'WebSocket', { value: class {} })).toThrow(TypeError);
    expect(Reflect.deleteProperty(scope, 'Worker')).toBe(false);
    expect(scope.XMLHttpRequest).toBeUndefined();
    expect(scope.fetch).toBeUndefined();
  });

  it('takes away a font loaded from an address and a cache told to fetch one', () => {
    const { scope, grandparent } = fakeScope();
    expect(typeof scope.FontFace).toBe('function');
    expect(typeof scope.caches).toBe('object');
    expect(goOffline(scope)).toEqual([]);
    expect(scope.FontFace).toBeUndefined();
    // The getter is gone for good, not only hidden: nothing can reach the cache through it again.
    expect(scope.caches).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(grandparent, 'caches')).toEqual({ value: undefined, writable: false, enumerable: true, configurable: false });
    expect(() => Object.defineProperty(grandparent, 'caches', { get: () => 'back' })).toThrow(TypeError);
  });

  it('leaves alone what the reader needs', () => {
    const { scope } = fakeScope();
    goOffline(scope);
    expect(typeof scope.postMessage).toBe('function');
    expect(typeof scope.addEventListener).toBe('function');
    expect(typeof scope.DecompressionStream).toBe('function');
  });

  it('says so when a browser will not let go of a name, and does not throw', () => {
    const scope: Record<string, unknown> = {};
    Object.defineProperty(scope, 'fetch', { value: () => 'sent', writable: false, configurable: false });
    scope.WebSocket = class {};
    expect(goOffline(scope)).toEqual(['fetch']);
    expect(scope.WebSocket).toBeUndefined();
  });

  it('is done on a scope that has none of the names', () => {
    expect(goOffline({})).toEqual([]);
    expect(goOffline(Object.create(null) as object)).toEqual([]);
  });
});
