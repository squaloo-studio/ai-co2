import { describe, expect, it } from 'vitest';
import { classifyModel } from './index';
import { futureClaudeNames, futureGptNames, respelledCases } from './fixtures/spellings';
import type { Spelled } from './fixtures/spellings';

/** One line for every name that got another answer than it must. Thousands of names, so they are not tests of their own. */
function wrongAnswers(names: Spelled[]): string[] {
  const wrong: string[] = [];
  for (const s of names) {
    const got = classifyModel(s.name, s.options);
    const reason = got.class === 'unknown' ? got.reason : undefined;
    const right =
      got.class === s.class &&
      got.displayName === s.displayName &&
      got.thinking === s.thinking &&
      (s.reason === undefined || reason === s.reason);
    if (right) continue;
    wrong.push(
      `${s.how}: ${JSON.stringify(s.name)}${s.options ? ' ' + JSON.stringify(s.options) : ''} is ${got.class} "${got.displayName}"` +
        `${got.thinking ? ', thinking' : ''}${reason ? ', ' + reason : ''} (rule ${got.rule}), not ${s.class} "${s.displayName}"`,
    );
  }
  return wrong;
}

const distinct = (names: Spelled[]): number => new Set(names.map((s) => s.name)).size;

describe('a checked name in another spelling', () => {
  const names = respelledCases();

  it('gets the answer of the checked name', () => {
    // Capitals, "_" for "-" and spaces around any name. A date, a platform prefix, "[1m]" or a
    // gateway on the names that are written that way.
    expect(distinct(names)).toBeGreaterThan(15_000);
    expect(wrongAnswers(names)).toEqual([]);
  });

  it('covers Bedrock, Google Cloud and gateway spellings', () => {
    const all = new Set(names.map((s) => s.name));
    for (const name of [
      'us.anthropic.claude-opus-5-5-20270115-v1:0',
      'arn:aws:bedrock:us-west-2:000000000000:inference-profile/us.anthropic.claude-haiku-4-5-20251001',
      'projects/demo/locations/us-east5/publishers/anthropic/models/claude-sonnet-5-5@20270115',
      'CLAUDE-FABLE-5-1',
      'claude_opus_5_5',
      'openrouter/openai/gpt-5-2-thinking-2027-01-15',
      'openai/o3-mini-high-20270115',
      'models/gemini-2.5-flash-lite-001',
    ]) {
      expect(all.has(name), name).toBe(true);
    }
  });
});

describe('a version that does not exist yet', () => {
  it('falls into its Claude family, on every platform', () => {
    const names = futureClaudeNames();
    expect(distinct(names)).toBeGreaterThan(6_000);
    expect(wrongAnswers(names)).toEqual([]);
  });

  it('follows its GPT tier word, or says that the name hides the tier', () => {
    const names = futureGptNames();
    expect(distinct(names)).toBeGreaterThan(2_000);
    expect(wrongAnswers(names)).toEqual([]);
  });

  it.each([
    ['claude-opus-6', 'large', 'Opus 6'],
    ['claude-sonnet-6-1', 'medium', 'Sonnet 6.1'],
    ['claude-haiku-5', 'small', 'Haiku 5'],
    ['claude-fable-6', 'fable', 'Fable 6'],
    ['eu.anthropic.claude-opus-7-2-20280301-v1:0', 'large', 'Opus 7.2'],
    ['gpt-5.9-mini', 'small', 'GPT-5.9 mini'],
    ['gpt-5-8-pro', 'large', 'GPT-5.8 Pro'],
    ['gpt-6.4-astra', 'large', 'GPT-6.4 Astra'],
    ['gpt-6.4-sol', 'medium', 'GPT-6.4 Sol'],
    ['gpt-8-luna', 'small', 'GPT-8 Luna'],
    ['o3-pro-2027-01-15', 'large', 'o3-pro'],
    ['gemini-4.5-flash-lite', 'small', 'Gemini 4.5 Flash-Lite'],
    ['gemini-5-pro', 'large', 'Gemini 5 Pro'],
  ])('%s is %s', (name, cls, displayName) => {
    expect(classifyModel(name)).toMatchObject({ class: cls, displayName, byPlan: false });
  });

  it.each(['claude-saga-1', 'claude-5', 'claude-next', 'gpt-7-sol', 'gpt-10-sol', 'o5', 'o5-mini', 'gemini-4', 'gemini-4-ultra'])(
    '%s is a new line, and is not guessed',
    (name) => {
      expect(classifyModel(name)).toMatchObject({ class: 'unknown', reason: 'unrecognised', displayName: name });
    },
  );
});

describe("other companies' models and nonsense", () => {
  // Public model ids of other makers, a few picker and gateway words, and text that is no name at all.
  const NOT_OURS = [
    'glm-4.6', 'glm-4.5-air', 'kimi-k2', 'kimi-k2-thinking', 'moonshot-v1-128k', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-r1',
    'deepseek-v3.1', 'qwen3-coder-plus', 'qwen-max', 'qwen2.5-coder-32b', 'qwen3-235b-a22b-thinking', 'grok-4', 'grok-4-fast',
    'grok-3-mini', 'grok-code-fast-1', 'llama-3.3-70b', 'llama3.2:3b', 'meta-llama/Llama-4-Maverick-17B', 'mistral-small-latest',
    'mistral-large-2411', 'codestral-latest', 'mixtral-8x7b', 'devstral-medium', 'magistral-medium', 'pixtral-large', 'phi-4-mini',
    'phi-4', 'phi-3.5-mini-instruct', 'gemma-3-27b-it', 'gemma2:9b', 'command-r-plus', 'command-a-03-2025', 'amazon.nova-pro-v1:0',
    'nova-lite', 'nova-micro', 'amazon.titan-text-express-v1', 'minimax-m2', 'ernie-4.0-8k', 'yi-large', 'doubao-pro-32k', 'sonar-pro',
    'sonar', 'sonar-reasoning-pro', 'big-pickle', 'openrouter/auto', 'cursor-small', 'composer-1', 'auto-router',
    // "gpt", "o1" or a tier word, but not OpenAI's.
    'minigpt-4', 'MiniGPT-5', 'ruGPT-3.5-13B', 'rugpt-3', 'h2ogpt-4096-llama2-7b-chat', 'gpt4all-j', 'gpt-j-6b', 'gpt-neo-2.7B', 'gpt2',
    'gpt-4chan', 'DialoGPT-large', 'biogpt', 'Video-ChatGPT-7B', 'deepseek-o1', 'qwen-o3-mini', 'azure/o3-mini', 'o2', 'o5', 'o1x',
    'o3mini', 'xo1',
    // OpenAI's own, but not text models with a size we know.
    'gpt-image-1', 'gpt-oss-120b', 'gpt-oss-20b', 'gpt-realtime', 'codex-mini-latest', 'computer-use-preview', 'davinci-002',
    'babbage-002', 'text-davinci-003', 'text-embedding-3-small', 'dall-e-3', 'whisper-1', 'tts-1', 'omni-moderation-latest', 'chat-latest',
    // Near misses of a Claude or Gemini name.
    'claude', 'Claude', 'claude-3', 'claude-2.1', 'claude-opux-5', 'opuses', 'sonnets', 'haikus', 'fables', 'mythosx', 'mythomax-l2-13b',
    'gemini', 'gemini-3', 'gemini-ultra', 'gemini-nano', 'geminipro', 'flash', 'flash-lite', 'gemma-pro',
    // Not names.
    'default', 'best', 'unknown', 'model', 'large', 'small', 'medium', 'pro', 'mini', 'thinking', 'latest', 'none', 'null', 'undefined',
    'true', 'false', 'NaN', '0', '-1', '4o', 'o', 'gpt', 'GPT', 'chatgpt', 'ChatGPT', 'gpt-', 'gpt-x', 'gpt-four', 'GPT 5.6',
    'Deep research', 'asdf', 'qwerty', 'lorem ipsum dolor', '???', '...', '---', '🙂', '模型', 'модель',
  ];

  it.each(NOT_OURS)('%s is not guessed', (name) => {
    for (const plan of ['plus-or-pro', 'free-or-go', undefined] as const) {
      const got = classifyModel(name, plan === undefined ? undefined : { plan });
      expect({ ...got, rule: '' }).toEqual({
        class: 'unknown', reason: 'unrecognised', displayName: name, thinking: false, byPlan: false, rule: '',
      });
    }
  });
});
