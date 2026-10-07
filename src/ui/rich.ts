// Draws the View's Rich text. Every part becomes a text node inside a fixed element, so a string from
// the View can never turn into markup.

import type { Rich } from '../contracts/view';
import { spokenRange } from './change';

const drawn = new WeakMap<Element, string>();

export function renderRich(target: Element, rich: Rich): void {
  // The same text again (most View changes leave a tip's wording alone) is not redrawn.
  const key = JSON.stringify(rich);
  if (drawn.get(target) === key) return;
  drawn.set(target, key);
  const doc = target.ownerDocument;
  const wrap = (tag: 'code' | 'strong', text: string) => {
    const node = doc.createElement(tag);
    node.textContent = text;
    return node;
  };
  // A highlighted saving ("roughly 0.75–7.6 kg a month") may wrap on a narrow screen, but never inside
  // its numbers: each run that holds a digit, with the unit after it, stays on one line. A screen reader
  // gets the same words with "to" in place of the dash.
  const mark = (text: string) => {
    const node = doc.createElement('mark');
    const seen = doc.createElement('span');
    for (const piece of text.split(/(\S*\d\S*(?: (?:kg|g|mg)\b)?)/)) {
      if (!piece) continue;
      if (!/\d/.test(piece)) {
        seen.append(piece);
        continue;
      }
      const whole = doc.createElement('span');
      whole.className = 'nowrap';
      whole.textContent = piece;
      seen.append(whole);
    }
    const spoken = spokenRange(text);
    if (spoken === text) {
      node.append(...Array.from(seen.childNodes));
      return node;
    }
    seen.setAttribute('aria-hidden', 'true');
    const words = doc.createElement('span');
    words.className = 'sr';
    words.textContent = spoken;
    node.append(seen, words);
    return node;
  };
  target.replaceChildren(
    ...rich.map(part => {
      if (typeof part === 'string') return doc.createTextNode(part);
      if ('mark' in part) return mark(part.mark);
      if ('code' in part) return wrap('code', part.code);
      return wrap('strong', part.strong);
    }),
  );
}
