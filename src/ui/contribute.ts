// Chapter "Three ways to contribute": what each option would cost for this range, and where to go.

import type { ContributeOption, View } from '../contracts/view';
import { all, el, icon, need, outLink, setText, show, syncList } from './dom';
import { renderRich } from './rich';

export interface ContributePart {
  update(view: View): void;
}

const FIELDS: Array<[label: string, key: 'price' | 'minimum' | 'whatYouGet' | 'forYourRange']> = [
  ['Price', 'price'],
  ['Minimum', 'minimum'],
  ['What you get', 'whatYouGet'],
  ['For your range', 'forYourRange'],
];

function createOption(): HTMLElement {
  const article = el('article', 'opt');
  const head = el('div');
  head.append(el('h3'), el('p', 'opt-kind'));
  article.append(head);
  for (const pair of [FIELDS.slice(0, 2), FIELDS.slice(2)]) {
    const list = el('dl');
    for (const [label, key] of pair) {
      const row = el('div');
      const value = el('dd');
      value.setAttribute('data-field', key);
      const name = el('dt', '', label);
      name.setAttribute('data-label', key);
      row.append(name, value);
      list.append(row);
    }
    article.append(list);
  }
  const slot = el('div');
  slot.setAttribute('data-link', '');
  article.append(slot);
  return article;
}

function updateOption(article: HTMLElement, option: ContributeOption): void {
  setText(need(article, 'h3'), option.name);
  setText(need(article, '.opt-kind'), option.kind);
  for (const [, key] of FIELDS) setText(need(article, `[data-field="${key}"]`), option[key]);

  const slot = need(article, '[data-link]');
  const key = `${option.url}|${option.name}`;
  if (slot.getAttribute('data-for') === key) return;
  slot.setAttribute('data-for', key);
  const link = outLink(option.url, 'btn btn--line');
  if (link) link.append(`Go to ${option.name}`, el('span', 'sr', ' (opens in a new tab)'), icon('out', true));
  slot.replaceChildren(...(link ? [link] : []));
}

export function createContribute(root: ParentNode): ContributePart {
  const section = need(root, '[data-chapter="contribute"]');
  const cost = need(section, '[data-cost]');
  const options = need(section, '[data-options]');
  const footnote = need(section, '[data-footnote]');

  return {
    update(view) {
      const contribute = view.result ? view.contribute : null;
      show(section, !!contribute);
      if (!contribute) return;
      setText(cost, contribute.costSentence);
      syncList(options, contribute.options, option => option.id, createOption, updateOption);
      // One outcome is no range, so the cost is not "for your range" then.
      const label = view.result?.single ? 'For your estimate' : 'For your range';
      for (const name of all(options, '[data-label="forYourRange"]')) setText(name, label);
      show(footnote, contribute.footnote.length > 0);
      renderRich(footnote, contribute.footnote);
    },
  };
}
