// The tokenizer: o200k_base, the encoding of every OpenAI model since GPT-4o. This import is the only
// one that loads the vocabulary (about 2.8 MB), so only the worker may reach this file.

import { countTokens, setMergeCacheSize } from 'gpt-tokenizer/encoding/o200k_base';
import type { CountTokens } from './count';

// The tokenizer remembers the tokens of the pieces of text it has seen, 100,000 of them by default.
// Once that store is full, every piece it has not seen costs a search through the slots it freed.
// Text with few repeated words (Chinese, lists of ids) then counts five to ten times slower, and with
// long pieces the store grows past a gigabyte. With 16,384 pieces, ordinary English and code count
// just as fast (measured on 60 million characters), and the store stays below about 200 MB.
setMergeCacheSize(16_384);

export const countO200k: CountTokens = (text, options) => countTokens(text, options);
