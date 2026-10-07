// Small helpers for building the page with nodes. Nothing here ever parses a string as HTML.

const SVG = 'http://www.w3.org/2000/svg';

/** The one element a part of the page cannot work without. Says which hook is missing instead of failing later. */
export function need<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`ai-co2: the page is missing ${selector}`);
  return node;
}

export function all<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** An icon from the sprite in index.html. Icons always sit beside words, so they are hidden from screen readers. */
export function icon(name: string, small = false): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', small ? 'i i-s' : 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function show(node: Element, on: boolean): void {
  node.toggleAttribute('hidden', !on);
}

/** Writes only when the text differs, so a number that counts across does not touch the page on every frame. */
export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

let ids = 0;
/** An id for wiring a label to its control. Ids from the View are never used as element ids. */
export function nextId(prefix: string): string {
  ids += 1;
  return `${prefix}-${ids}`;
}

/** A link from the View is only followed when it is a plain https address. Anything else gives null. */
export function safeUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** A link that leaves the site in a new tab, or null when the address is not safe to follow. */
export function outLink(url: string | null | undefined, className = ''): HTMLAnchorElement | null {
  const href = safeUrl(url);
  if (!href) return null;
  const a = el('a', className);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/**
 * Brings a list's children in line with `items` without rebuilding what is already there, so a switch or
 * a slider keeps its focus when the View changes. Children are matched by `key`.
 */
export function syncList<T, E extends Element>(
  parent: Element,
  items: readonly T[],
  key: (item: T) => string,
  create: (item: T) => E,
  update: (node: E, item: T) => void,
): void {
  const focused = document.activeElement;
  const old = new Map<string, E>();
  for (const child of Array.from(parent.children)) {
    const k = child.getAttribute('data-key');
    // A second child with a key already seen could never be matched again, so it goes.
    if (k !== null && !old.has(k)) old.set(k, child as E);
    else child.remove();
  }
  let at = parent.firstElementChild;
  const used = new Set<string>();
  for (const item of items) {
    const k = key(item);
    // Two items with one key would fight over one node. The first keeps it.
    if (used.has(k)) continue;
    used.add(k);
    let node = old.get(k);
    if (node) old.delete(k);
    else {
      node = create(item);
      node.setAttribute('data-key', k);
    }
    update(node, item);
    if (node === at) at = at.nextElementSibling;
    else parent.insertBefore(node, at);
  }
  for (const node of old.values()) node.remove();
  // Moving a row takes the focus off whatever it holds. A row that stayed gets it back.
  if (focused instanceof HTMLElement && focused !== document.activeElement && parent.contains(focused)) focused.focus({ preventScroll: true });
}

/** Replaces a list's rows with plain sentences. */
export function setLines(list: Element, lines: readonly string[]): void {
  const now = Array.from(list.children, li => li.textContent ?? '');
  if (now.length === lines.length && now.every((text, i) => text === lines[i])) return;
  list.replaceChildren(...lines.map(line => el('li', '', line)));
}

/**
 * Text that is seen in one form and spoken in another. When the two are the same, the node holds plain
 * text. Otherwise the seen form is hidden from screen readers and the spoken one from the eye.
 */
export function setSeenAndSpoken(node: Element, seen: string, spoken: string): void {
  if (seen === spoken) {
    if (node.childElementCount > 0 || node.textContent !== seen) node.textContent = seen;
    return;
  }
  const [first, second] = [node.children[0], node.children[1]];
  if (node.childElementCount === 2 && first?.textContent === seen && second?.textContent === spoken) return;
  const visible = el('span', '', seen);
  visible.setAttribute('aria-hidden', 'true');
  node.replaceChildren(visible, el('span', 'sr', spoken));
}
