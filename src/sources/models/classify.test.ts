import { describe, expect, it } from 'vitest';
import { classifyModel, SIZE_CLASSES } from './index';
import type { ModelClass } from './index';
import { cases, hostile } from './fixtures/cases';

const reasonOf = (got: ModelClass): string | undefined => (got.class === 'unknown' ? got.reason : undefined);

describe('the 280 checked names', () => {
  it('are all here', () => {
    expect(cases).toHaveLength(280);
    const count = (cls: string) => cases.filter((c) => c.class === cls).length;
    expect([count('large'), count('medium'), count('small'), count('fable'), count('unknown'), count('skip')]).toEqual([
      98, 66, 59, 11, 44, 2,
    ]);
  });

  it.each(cases.map((c, i) => [`${i + 1}: ${JSON.stringify(c.name)}${c.options ? ' ' + JSON.stringify(c.options) : ''}`, c] as const))(
    '%s',
    (_label, c) => {
      const got = classifyModel(c.name, c.options);
      expect({ class: got.class, displayName: got.displayName, thinking: got.thinking }).toEqual({
        class: c.class,
        displayName: c.displayName,
        thinking: c.thinking,
      });
      if (c.reason !== undefined) expect(reasonOf(got)).toBe(c.reason);
    },
  );

  it('give one class per display name, but for the name that depends on the plan', () => {
    const classesOf = new Map<string, Set<string>>();
    for (const c of cases) {
      if (c.options !== undefined) continue;
      const got = classifyModel(c.name);
      const classes = classesOf.get(got.displayName) ?? new Set<string>();
      classesOf.set(got.displayName, classes.add(got.class));
    }
    const mixed = [...classesOf].filter(([, classes]) => classes.size > 1).map(([name]) => name);
    // "gpt-5-6" hides its model and the API's "gpt-5.6" does not. So rows are merged by name and class.
    expect(mixed).toEqual(['GPT-5.6']);
    expect(classifyModel('gpt-5.6', { plan: 'free-or-go' }).class).toBe('large');
    expect(classifyModel('gpt-5-6', { plan: 'free-or-go' }).class).toBe('small');
  });
});

describe('the name that depends on the ChatGPT plan', () => {
  it('is the large model on Plus or Pro', () => {
    expect(classifyModel('gpt-5-6', { plan: 'plus-or-pro' })).toEqual({
      class: 'large', displayName: 'GPT-5.6', thinking: false, byPlan: true, rule: 'O12',
    });
  });

  it('is the small model on Free or Go', () => {
    expect(classifyModel('gpt-5-6', { plan: 'free-or-go' })).toEqual({
      class: 'small', displayName: 'GPT-5.6', thinking: false, byPlan: true, rule: 'O12',
    });
  });

  it('is unknown, and says why, while the plan is not known', () => {
    const expected = {
      class: 'unknown', reason: 'tier-hidden', displayName: 'GPT-5.6', thinking: false, byPlan: true, rule: 'O12',
    };
    expect(classifyModel('gpt-5-6')).toEqual(expected);
    expect(classifyModel('gpt-5-6', {})).toEqual(expected);
    expect(classifyModel('gpt-5-6', { plan: undefined })).toEqual(expected);
  });

  it('takes nothing but the two plans', () => {
    const inherited: unknown = Object.create({ plan: 'plus-or-pro' });
    for (const bad of [null, 'plus-or-pro', 1, true, [], { plan: true }, { plan: 'Plus' }, { plan: 'paid' },
      { plan: { toString: () => 'plus-or-pro' } }, { paidPlan: true }, inherited]) {
      expect(classifyModel('gpt-5-6', hostile(bad)).class).toBe('unknown');
    }
  });

  it.each(['gpt-5-6-instant', 'gpt-5-6-auto', 'gpt-5-7', 'GPT_5_6'])('covers %s the same way', (name) => {
    expect(classifyModel(name, { plan: 'plus-or-pro' }).class).toBe('large');
    expect(classifyModel(name, { plan: 'free-or-go' }).class).toBe('small');
    expect(classifyModel(name).class).toBe('unknown');
    expect(classifyModel(name).byPlan).toBe(true);
  });

  it.each([
    ['gpt-5-6-thinking', 'large'],
    ['gpt-5.6', 'large'],
    ['gpt-5-6-t-mini', 'small'],
    ['gpt-5-6-pro', 'large'],
    ['gpt-5-5', 'large'],
    ['gpt-5', 'medium'],
    ['claude-opus-5-5', 'large'],
    ['gpt-6', 'unknown'],
    ['glm-4.6', 'unknown'],
  ])('changes nothing for %s', (name, cls) => {
    for (const plan of ['plus-or-pro', 'free-or-go', undefined] as const) {
      const got = classifyModel(name, plan === undefined ? undefined : { plan });
      expect(got.class).toBe(cls);
      expect(got.byPlan).toBe(false);
    }
  });
});

describe('hostile names', () => {
  const unknownWith = (name: unknown, reason: string): ModelClass => {
    const got = classifyModel(name);
    expect(got.class).toBe('unknown');
    expect(reasonOf(got)).toBe(reason);
    expect(got.thinking).toBe(false);
    return got;
  };

  it('counts anything that is not text or a number as no name', () => {
    const shouting = { toString: () => 'claude-opus-5-5', valueOf: () => 'claude-opus-5-5' };
    for (const nothing of ['', '   ', '\n\t', null, undefined, true, false, {}, [], ['claude-opus-5-5'], shouting,
      Symbol('opus'), 10n, () => 'opus', new String('claude-opus-5-5')]) {
      expect(unknownWith(nothing, 'empty').displayName).toBe('(no model name)');
    }
  });

  it('reads a number as its digits, and never as a model', () => {
    expect(unknownWith(5, 'unrecognised').displayName).toBe('5');
    expect(unknownWith(Number.NaN, 'unrecognised').displayName).toBe('NaN');
    expect(unknownWith(Number.POSITIVE_INFINITY, 'unrecognised').displayName).toBe('Infinity');
  });

  it('does not scan or show a megabyte', () => {
    const started = performance.now();
    for (const huge of ['claude-opus-5-5 '.repeat(70_000), 'a'.repeat(1_000_000), 'gpt-'.repeat(250_000),
      '-'.repeat(1_000_000) + 'opus', '9.'.repeat(500_000)]) {
      expect(huge.length).toBeGreaterThanOrEqual(1_000_000);
      const got = unknownWith(huge, 'unrecognised');
      expect(got.displayName.length).toBeLessThanOrEqual(61);
      expect(got.displayName.endsWith('…')).toBe(true);
    }
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('still reads a real name inside a megabyte of spaces', () => {
    expect(classifyModel(' '.repeat(1_000_000) + 'claude-haiku-4-5' + ' '.repeat(1_000_000)).displayName).toBe('Haiku 4.5');
  });

  it('draws the line for "too long" above every real spelling', () => {
    const arn = 'arn:aws:bedrock:eu-central-1:000000000000:application-inference-profile/';
    expect(classifyModel(arn + 'x'.repeat(256 - arn.length - 5) + '/opus').class).toBe('large');
    expect(classifyModel(arn + 'x'.repeat(256 - arn.length - 4) + '/opus').class).toBe('unknown');
  });

  it('does not cut a too-long name through the middle of a character', () => {
    const got = classifyModel('x'.repeat(59) + '😀'.repeat(200));
    expect(got.displayName).toBe('x'.repeat(59) + '…');
  });

  it('hands HTML back as plain text, unchanged, and unknown', () => {
    for (const html of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>',
      '&lt;b&gt;', 'javascript:alert(1)', '<SYNTHETIC>', '<synthetic><script>']) {
      expect(unknownWith(html, 'unrecognised').displayName).toBe(html);
    }
  });

  it('keeps markup out of a friendly name', () => {
    // Words after a known model go into the friendly name. Only letters and digits get through.
    for (const name of ['gpt-4o-<script>alert(1)</script>', 'claude-opus-5-5<img src=x onerror=alert(1)>',
      'gpt-5-"onmouseover="x', 'o3-mini<b>', 'gemini-2.5-pro<i>', 'text-davinci-002-render-<u>']) {
      const got = classifyModel(name);
      expect(got.class).not.toBe('unknown');
      expect(got.displayName).toMatch(/^[A-Za-z0-9 .·()-]+$/);
    }
    expect(classifyModel('gpt-4o-<script>alert(1)</script>').displayName).toBe('GPT-4o (script alert script)');
  });

  it('finds nothing on a prototype', () => {
    for (const name of ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty',
      '__defineGetter__', 'constructor.prototype', '__proto__.polluted']) {
      expect(unknownWith(name, 'unrecognised').displayName).toBe(name);
    }
    // In the tail of a GPT name these words are looked up. They must come back as plain words.
    expect(classifyModel('gpt-5-constructor').displayName).toBe('GPT-5 (constructor)');
    expect(classifyModel('gpt-4o-__proto__').displayName).toBe('GPT-4o (proto)');
    expect(classifyModel('gpt-4-hasOwnProperty-toString-valueOf').displayName).toBe('GPT-4 (hasownproperty tostring valueof)');
    expect(classifyModel('claude-constructor-5').class).toBe('unknown');
    expect(classifyModel('o3-constructor').displayName).toBe('o3');
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it('returns a plain result with a known class for whatever comes in', () => {
    const classes = new Set<string>([...SIZE_CLASSES, 'unknown', 'skip']);
    for (const name of ['\u0000', '\u202Egpt-4o', 'ɢᴘᴛ-4ᴏ', 'ＧＰＴ-４', 'İ', 'gpt-', 'gpt-99999', 'gpt-4o'.repeat(40), 'o1'.repeat(100),
      'claude--', '----', '....', '[1m]', '9'.repeat(256), -0, 1e21, { class: 'large' }]) {
      const got = classifyModel(name);
      expect(classes.has(got.class)).toBe(true);
      expect(typeof got.displayName).toBe('string');
      expect(typeof got.thinking).toBe('boolean');
      expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
    }
  });

  it('does not take a look-alike for a model', () => {
    for (const name of ['opusplan', 'magnum-opus-v2x'.replace('-opus-', 'opus'), 'deepseek-o1', 'qwen-o3', 'notgpt4o', 'ｇｐｔ-4o',
      'сlaude-орus-5', '<synthetic> ', 'synthetic', 'autopilot']) {
      const got = classifyModel(name);
      if (name.trim() === '<synthetic>') expect(got.class).toBe('skip');
      else expect(got.class).toBe('unknown');
    }
  });
});

describe('the order of the rules', () => {
  // A name with the words of two rules shows which one comes first. Nothing else in the tests would
  // notice two lines of the table changing places.
  it.each([
    ['gpt-5-mini-pro', 'large', 'O4'],
    ['gpt-5-pro-mini', 'large', 'O4'],
    ['gpt-5-4-pro-thinking', 'large', 'O4'],
    ['gpt-6-astra-mini', 'small', 'O5'],
    ['gpt-5.6-sol-luna', 'small', 'O5'],
    ['gpt-5-5-mini', 'small', 'O5'],
    ['gpt-5-6-thinking-mini', 'small', 'O5'],
    ['gpt-6-terra-astra', 'large', 'O6'],
    ['gpt-6-sol-terra', 'medium', 'O7'],
    ['gpt-5-6-sol', 'large', 'O8'],
    ['gpt-5.6-thinking', 'large', 'O11'],
    ['haiku-sonnet-opus-fable', 'fable', 'C1'],
    ['mythos-opus', 'fable', 'C1'],
    ['opus-sonnet', 'large', 'C2'],
    ['sonnet-haiku', 'medium', 'C3'],
    ['claude-instant-haiku', 'small', 'C4'],
    ['claude-instant-gemini-pro', 'small', 'C5'],
    ['claude-opus-gpt-4o', 'large', 'C2'],
    ['gemini-opus', 'large', 'C2'],
    ['auto-opus', 'large', 'C2'],
    ['gemini-flash-lite', 'small', 'G1'],
    ['gemini-2.5-pro-flash', 'medium', 'G2'],
    ['gemini-pro-gpt-4o', 'large', 'G3'],
    ['text-davinci-002-render-gpt-4-pro', 'small', 'O3'],
    ['gpt-4-o3', 'large', 'O9'],
    ['o3-gpt', 'medium', 'O14'],
    ['o3-mini-pro', 'large', 'O14'],
  ])('%s is %s by rule %s', (name, cls, ruleId) => {
    // The plan must not matter for any of them: none is the plain "gpt-5-6".
    for (const plan of ['plus-or-pro', 'free-or-go', undefined] as const) {
      const got = classifyModel(name, plan === undefined ? undefined : { plan });
      expect([got.class, got.rule, got.byPlan]).toEqual([cls, ruleId, false]);
    }
  });
});

describe('"gpt" inside a longer word', () => {
  // The whole-word rule holds for "gpt" too: these are other makers' models, or made-up names.
  it.each(['minigpt-4', 'MiniGPT-5', 'ruGPT-3.5-13B', 'docgpt-4', 'babygpt-3-5', 'nanogpt-5-mini', 'mygpt-5-pro',
    'notgpt-4o', 'xgpt-5-6', 'autogpt-4', 'xchatgpt-4o', 'wechatgpt-4'])('does not make %s an OpenAI model', (name) => {
    for (const plan of ['plus-or-pro', 'free-or-go', undefined] as const) {
      expect(classifyModel(name, plan === undefined ? undefined : { plan })).toEqual({
        class: 'unknown', reason: 'unrecognised', displayName: name, thinking: false, byPlan: false, rule: 'U1',
      });
    }
  });

  it.each([
    ['chatgpt-4o-latest', 'medium', 'GPT-4o'],
    ['openai/chatgpt-4o-latest', 'medium', 'GPT-4o'],
    ['ChatGPT-5', 'medium', 'GPT-5'],
    ['azure/gpt-4o', 'medium', 'GPT-4o'],
    ['openai.gpt-5-mini', 'small', 'GPT-5 mini'],
    ['ft:gpt-4o-mini-2024-07-18:acme::a1b2', 'small', 'GPT-4o mini (acme a1b2)'],
    // The word is read where it stands alone, not where it is part of another word.
    ['minigpt-4 on gpt-5', 'medium', 'GPT-5'],
  ])('still reads %s', (name, cls, displayName) => {
    expect(classifyModel(name)).toMatchObject({ class: cls, displayName });
  });
});

describe('a version written with a dot', () => {
  it('is the large model with "_" as with "-"', () => {
    for (const name of ['gpt-5.6', 'gpt_5.6', 'GPT_5.6', 'openai/gpt_5.7', 'gpt_5.6_instant']) {
      for (const plan of ['plus-or-pro', 'free-or-go', undefined] as const) {
        const got = classifyModel(name, plan === undefined ? undefined : { plan });
        expect([name, got.class, got.byPlan, got.rule]).toEqual([name, 'large', false, 'O11']);
      }
    }
  });

  it('is not read from "_" or "-" between the numbers', () => {
    for (const name of ['gpt-5-6', 'gpt_5_6', 'gpt-5_6', 'GPT_5-6']) {
      expect([name, classifyModel(name).rule]).toEqual([name, 'O12']);
      expect(classifyModel(name, { plan: 'free-or-go' }).class).toBe('small');
    }
  });

  it('is read from the version itself, not from a dot further on', () => {
    expect(classifyModel('gpt-5-6-2027.01.15').rule).toBe('O12');
    expect(classifyModel('gpt-5-6 (not gpt-5.6)').rule).toBe('O12');
    expect(classifyModel('minigpt-5.6 on gpt-5-6').rule).toBe('O12');
    expect(classifyModel('gpt-5.6 (not gpt-5-6)').rule).toBe('O11');
  });
});

describe('a number with letters stuck to it', () => {
  // Claude Code's counting script prints "[" and "]" as "_", so "claude-opus-5[1m]" arrives as
  // "claude-opus-5_1m_". The "1" of the 1M marker is not a version: Fable 5 must not turn into Fable 5.1.
  it.each([
    ['claude-opus-5[1m]', 'large', 'Opus 5'],
    ['claude-opus-5_1m_', 'large', 'Opus 5'],
    ['claude-opus-5-1m', 'large', 'Opus 5'],
    ['claude-fable-5_1m_', 'fable', 'Fable 5'],
    ['claude-mythos-5_1M_', 'fable', 'Mythos 5'],
    ['claude-opus-4-8_1m_', 'large', 'Opus 4.8'],
    ['claude-sonnet-5-5_1M_', 'medium', 'Sonnet 5.5'],
    ['us.anthropic.claude-haiku-4-5-20251001-v1:0_1m_', 'small', 'Haiku 4.5'],
    ['claude-3-5-sonnet-20241022_1m_', 'medium', 'Sonnet 3.5'],
    ['opus[1m]', 'large', 'Opus'],
    ['opus_1m_', 'large', 'Opus'],
    ['sonnet_1m_', 'medium', 'Sonnet'],
    ['Opus 1M', 'large', 'Opus'],
    ['claude-opus-5x', 'large', 'Opus'],
    ['claude-opus-4-5k', 'large', 'Opus 4'],
    ['opus-4o', 'large', 'Opus'],
  ])('%s is %s "%s"', (name, cls, displayName) => {
    expect(classifyModel(name)).toMatchObject({ class: cls, displayName });
  });
});

describe('what the page is handed to show', () => {
  const shown = (name: unknown): string => classifyModel(name).displayName;

  it('makes characters that cannot be seen visible', () => {
    // Zero-width space, word joiner, soft hyphen, a letter that is drawn as nothing, zero-width joiner.
    expect(shown('claude-op\u200Bus-5')).toBe('claude-op\uFFFDus-5');
    expect(shown('glm\u2060-4.6')).toBe('glm\uFFFD-4.6');
    expect(shown('kimi\u00ADk2')).toBe('kimi\uFFFDk2');
    expect(shown('\u3164')).toBe('\uFFFD');
    expect(shown('\u200B')).toBe('\uFFFD');
    expect(shown('auto\u200B')).toBe('auto\uFFFD');
    expect(shown('<synthetic>\u200D')).toBe('<synthetic>\uFFFD');
  });

  it('lets no character turn the text around it', () => {
    // Right-to-left override and embedding, the isolates, the left-to-right and right-to-left marks.
    for (const mark of ['\u202E', '\u202B', '\u202A', '\u202D', '\u202C', '\u2066', '\u2067', '\u2068', '\u2069', '\u200E', '\u200F', '\u061C']) {
      expect(shown(`my${mark}model`)).toBe('my\uFFFDmodel');
    }
    expect(shown('\u202Egro.elpmaxe//:sptth')).toBe('\uFFFDgro.elpmaxe//:sptth');
  });

  it('lets no control character through', () => {
    for (const code of [0, 1, 7, 8, 0x1b, 0x7f, 0x80, 0x85, 0x9f]) {
      expect(shown(`my${String.fromCharCode(code)}model`)).toBe('my\uFFFDmodel');
    }
    expect(shown('x\uD800y')).toBe('x\uFFFDy');
    expect(shown('x\uDC00')).toBe('x\uFFFD');
  });

  it('keeps a name on one line', () => {
    expect(shown('my\nmodel')).toBe('my model');
    expect(shown('my\r\n\tmodel')).toBe('my model');
    expect(shown('my\u2028model\u2029x')).toBe('my model x');
    expect(shown('my \u00A0 model')).toBe('my model');
    expect(shown('x”.\nYour total is 0 kg.\n“')).toBe('x”. Your total is 0 kg. “');
  });

  it('leaves text that can be seen alone', () => {
    // The escaped one is three Arabic letters and a Persian digit: right-to-left text is fine, only its marks are not.
    for (const name of ['glm-4.6', 'my model (v2)', 'Größe-XL', '通义千问-max', 'модель-1', '\u0645\u062F\u0644-\u06F1', 'model 🙂', 'a\u0301', '<b>&amp;"\'`']) {
      expect(shown(name)).toBe(name);
    }
  });

  it('checks every character of a recognised name too', () => {
    for (const name of ['claude-opus-5-5\u202E', '\u202Egpt-4o', 'gpt-4o\u0000mini', 'gpt-4o-\u200Bcanmore', 'o3\u200F-mini', 'gemini\u2066-2.5-pro']) {
      expect(shown(name)).toMatch(/^[A-Za-z0-9 .()-]+$/);
    }
  });

  it('shows up to 100 characters, and the first 60 of anything longer', () => {
    expect(shown('m'.repeat(100))).toBe('m'.repeat(100));
    expect(shown('m'.repeat(101))).toBe('m'.repeat(60) + '…');
    expect(shown('m'.repeat(256))).toBe('m'.repeat(60) + '…');
    expect(shown('m'.repeat(257))).toBe('m'.repeat(60) + '…');
  });

  it('cuts a friendly name that grew too long as well', () => {
    // Every "t-mini" becomes "Thinking mini", so a name of 251 characters gave one of 495.
    const grown = classifyModel('gpt-5-' + 't-mini-'.repeat(35));
    expect(grown.class).toBe('small');
    expect(grown.displayName).toBe('GPT-5' + ' Thinking mini'.repeat(4).slice(0, 55) + '…');
    const tagged = classifyModel('gpt-4o-' + 'ab-'.repeat(80));
    expect(tagged.class).toBe('medium');
    expect(tagged.displayName).toHaveLength(61);
    expect(classifyModel('o3-' + 'mini-'.repeat(50)).displayName).toHaveLength(61);
  });

  it('never hands over more than 100 characters, whatever comes in', () => {
    for (const name of ['x'.repeat(5000), 'gpt-5-6-' + 'gizmo-'.repeat(40), 'gpt-4-' + 'code-interpreter-'.repeat(14),
      'claude-opus-5-5 '.repeat(16), '\u202E'.repeat(300), '😀'.repeat(51), 'e' + '\u0301'.repeat(255)]) {
      for (const plan of ['plus-or-pro', 'free-or-go', undefined] as const) {
        expect(classifyModel(name, plan === undefined ? undefined : { plan }).displayName.length).toBeLessThanOrEqual(100);
      }
    }
  });

  it('says that a name too long to be one was not read', () => {
    expect(classifyModel('claude-opus-5-5 '.repeat(17))).toEqual({
      class: 'unknown', reason: 'unrecognised', displayName: 'claude-opus-5-5 claude-opus-5-5 claude-opus-5-5 claude-opus-…',
      thinking: false, byPlan: false, rule: 'U0',
    });
  });
});
