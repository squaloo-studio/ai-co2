// The tokenizer keeps the tokens of the pieces of text it has seen. Left at its own size of 100,000
// pieces, that store makes text with few repeated words several times slower once it is full, and
// can grow past a gigabyte. This checks that the size is set when the tokenizer is loaded. The
// speed itself was measured by hand: a test of it would depend on how busy the machine is.
import { describe, expect, it, vi } from 'vitest';

const tokenizer = vi.hoisted(() => ({
  countTokens: vi.fn((_text: string, _options?: { disallowedSpecial?: Set<string> }) => 7),
  setMergeCacheSize: vi.fn((_size: number) => undefined),
}));
vi.mock('gpt-tokenizer/encoding/o200k_base', () => tokenizer);

describe('the tokenizer as this folder loads it', () => {
  it('keeps a store of a size that stays fast when it is full', async () => {
    const { countO200k } = await import('./tokens');
    expect(tokenizer.setMergeCacheSize).toHaveBeenCalledTimes(1);
    const size = tokenizer.setMergeCacheSize.mock.calls[0]?.[0] ?? 0;
    expect(size).toBeGreaterThanOrEqual(8_192);
    expect(size).toBeLessThanOrEqual(32_768);

    // And it hands the text and the option on unchanged.
    const options = { disallowedSpecial: new Set<string>() };
    expect(countO200k('some text', options)).toBe(7);
    expect(tokenizer.countTokens).toHaveBeenCalledWith('some text', options);
  });
});
