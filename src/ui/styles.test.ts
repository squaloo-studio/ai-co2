// What the styles must hold for the page to stay inside a narrow screen and readable. A test page has
// no layout, so these read the rules themselves.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = (name: string): string => readFileSync(new URL(`../styles/${name}.css`, import.meta.url), 'utf8');
const chapters = sheet('chapters');
const controls = sheet('controls');
const data = sheet('data');
const result = sheet('result');

/** The declarations of the first rule with exactly this selector that stands outside every @media and @supports block. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  if (!found) throw new Error(`no rule for ${selector}`);
  return found[1] ?? '';
}

describe('the styles', () => {
  it('lets a highlighted saving wrap, and keeps only its numbers on one line', () => {
    expect(rule(controls, 'mark')).not.toMatch(/white-space:\s*nowrap/);
    expect(rule(controls, 'mark')).toMatch(/box-decoration-break:\s*clone/);
    expect(rule(controls, 'mark .nowrap')).toMatch(/white-space:\s*nowrap/);
  });

  it('breaks a long unbroken word in the message under the paste box and the drop zone', () => {
    const span = rule(data, '.field-msg span');
    expect(span).toMatch(/min-width:\s*0/);
    expect(span).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('gives the progress bar’s track an edge that can be seen', () => {
    expect(rule(data, '.progress-bar')).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--line-control\)/);
  });

  it('draws every tip’s bars on one shared track: fixed columns for the label and the value', () => {
    const columns = rule(chapters, '.tv').match(/grid-template-columns:\s*([^;]+);/)?.[1] ?? '';
    expect(columns).toBe('var(--tv-label) minmax(0, 1fr) minmax(var(--tv-value), max-content)');
    expect(columns).not.toMatch(/fit-content|auto/);
    expect(rule(chapters, '.tv-label')).toMatch(/white-space:\s*nowrap/);
  });

  it('puts a slider’s value under its name, and breaks a readout between two sizes only', () => {
    const top = rule(chapters, '.sl-top');
    expect(top).toMatch(/display:\s*grid/);
    expect(top).not.toMatch(/flex/);
    expect(rule(chapters, '.sl-part')).toMatch(/white-space:\s*nowrap/);
    // The only slider of a group takes the whole row, where the row has more than one column.
    expect(chapters).toMatch(/@media \(min-width: 701px\) \{\s*@supports \(grid-template-columns: subgrid\) \{\s*\.sl\.is-lone \{[^}]*grid-column: 1 \/ -1;/);
  });

  it('seats the pill’s chip on the pill’s edge, ringed in the pill’s colour', () => {
    const chip = rule(result, '.pin-delta');
    expect(chip).toMatch(/top:\s*-11px/);
    expect(chip).toMatch(/box-shadow:\s*0 0 0 3px var\(--navy\)/);
  });

  it('leaves out the label before the last on a narrow scale, where the two would collide', () => {
    expect(result).toMatch(/@media \(max-width: 480px\) \{\s*\.tick:nth-child\(5\) em \{\s*display: none;/);
  });
});
