// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { outLink, safeUrl, syncList } from './dom';
import { renderRich } from './rich';

describe('renderRich', () => {
  it('draws a string that looks like markup as text', () => {
    const target = document.createElement('p');
    renderRich(target, ['<img src=x onerror=alert(1)>', { mark: '<b>1 kg</b>' }, { code: '<script>x</script>' }, { strong: '<i>!</i>' }]);
    expect(target.querySelector('img, script, i')).toBeNull();
    expect(target.querySelectorAll('b').length).toBe(0);
    expect(target.textContent).toBe('<img src=x onerror=alert(1)><b>1 kg</b><script>x</script><i>!</i>');
    expect(target.querySelector('mark')?.textContent).toBe('<b>1 kg</b>');
    expect(target.querySelector('code')?.textContent).toBe('<script>x</script>');
    expect(target.querySelector('strong')?.textContent).toBe('<i>!</i>');
  });

  it('replaces what was drawn before', () => {
    const target = document.createElement('p');
    renderRich(target, ['one ', { mark: 'two' }]);
    renderRich(target, ['three']);
    expect(target.textContent).toBe('three');
    expect(target.querySelector('mark')).toBeNull();
  });
});

describe('links from the View', () => {
  it('follows an https address', () => {
    expect(safeUrl('https://example.org/a?b=1')).toBe('https://example.org/a?b=1');
    const link = outLink('https://example.org/', 'btn');
    expect(link?.getAttribute('href')).toBe('https://example.org/');
    expect(link?.rel).toBe('noopener noreferrer');
    expect(link?.target).toBe('_blank');
  });

  it('does not follow anything that does not start with https://', () => {
    for (const url of ['javascript:alert(1)', 'http://example.org/', '//example.org/', '/local', 'data:text/html,x', ' https://example.org/', 'HTTPS://example.org/', 'https://', '', null, undefined]) {
      expect(safeUrl(url)).toBeNull();
      expect(outLink(url)).toBeNull();
    }
  });
});

describe('syncList', () => {
  const create = () => document.createElement('button');
  const update = (node: HTMLButtonElement, item: string) => {
    node.textContent = item;
  };
  const sync = (list: Element, items: string[]) => syncList(list, items, item => item, create, update);
  const texts = (list: Element) => Array.from(list.children, child => child.textContent);

  it('adds, removes and reorders rows without rebuilding the ones that stay', () => {
    const list = document.createElement('ul');
    document.body.append(list);
    sync(list, ['a', 'b', 'c']);
    const [a, b, c] = Array.from(list.children);
    sync(list, ['c', 'a', 'd']);
    expect(texts(list)).toEqual(['c', 'a', 'd']);
    expect(list.children[0]).toBe(c);
    expect(list.children[1]).toBe(a);
    expect(b?.isConnected).toBe(false);
    list.remove();
  });

  it('keeps the focus on a row that stays, wherever it moves', () => {
    const list = document.createElement('ul');
    document.body.append(list);
    sync(list, ['a', 'b', 'c']);
    const b = list.children[1] as HTMLButtonElement;
    b.focus();
    sync(list, ['b', 'c', 'a']);
    expect(document.activeElement).toBe(b);
    sync(list, ['x', 'b']);
    expect(document.activeElement).toBe(b);
    list.remove();
  });

  it('copes with a key that comes twice', () => {
    const list = document.createElement('ul');
    sync(list, ['a', 'a', 'b']);
    expect(texts(list)).toEqual(['a', 'b']);
    // Two children that already share a key: one is kept, and neither is left behind later.
    const stray = create();
    stray.setAttribute('data-key', 'a');
    list.append(stray);
    sync(list, ['a', 'b']);
    expect(texts(list)).toEqual(['a', 'b']);
    sync(list, []);
    expect(list.children.length).toBe(0);
  });
});
