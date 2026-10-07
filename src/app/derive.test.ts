import { describe, expect, it } from 'vitest';
import type { SourceStatus, View } from '../contracts/view';
import { ASSUMPTION_ROWS, ENERGY_ROWS, NOTE_NO_EFFECT, NOTE_SWITCHED_OFF } from '../model/assumptions';
import type { ExportReport, Reading } from '../sources/chatgpt';
import { conversation, message, node, read } from '../sources/chatgpt/account/test-kit';
import type { Json } from '../sources/chatgpt/account/test-kit';
import { NO_USAGE_OTHER_CAUSES, PROMPT, SHORT_DATA_USUAL_CAUSE } from '../sources/claude-code';
import { answerNotes, exportNotes, modelNotes, modelRows, problemMessage, readingStatus } from './derive-data';
import { methodNotes } from './derive-method';
import { setCount, summary } from './derive-result';
import {
  ANSWER_A,
  TODAY,
  answer,
  bannedIn,
  chose,
  exampleReading,
  flaws,
  paste,
  progress,
  readIn,
  report,
  sentences,
  setTo,
  shownFor,
  stateAfter,
  texts,
  toggle,
} from './test-kit';
import type { ExportProblem } from './usage';
import { mass } from '../format';
import * as words from './words';

const at = (day: string, clock = '12:00:00'): number => Date.parse(`${day}T${clock}Z`) / 1000;
const NOW = at(TODAY);

/** One question and one answer in a conversation of its own. One word is one token. */
const turn = (id: string, time: number, model: string | null, question = 10, reply = 20): Json =>
  conversation(
    [node('q', 'root', message('user', question, { time })), node('a', 'q', message('assistant', reply, model === null ? { time: time + 30 } : { time: time + 30, model }))],
    { id, update_time: time + 30, ...(model === null ? { default_model_slug: null } : {}) },
  );

const claude = (text: string, today = TODAY, ...more: ReturnType<typeof toggle>[]): ReturnType<typeof shownFor> => shownFor(stateAfter([chose('claude-code'), paste(text, today), ...more]));
const chatgpt = (reading: Reading, files: ExportReport = report(), ...more: ReturnType<typeof toggle>[]): ReturnType<typeof shownFor> =>
  shownFor(stateAfter([chose('chatgpt'), ...readIn(reading, files), ...more]));

function ok(status: SourceStatus): Extract<SourceStatus, { state: 'ok' }> {
  if (status.state !== 'ok') throw new Error(`the status is ${status.state}`);
  return status;
}
const claudeStatus = (view: View): Extract<SourceStatus, { state: 'ok' }> => ok(view.data.claudeCode.status);
const chatgptStatus = (view: View): Extract<SourceStatus, { state: 'ok' }> => ok(view.data.chatgpt.status);

// ---------- your data: Claude Code ----------

describe('the status of a pasted answer', () => {
  it('always carries the prompt and what is in the box', () => {
    const { view } = claude(ANSWER_A);
    expect(view.data.claudeCode.prompt).toBe(PROMPT);
    expect(view.data.claudeCode.answer).toBe(ANSWER_A);
    expect(view.data.chatgpt.status).toEqual({ state: 'waiting' });
    expect(shownFor(stateAfter([])).view.data.claudeCode).toEqual({ prompt: PROMPT, answer: '', status: { state: 'waiting' } });
  });

  it('names the models, the tokens and the window, and says that the numbers add up', () => {
    const status = claudeStatus(claude(ANSWER_A).view);
    expect(status.headline).toBe('3 models · 781 million tokens · 8 Sep – 7 Oct');
    expect(status.confirmation).toBe('The numbers add up and look plausible.');
    expect(status.notes).toEqual([]);
    expect(claudeStatus(claude(answer([{ model: 'claude-opus-5-5', out: 12400 }])).view).headline).toBe('1 model · 12,400 tokens · 8 Sep – 7 Oct');
  });

  it('waits while the box is empty, and shows the reader\'s own message for a refused answer', () => {
    expect(claude('  ').view.data.claudeCode.status).toEqual({ state: 'waiting' });
    expect(claude('  ').view.stage).toBe('steps');
    const refused = claude('Here is your usage for the last 30 days.').view;
    expect(refused.stage).toBe('problem');
    expect(refused.data.claudeCode.status).toEqual({
      state: 'problem',
      message: "This doesn't look like the answer. It should start with a line that begins “ai-co2 v1”. Copy the whole block from Claude Code and paste it again.",
    });
    expect(refused.result).toBeNull();
  });

  it('adds the other causes when the script ran and found nothing', () => {
    const none = claude('ai-co2 v1 | 2026-09-08 to 2026-10-07 | data none\ntotal | 0').view;
    expect(none.data.claudeCode.status).toEqual({
      state: 'problem',
      message: `Claude Code found no use in the last 30 days on this computer. If you use Claude Code on another computer, run the prompt there. ${NO_USAGE_OTHER_CAUSES}`,
    });
  });

  it('says when the logs start late, with the page\'s own dates and the usual cause right after', () => {
    const late = claude(answer([{ model: 'claude-opus-5-5', in: 5, out: 5000 }], { first: '2026-09-26' })).view;
    expect(claudeStatus(late).notes).toEqual([
      'The first use found in these 30 days was on 26 Sep. The result covers 12 days (26 Sep – 7 Oct), not a full 30. If you used Claude Code on this computer earlier in these 30 days, those logs are no longer here.',
      SHORT_DATA_USUAL_CAUSE,
    ]);
    const oneDay = claude(answer([{ model: 'claude-opus-5-5', in: 5, out: 5000 }], { first: '2026-10-07' })).view;
    expect(claudeStatus(oneDay).notes[0]).toBe('The first use found in these 30 days was on 7 Oct. The result covers one day (7 Oct), not a full 30. If you used Claude Code on this computer earlier in these 30 days, those logs are no longer here.');
  });

  it('puts the short-data note before the old-answer note, whatever order the reader has them in', () => {
    const shown = claude(answer([{ model: 'claude-opus-5-5', in: 5, out: 5000 }], { first: '2026-09-13' }), '2026-10-17');
    expect(claudeStatus(shown.view).notes).toEqual([
      'The first use found in these 30 days was on 13 Sep. The result covers 25 days (13 Sep – 7 Oct), not a full 30. If you used Claude Code on this computer earlier in these 30 days, those logs are no longer here.',
      SHORT_DATA_USUAL_CAUSE,
      "This answer ends on 7 Oct 2026. Run the prompt again if you want today's numbers.",
    ]);
    const reading = shown.state.answer.reading;
    if (reading.state !== 'ok' || !shown.counted) throw new Error('not accepted');
    const turned = { ...reading, notes: [...reading.notes].reverse() };
    expect(answerNotes(turned, shown.counted)).toEqual(claudeStatus(shown.view).notes);
  });

  it('passes on the reader\'s own remark about a model with output and no input', () => {
    const notes = claudeStatus(claude(answer([{ model: 'claude-opus-5-5', out: 5000 }])).view).notes;
    expect(notes).toEqual(['The model “claude-opus-5-5” shows output but no input, which the logs of some gateways cause. The page will use it as it is.']);
  });
});

describe('models the page cannot place, Claude Code', () => {
  it('says what it did with a name it does not know, with that row\'s share of the tokens', () => {
    const { view } = claude(answer([{ model: 'claude-opus-5-5', in: 880, out: 0 }, { model: 'my-local-model', in: 120 }]));
    expect(claudeStatus(view).notes).toEqual([
      "We don't know the model “my-local-model”. It makes up 12% of your tokens. We counted it with our widest range, from a small model to a large one. That makes your range wider.",
    ]);
  });

  it('does not say "that makes your range wider" of a model that is under 1% of the tokens: it moves no printed number', () => {
    const alone = claude(answer([{ model: 'claude-opus-5-5', in: 99990, out: 5000 }])).view;
    const tiny = claude(answer([{ model: 'claude-opus-5-5', in: 99990, out: 5000 }, { model: 'my-local-model', in: 10 }])).view;
    expect(claudeStatus(tiny).notes).toEqual([
      "We don't know the model “my-local-model”. It makes up <1% of your tokens. We counted it with our widest range, from a small model to a large one.",
    ]);
    // The sentence is left out because it would be untrue here: the printed range is the one without that model.
    expect(tiny.result && [mass(tiny.result.range.p5, tiny.result.unit), mass(tiny.result.range.p95, tiny.result.unit)])
      .toEqual(alone.result && [mass(alone.result.range.p5, alone.result.unit), mass(alone.result.range.p95, alone.result.unit)]);
    // From 1% the sentence is back.
    const one = claude(answer([{ model: 'claude-opus-5-5', in: 990 }, { model: 'my-local-model', in: 10 }])).view;
    expect(claudeStatus(one).notes[0]).toContain('It makes up 1% of your tokens.');
    expect(claudeStatus(one).notes[0]?.endsWith('That makes your range wider.')).toBe(true);
  });

  it('calls the script\'s row "unknown" what it is: steps that name no model, not a model of that name', () => {
    const small = claude(answer([{ model: 'claude-opus-5-5', in: 99990 }, { model: 'unknown', in: 10 }])).view;
    expect(claudeStatus(small).notes).toEqual([
      'Some steps in your logs name no model. They make up <1% of your tokens. We counted them with our widest range, from a small model to a large one.',
    ]);
    expect(claudeStatus(small).models.map((row) => row.name)).toEqual(['Opus 5.5', '(no model name)']);
    const more = claude(answer([{ model: 'claude-opus-5-5', in: 880 }, { model: 'unknown', in: 120 }])).view;
    expect(claudeStatus(more).notes).toEqual([
      'Some steps in your logs name no model. They make up 12% of your tokens. We counted them with our widest range, from a small model to a large one. That makes your range wider.',
    ]);
    expect(sentences(more).some((text) => text.includes('“unknown”'))).toBe(false);
    // A name that only holds the word is a name.
    const named = claude(answer([{ model: 'claude-opus-5-5', in: 880 }, { model: 'unknown-model-7', in: 120 }])).view;
    expect(claudeStatus(named).notes[0]).toContain("We don't know the model “unknown-model-7”.");
  });

  it('warns first when more than half of the tokens are on such models', () => {
    const { view } = claude(answer([{ model: 'claude-opus-5-5', in: 400, out: 5 }, { model: 'my-local-model', in: 600, out: 5 }], { first: '2026-09-26' }));
    const notes = claudeStatus(view).notes;
    expect(notes[0]).toBe("More than half of your tokens come from models we don't know. Treat this range as a rough guide.");
    expect(notes[1]).toContain('The first use found in these 30 days was on 26 Sep.');
    expect(notes.at(-1)).toContain("We don't know the model “my-local-model”. It makes up 60% of your tokens.");
    // Exactly half is not more than half.
    const half = claude(answer([{ model: 'claude-opus-5-5', in: 500 }, { model: 'my-local-model', in: 500 }])).view;
    expect(claudeStatus(half).notes.some((note) => note.startsWith('More than half'))).toBe(false);
  });

  it('says that the logs name a model line and not the model', () => {
    const { view } = claude(answer([{ model: 'gpt-5-6', in: 10, out: 10 }, { model: 'gpt-6', in: 10, out: 10 }]));
    const notes = claudeStatus(view).notes;
    expect(notes).toContain('Your logs say “GPT-5.6” but not which GPT-5.6 model answered. We counted it with our widest range, from a small model to a large one.');
    expect(notes).toContain('Your logs say “GPT-6” but not which GPT-6 model answered. We counted it with our widest range, from a small model to a large one.');
  });

  it('says nothing about a row without tokens', () => {
    const { view } = claude(answer([{ model: 'claude-opus-5-5', in: 10, out: 10 }, { model: 'my-local-model' }]));
    expect(claudeStatus(view).notes.join(' ')).not.toContain('my-local-model');
  });
});

describe('the model table', () => {
  it('has one row per friendly name and size, biggest share first, with the tokens added up', () => {
    const shown = claude(answer([
      { model: 'claude-haiku-4-5', out: 1000 },
      { model: 'claude-opus-5-5', out: 300 },
      { model: 'us.anthropic.claude-opus-5-5', out: 200 },
    ]));
    const rows = claudeStatus(shown.view).models;
    expect(rows.map((row) => [row.name, row.tokens])).toEqual([['Opus 5.5', 500], ['Haiku 4.5', 1000]]);
    expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 12);
    // The headline counts the rows the person sees.
    expect(claudeStatus(shown.view).headline).toBe('2 models · 1,500 tokens · 8 Sep – 7 Oct');
    if (!shown.counted || !shown.calc) throw new Error('no result');
    expect(modelRows(shown.counted, shown.calc.shown.shares.models)).toEqual(rows);
  });

  it('keeps two rows with one name apart when they are counted as different sizes', () => {
    const reading = read([turn('a', at('2026-10-01'), 'gpt-5.6', 10, 50), turn('b', at('2026-10-02'), 'gpt-5-6', 10, 20)], { now: NOW });
    const free = chatgpt({ ...reading, plusUser: false });
    expect(chatgptStatus(free.view).models.map((row) => [row.name, row.tokens])).toEqual([
      ['GPT-5.6 (counted as large)', 60],
      ['GPT-5.6 (counted as small)', 30],
    ]);
    // On Plus both names are the large model, and one row is enough.
    const paid = chatgpt({ ...reading, plusUser: true });
    expect(chatgptStatus(paid.view).models.map((row) => [row.name, row.tokens])).toEqual([['GPT-5.6', 90]]);
    expect(chatgptStatus(paid.view).models[0]?.share).toBeCloseTo(1, 12);
  });
});

// ---------- your data: ChatGPT ----------

describe('the status while an export is read', () => {
  it('reads 0 conversations before the worker has reported', () => {
    expect(readingStatus(null)).toEqual({ state: 'reading', done: 0, total: null, text: 'Reading your export in this tab: 0 conversations so far. Large exports can take a minute.' });
  });

  it('counts bytes, and conversations in the sentence', () => {
    expect(readingStatus(progress({ bytesRead: 250, bytesTotal: 1000, conversations: 1 }))).toEqual({
      state: 'reading', done: 250, total: 1000, text: 'Reading your export in this tab: 1 conversation so far. Large exports can take a minute.',
    });
    expect(readingStatus(progress({ bytesRead: 5000, bytesTotal: null, conversations: 1284 }))).toEqual({
      state: 'reading', done: 5000, total: null, text: 'Reading your export in this tab: 1,284 conversations so far. Large exports can take a minute.',
    });
  });

  it('never fills the bar: the last step belongs to the finished result', () => {
    const full = readingStatus(progress({ bytesRead: 1000, bytesTotal: 1000, conversations: 3 }));
    expect(full).toMatchObject({ done: 990, total: 1000 });
    expect(readingStatus(progress({ bytesRead: 2500, bytesTotal: 1000 }))).toMatchObject({ done: 990, total: 1000 });
  });

  it('shows nothing that is no number for a report that is none', () => {
    const odd = readingStatus(progress({ bytesRead: Number.NaN, bytesTotal: Number.NaN, conversations: -3 }));
    expect(odd).toEqual({ state: 'reading', done: 0, total: null, text: 'Reading your export in this tab: 0 conversations so far. Large exports can take a minute.' });
    expect(readingStatus(progress({ bytesRead: 10, bytesTotal: 0 }))).toMatchObject({ done: 10, total: null });
  });
});

describe('an export with no result', () => {
  const MESSAGES: Array<[ExportProblem, string]> = [
    [{ code: 'E1' }, 'None of these files is a ChatGPT export. Drop the ZIP file you downloaded from OpenAI, or the conversations.json files from inside it.'],
    [{ code: 'E2' }, 'That is more than 20 ZIP files. Drop the export ZIP on its own, or only the conversations files from inside it.'],
    [{ code: 'E3' }, "This ZIP isn't a ChatGPT export: it has no conversations file. Download the export from OpenAI's message again, and drop that file."],
    [{ code: 'E4' }, "This ZIP can't be opened, and no conversations could be read from it. The download may be cut off. Download it again, or unzip it on your computer and drop the conversations files."],
    [{ code: 'E5', name: 'notes.json' }, '“notes.json” is not a conversations file from a ChatGPT export. Drop the export ZIP as you downloaded it.'],
    [{ code: 'E6' }, 'This file is larger or more tightly packed than any real export, so the page stopped reading it. If it is a real export, unzip it on your computer and drop only the conversations files.'],
    [{ code: 'E7' }, 'This export holds no conversations.'],
    [{ code: 'E8', newest: '2026-07-01' }, 'This export has no ChatGPT answers in the last 30 days. Its newest message is from 1 Jul 2026. Ask ChatGPT for a new export, then drop it here.'],
    [{ code: 'E8', newest: null }, 'This export has no ChatGPT answers in the last 30 days. Ask ChatGPT for a new export, then drop it here.'],
    [{ code: 'E9' }, 'The page could not finish reading this export. Close other tabs and try again, or unzip it on your computer and drop only the conversations files.'],
  ];

  it.each(MESSAGES)('%j has its exact message', (problem, message) => {
    expect(problemMessage(problem)).toBe(message);
  });

  it('shows the message as the status, with the stage "problem" and no result', () => {
    const old = read([turn('a', at('2026-07-01'), 'gpt-5-5')], { now: NOW });
    const { view } = chatgpt(old);
    expect(view.stage).toBe('problem');
    expect(view.data.chatgpt.status).toEqual({ state: 'problem', message: MESSAGES[7]?.[1] });
    expect(view.result).toBeNull();
    expect(view.contribute).toBeNull();
    expect(view.tips).toEqual([]);
    expect(view.noTipsNote).toBeNull();
  });
});

describe('the status of an export that was read', () => {
  it('counts every conversation of the export, the answers of the 30 days, and names the newest message', () => {
    const status = chatgptStatus(chatgpt(exampleReading('current')).view);
    expect(status.headline).toBe('3 conversations · 6 answers in the last 30 days · newest message 2 Oct');
    expect(status.confirmation).toBe('Your export was read in this tab.');
    const one = read([turn('a', at('2026-10-05'), 'gpt-5-5')], { now: NOW });
    expect(chatgptStatus(chatgpt(one).view).headline).toBe('1 conversation · 1 answer in the last 30 days · newest message 5 Oct');
    expect(chatgptStatus(chatgpt({ ...one, lastMessage: null }).view).headline).toBe('1 conversation · 1 answer in the last 30 days');
  });

  it('counts tokens without the hidden work, and shares with it', () => {
    const shown = chatgpt(read([turn('a', at('2026-10-05'), 'gpt-5-5', 10, 20), turn('b', at('2026-10-06'), 'gpt-5-5-mini', 30, 40)], { now: NOW }));
    const rows = chatgptStatus(shown.view).models;
    expect(rows.map((row) => [row.name, row.tokens])).toEqual([['GPT-5.5', 30], ['GPT-5.5 mini', 70]]);
    expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 12);
  });

  const quiet = read([turn('a', at('2026-10-05'), 'gpt-5-5')], { now: NOW });
  const notesOf = (reading: Reading, files: ExportReport = report()): string[] => chatgptStatus(chatgpt(reading, files).view).notes;
  const NO_THINKING = 'No thinking was found in your export for the last 30 days.';
  const NO_SEARCH = 'No web searches and no files without a size were found in your export for the last 30 days.';

  it('N7 and N8: says why a switch is missing', () => {
    expect(notesOf(quiet)).toEqual([NO_THINKING, NO_SEARCH]);
    const shown = chatgpt(quiet);
    expect(shown.view.result?.switches.items.map((item) => item.id)).toEqual(['instructions-memory', 'plan-paid']);
    // The example export has thinking and a web search in its 30 days.
    const example = notesOf(exampleReading('current'));
    expect(example).not.toContain(NO_THINKING);
    expect(example).not.toContain(NO_SEARCH);
  });

  it('N1: says when the newest message is more than a week old', () => {
    const old = read([turn('a', at('2026-09-20'), 'gpt-5-5')], { now: NOW });
    expect(notesOf(old)[0]).toBe(
      "The newest message in this export is from 20 Sep 2026. The 30 days are counted back from today, so newer use is missing. Ask ChatGPT for a new export if you want today's numbers.",
    );
    // Seven days are not more than seven.
    const week = read([turn('a', at('2026-09-30'), 'gpt-5-5')], { now: NOW });
    expect(notesOf(week)).toEqual([NO_THINKING, NO_SEARCH]);
  });

  it('N2: a ZIP that was read from its start', () => {
    const rescued = (conversations: number): ExportReport => report({ notices: [{ code: 'rescued', path: ['export.zip'], files: 1, conversations }] });
    expect(notesOf(quiet, rescued(412))[0]).toBe(
      'This ZIP is damaged at its end, so the page read it from the start and found 412 conversations. Some may be missing. Download the export again for a complete count.',
    );
    expect(notesOf(quiet, rescued(1))[0]).toContain('and found 1 conversation. Some may be missing.');
  });

  it('N3: a file that stops in the middle, by its name cut short, three at most', () => {
    const file = (name: string, problem: 'cut-off' | 'not-json' | 'damaged', handed: number): ExportReport['files'][number] =>
      ({ path: ['export.zip', name], bytes: 10, handed, skipped: 0, problem });
    const long = `${'c'.repeat(70)}.json`;
    const files = report({
      files: [file('conversations-001.json', 'cut-off', 4), file('conversations-002.json', 'damaged', 0), file(long, 'not-json', 1), file('conversations-004.json', 'damaged', 2), file('conversations-005.json', 'cut-off', 9)],
      notices: [{ code: 'ends-early', path: ['outer.zip', 'inner.zip'] }],
    });
    expect(notesOf(quiet, files).slice(0, 3)).toEqual([
      'The file “conversations-001.json” stops in the middle. The conversations before the break were read. Your result may be missing use.',
      `The file “${'c'.repeat(60)}” stops in the middle. The conversations before the break were read. Your result may be missing use.`,
      'The file “conversations-004.json” stops in the middle. The conversations before the break were read. Your result may be missing use.',
    ]);
    expect(notesOf(quiet, files).filter((note) => note.startsWith('The file “'))).toHaveLength(3);
    expect(notesOf(quiet, report({ notices: [{ code: 'ends-early', path: ['outer.zip', 'inner.zip'] }] }))[0]).toContain('The file “inner.zip” stops in the middle.');
  });

  it('N4 to N6: copies, skipped entries and ignored files, with a count', () => {
    const warned: Reading = {
      ...quiet,
      warnings: [
        { code: 'duplicate-conversation', count: 3 },
        { code: 'not-a-conversation', count: 1 },
        { code: 'conversation-too-large', count: 1 },
        { code: 'conversation-failed', count: 2 },
        { code: 'unknown-content-type', count: 50 },
      ],
    };
    const files = report({ notices: [{ code: 'ignored', path: ['photo.jpg'] }, { code: 'encrypted', path: ['x.zip', 'conversations.json'] }, { code: 'same-name', path: ['y'] }] });
    expect(notesOf(warned, files)).toEqual([
      '3 conversations were in more than one file. The newer copy was used.',
      '4 entries in the conversations files could not be read and were skipped.',
      '2 files were not conversations files and were ignored.',
      NO_THINKING,
      NO_SEARCH,
    ]);
    const once: Reading = { ...quiet, warnings: [{ code: 'duplicate-conversation', count: 1 }, { code: 'conversation-failed', count: 1 }] };
    expect(notesOf(once, report({ notices: [{ code: 'ignored', path: ['photo.jpg'] }] }))).toEqual([
      '1 conversation was in more than one file. The newer copy was used.',
      '1 entry in the conversations files could not be read and was skipped.',
      '1 file was not a conversations file and was ignored.',
      NO_THINKING,
      NO_SEARCH,
    ]);
  });

  it('N9 and N10: voice chats and images', () => {
    const shown = chatgpt(quiet);
    if (!shown.counted?.totals || shown.state.export.phase !== 'done') throw new Error('no result');
    const counted = { ...shown.counted, totals: { ...shown.counted.totals, transcripts: 2, images: 1 } };
    expect(exportNotes(shown.state.export.reading, shown.state.export.report, counted, TODAY).slice(-2)).toEqual([
      'Voice chats are counted by their transcript only, so they are counted low.',
      "Images you sent are counted with OpenAI's published rule for developers. ChatGPT's own setting is not published; a large photo may have cost up to five times more.",
    ]);
  });
});

describe('models the page cannot place, ChatGPT', () => {
  const planNote = (size: string, reason: string): string =>
    `Your export says “GPT-5.6” but not which GPT-5.6 model answered. We counted it as a ${size} model, because ${reason}. Change the plan switch in your result if that is wrong.`;
  const lastNote = (shown: ReturnType<typeof chatgpt>): string | undefined => chatgptStatus(shown.view).notes.at(-1);

  it('says what it took "gpt-5-6" for, and why: the five places the plan switch can stand in', () => {
    expect(lastNote(chatgpt(exampleReading('current', true)))).toBe(planNote('large', 'your export says this account has ChatGPT Plus'));
    expect(lastNote(chatgpt(exampleReading('current', false)))).toBe(planNote('small', 'your export says this account does not have ChatGPT Plus'));
    expect(lastNote(chatgpt(exampleReading('current', null)))).toBe(planNote('large', 'your files did not say, and we assumed Plus or Pro'));
    expect(lastNote(chatgpt(exampleReading('current', false), report(), toggle('plan-paid')))).toBe(planNote('large', 'you chose Plus or Pro'));
    expect(lastNote(chatgpt(exampleReading('current', true), report(), toggle('plan-paid')))).toBe(planNote('small', 'you chose Free or Go'));
    expect(lastNote(chatgpt(exampleReading('current', null), report(), toggle('plan-paid')))).toBe(planNote('small', 'you chose Free or Go'));
  });

  it('says that a name such as "gpt-6" does not tell which model answered', () => {
    const notes = chatgptStatus(chatgpt(read([turn('a', at('2026-10-05'), 'gpt-6')], { now: NOW })).view).notes;
    expect(notes.at(-1)).toBe('Your export says “GPT-6” but not which model answered. We counted these answers with our widest range, from a small model to a large one.');
    expect(notes[0]).toBe("More than half of your tokens come from models we don't know. Treat this range as a rough guide.");
  });

  it('counts the runs for which the export names no model, in one sentence', () => {
    const big = turn('big', at('2026-10-03'), 'gpt-5-5', 500, 500);
    const one = chatgptStatus(chatgpt(read([big, turn('n', at('2026-10-05'), null)], { now: NOW })).view).notes;
    expect(one.at(-1)).toBe("Your export names no model for 1 of ChatGPT's runs. We counted it with our widest range.");
    const three = chatgptStatus(chatgpt(read([big, turn('n', at('2026-10-05'), null), turn('m', at('2026-10-06'), null), turn('auto', at('2026-10-06'), 'auto')], { now: NOW })).view).notes;
    expect(three.filter((note) => note.startsWith('Your export names no model'))).toEqual(["Your export names no model for 3 of ChatGPT's runs. We counted them with our widest range."]);
  });

  it('shows those runs as one row, named as the remark names them, and never as a model called "Auto"', () => {
    const big = turn('big', at('2026-10-03'), 'gpt-5-5', 500, 500);
    const shown = chatgpt(read([big, turn('n', at('2026-10-05'), null), turn('auto', at('2026-10-06'), 'auto')], { now: NOW }));
    expect(chatgptStatus(shown.view).models.map((row) => [row.name, row.tokens])).toEqual([['GPT-5.5', 1000], ['(no model name)', 60]]);
    expect(sentences(shown.view).some((text) => text === 'Auto')).toBe(false);
    expect(chatgptStatus(shown.view).models.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 12);
  });

  it('shows a name it does not know as text, at most 60 characters of it', () => {
    const long = `acme-${'z'.repeat(59)}`;
    const shown = chatgpt(read([turn('big', at('2026-10-03'), 'gpt-5-5', 500, 400), turn('a', at('2026-10-05'), long, 50, 50)], { now: NOW }));
    expect(chatgptStatus(shown.view).notes.at(-1)).toBe(
      `We don't know the model “${long.slice(0, 60)}”. It makes up 10% of your tokens. We counted it with our widest range, from a small model to a large one. That makes your range wider.`,
    );
    expect(chatgptStatus(shown.view).models.map((row) => row.name)).toContain(long.slice(0, 60));
  });

  it('puts these sentences in the order of the model table', () => {
    const shown = chatgpt(read([turn('small', at('2026-10-03'), 'acme-one', 5, 5), turn('large', at('2026-10-04'), 'acme-two', 500, 500)], { now: NOW }));
    if (!shown.counted || !shown.calc) throw new Error('no result');
    const inTable = modelNotes(shown.counted, shown.state, shown.calc.shown.shares.models).rest;
    expect(inTable.map((note) => /“(.*)”/.exec(note)?.[1])).toEqual(['acme-two', 'acme-one']);
    expect(chatgptStatus(shown.view).notes.slice(-2)).toEqual(inTable);
    // Without the shares the sentences follow the rows of the source.
    expect(modelNotes(shown.counted, shown.state).rest).toHaveLength(2);
  });
});

// ---------- your result ----------

describe('the line under the range', () => {
  const summaryOf = (shown: ReturnType<typeof shownFor>): string | undefined => shown.view.result?.summary;

  it('says "the last 30 days" for an answer of today or yesterday', () => {
    expect(summaryOf(claude(ANSWER_A))).toBe('Likely CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct)');
    expect(summaryOf(claude(ANSWER_A, '2026-10-08'))).toBe('Likely CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct)');
  });

  it('names the 30 days of an older answer', () => {
    expect(summaryOf(claude(ANSWER_A, '2026-10-09'))).toBe('Likely CO₂e from Claude Code in the 30 days from 8 Sep to 7 Oct');
    expect(summaryOf(claude(ANSWER_A, '2027-02-01'))).toBe('Likely CO₂e from Claude Code in the 30 days from 8 Sep to 7 Oct');
  });

  it('names the days the logs cover when they are fewer than 28', () => {
    expect(summaryOf(claude(answer([{ model: 'claude-opus-5-5', in: 5, out: 5000 }], { first: '2026-09-26' })))).toBe(
      'Likely CO₂e from Claude Code in the 12 days from your first use (26 Sep – 7 Oct)',
    );
    expect(summaryOf(claude(answer([{ model: 'claude-opus-5-5', in: 5, out: 5000 }], { first: '2026-10-07' })))).toBe(
      'Likely CO₂e from Claude Code on the one day with use (7 Oct)',
    );
  });

  it('does the same for an export', () => {
    const full = read([turn('a', at('2026-08-01'), 'gpt-5-5'), turn('b', at('2026-10-07', '08:00:00'), 'gpt-5-5')], { now: NOW });
    expect(summaryOf(chatgpt(full))).toBe('Likely CO₂e from ChatGPT in the last 30 days (8 Sep – 7 Oct)');
    expect(summaryOf(chatgpt(exampleReading('current')))).toBe('Likely CO₂e from ChatGPT in the 25 days up to your newest message (8 Sep – 2 Oct)');
    const oneDay = read([turn('b', at('2026-10-05'), 'gpt-5-5')], { now: NOW });
    expect(summaryOf(chatgpt(oneDay))).toBe('Likely CO₂e from ChatGPT on the one day with messages (5 Oct)');
  });

  it('names an export by its oldest and its newest message, whichever of the two cuts the 30 days short', () => {
    // The page knows the messages. It does not know when the export was made, so it never says what the export "covers".
    const startsLate = read([turn('a', at('2026-09-20'), 'gpt-5-5'), turn('b', at('2026-10-07', '08:00:00'), 'gpt-5-5')], { now: NOW });
    expect(summaryOf(chatgpt(startsLate))).toBe('Likely CO₂e from ChatGPT in the 18 days from your oldest message (20 Sep – 7 Oct)');
    const both = read([turn('a', at('2026-09-20'), 'gpt-5-5'), turn('b', at('2026-10-02'), 'gpt-5-5')], { now: NOW });
    expect(summaryOf(chatgpt(both))).toBe('Likely CO₂e from ChatGPT in the 13 days from your oldest to your newest message (20 Sep – 2 Oct)');
    const endsEarly = read([turn('a', at('2026-08-01'), 'gpt-5-5'), turn('b', at('2026-10-02'), 'gpt-5-5')], { now: NOW });
    expect(summaryOf(chatgpt(endsEarly))).toBe('Likely CO₂e from ChatGPT in the 25 days up to your newest message (8 Sep – 2 Oct)');
    for (const reading of [startsLate, both, endsEarly]) {
      expect(sentences(chatgpt(reading).view).some((text) => /export covers|logs cover/.test(text))).toBe(false);
    }
  });

  it('drops "Likely" and says why there is no range when there is one outcome', () => {
    const shown = claude(ANSWER_A);
    if (!shown.counted) throw new Error('no result');
    expect(summary(shown.counted, true, TODAY)).toBe('CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct), with every assumption that changes your result set by you');
    expect(summary(shown.counted, true, '2026-11-11')).toBe('CO₂e from Claude Code in the 30 days from 8 Sep to 7 Oct, with every assumption that changes your result set by you');
    const short = chatgpt(exampleReading('current'));
    if (!short.counted) throw new Error('no result');
    expect(summary(short.counted, true, TODAY)).toBe('CO₂e from ChatGPT in the 25 days up to your newest message (8 Sep – 2 Oct), with every assumption that changes your result set by you');
  });
});

describe('the result card', () => {
  it('names the tool and the 30 days', () => {
    const { view } = claude(ANSWER_A);
    expect(view.result).toMatchObject({ sourceName: 'Claude Code', period: { from: '2026-09-08', to: '2026-10-07' }, history: null, baseline: null, appliedLabel: null, setLabel: null });
    expect(chatgpt(exampleReading('current')).view.result).toMatchObject({ sourceName: 'ChatGPT', period: { from: '2026-09-08', to: '2026-10-07' } });
  });

  it('counts only the set sliders that can change the result', () => {
    const one = shownFor(stateAfter([chose('claude-code'), paste(ANSWER_A), setTo('grid', 400)]));
    expect(one.view.result?.setLabel).toBe('With 1 assumption set by you');
    const two = shownFor(stateAfter([chose('claude-code'), paste(ANSWER_A), setTo('grid', 400), setTo('pue', 1.1)]));
    expect(two.view.result?.setLabel).toBe('With 2 assumptions set by you');
    // This answer has no cache writes, so that slider changes nothing and is not counted.
    const inert = shownFor(stateAfter([chose('claude-code'), paste(answer([{ model: 'claude-opus-5-5', in: 50, out: 5000 }])), setTo('cacheWrite', 0.4)]));
    expect(inert.view.result?.setLabel).toBeNull();
    if (!inert.calc) throw new Error('no result');
    expect(setCount(inert.calc.shown)).toBe(0);
    expect(inert.view.method.assumptions.find((slider) => slider.id === 'cacheWrite')).toMatchObject({ pinned: true, note: NOTE_NO_EFFECT });
  });

  it('holds one switch per tip for Claude Code, in the order of the tips', () => {
    const { view } = claude(ANSWER_A);
    expect(view.result?.switches.title).toBe('Try a change');
    expect(view.result?.switches.note).toBe('Flip one to see what it changes. The details are under “Ways to cut”.');
    expect(view.result?.switches.items.map((item) => item.id)).toEqual(view.tips.map((tip) => tip.id));
    expect(view.result?.switches.items.every((item) => item.noteIcon === null && !item.on)).toBe(true);
  });

  it('holds the hidden-work switches and the plan switch for ChatGPT, and no tip', () => {
    const { view } = chatgpt(exampleReading('current', true));
    expect(view.result?.switches.title).toBe('Hidden work in ChatGPT');
    expect(view.result?.switches.items.map((item) => item.id)).toEqual(['thinking', 'instructions-memory', 'search-files', 'plan-paid']);
  });

  it('shows the whole history as a second range, since the month of the oldest request', () => {
    const { view, calc } = chatgpt(exampleReading('current', true));
    expect(view.result?.history?.since).toBe('July 2026');
    expect(view.result?.history?.range).toEqual(calc?.history);
    expect(view.result?.history?.range.p95).toBeGreaterThan(view.result?.range.p95 ?? Infinity);
  });
});

// ---------- how it's calculated ----------

describe('the method section before there is a result', () => {
  const FIXED = {
    formula: 'CO₂ = tokens × weight × energy per token × overhead × grid × hardware',
    sliderNote: 'Move a slider to set that assumption yourself: until you reset it, the page uses your value in every run instead of varying it between low and high.',
    extremeLabel: 'Extreme range (every low or every high assumption combined)',
    notes: [],
    extreme: null,
    unit: 'kg',
  };
  const ids = (view: View): string[] => view.method.assumptions.map((slider) => slider.id);
  const CLAUDE_SLIDERS = ['energy', 'freshInput', 'cacheWrite', 'cacheRead', 'pue', 'grid', 'hardware'];
  const CHATGPT_SLIDERS = ['energy', 'freshInput', 'cacheRead', 'pue', 'grid', 'hardware', 'hidden:thinking', 'hidden:prompt', 'hidden:personal', 'hidden:search', 'hidden:files', 'hidden:misses'];

  it('choose: the shared lists and the seven sliders of Claude Code', () => {
    const { view } = shownFor(stateAfter([]));
    expect(view.stage).toBe('choose');
    expect(view.method).toMatchObject(FIXED);
    expect(view.method.counted).toEqual(['Your tokens, by model and by type.', 'Data-centre overhead and the electricity grid.', 'Making the hardware, about 10–13% on top.']);
    expect(view.method.leftOut).toHaveLength(5);
    expect(view.method.leftOut[0]).toBe('Water. Published figures differ by more than ten times, so any number would mislead.');
    expect(ids(view)).toEqual(CLAUDE_SLIDERS);
    expect(view.method.assumptions[0]).toMatchObject({ label: ENERGY_ROWS.large.label, low: 0.5, typical: 1, high: 5.4, value: 1, pinned: false, note: null });
    expect(view.method.assumptions.every((slider) => slider.note === null && slider.parts === undefined)).toBe(true);
  });

  it('steps and problem, Claude Code: its own lists, the large row', () => {
    for (const events of [[chose('claude-code')], [chose('claude-code'), paste('not an answer')]]) {
      const { view } = shownFor(stateAfter(events));
      expect(view.method).toMatchObject(FIXED);
      expect(view.method.counted).toHaveLength(4);
      expect(view.method.counted[0]).toBe('Every token Claude Code logged on this computer in the 30 days, by model and type: fresh input, cache writes, cache reads and output. Thinking is part of output.');
      expect(view.method.leftOut).toHaveLength(7);
      expect(view.method.leftOut.at(-1)).toBe('Requests Claude Code makes in the background, where it does not log them.');
      expect(ids(view)).toEqual(CLAUDE_SLIDERS);
      expect(view.method.assumptions[0]?.label).toBe(ENERGY_ROWS.large.label);
    }
  });

  it('steps, loading and problem, ChatGPT: its own lists, the mid-size row and all six hidden-work sliders', () => {
    const old = read([turn('a', at('2026-07-01'), 'gpt-5-5')], { now: NOW });
    for (const events of [[chose('chatgpt')], [chose('chatgpt'), { type: 'read-started' } as const], [chose('chatgpt'), ...readIn(old)]]) {
      const { view } = shownFor(stateAfter(events));
      expect(view.result).toBeNull();
      expect(view.method).toMatchObject(FIXED);
      expect(view.method.counted).toHaveLength(5);
      expect(view.method.counted[2]).toBe('One more estimate has no switch: how often ChatGPT cannot reuse an earlier reading of the conversation. Its slider is below.');
      expect(view.method.leftOut).toHaveLength(10);
      expect(view.method.leftOut.at(-1)).toBe('About 1 web search in 10. Current exports do not show them.');
      expect(ids(view)).toEqual(CHATGPT_SLIDERS);
      expect(view.method.assumptions[0]).toMatchObject({ label: ENERGY_ROWS.medium.label, low: 0.2, typical: 0.6, high: 2.2 });
      expect(view.method.assumptions.every((slider) => slider.note === null && slider.parts === undefined)).toBe(true);
    }
  });

  it('shows a slider that was moved before the data is in as set, and keeps the "no slider set" words', () => {
    const { view } = shownFor(stateAfter([setTo('grid', 460), chose('chatgpt')]));
    expect(view.method.assumptions.find((slider) => slider.id === 'grid')).toMatchObject({ pinned: true, value: 460 });
    expect(view.method.extremeLabel).toBe(FIXED.extremeLabel);
  });
});

describe('the method section with a result', () => {
  it('fixture A: the sentences about this person\'s numbers, in their order', () => {
    const { view } = claude(ANSWER_A);
    expect(view.method.notes).toEqual([
      'What matters most for your result is “Energy to write 1,000 tokens, large models”. Set its slider to low and then to high: your middle estimate goes from 4.1 to 44 kg.',
      '“Matters most” is worked out like this: one assumption goes from its low to its high value while the others stay where they are. The assumption that moves your footprint by the most kilograms is named.',
      'With every assumption at its typical value, the formula gives 8.6 kg. The middle estimate is higher, 9.8 kg: 5,746 of the 10,000 results lie above that all-typical value.',
      'The least certain number in the list of assumptions below is “Re-reading a stored token, compared with writing one”: its high value is 100 times its low value.',
      "Counted with the clean power that Google and Microsoft buy, about 70 g per kWh, and with making the hardware counted as before, your range would be 1.1–9.6 kg, middle estimate 2.8 kg. The power their data centres draw is no cleaner than the local grid's, so this is shown only for comparison.",
      "A model's share is worked out with every assumption at its typical value, or at your value where you have set one.",
    ]);
    expect(view.method.extremeLabel).toBe('Extreme range (every low or every high assumption combined)');
    expect(view.method.unit).toBe('kg');
  });

  it('takes the "any slider set" form once a slider is set', () => {
    const { view } = shownFor(stateAfter([chose('claude-code'), paste(ANSWER_A), setTo('grid', 300)]));
    expect(view.method.notes[0]).toMatch(/^Of the assumptions you have not set, what matters most is “Energy to write 1,000 tokens, large models”\. Set its slider to low and then to high: your middle estimate goes from [\d.]+ to [\d.]+ kg\.$/);
    expect(view.method.notes[2]).toMatch(/^With every assumption you have not set at its typical value, the formula gives [\d.]+ kg\. The middle estimate is (higher|lower), [\d.]+ kg: [\d,]+ of the 10,000 results lie above that all-typical value\.$/);
    expect(view.method.extremeLabel).toBe('Extreme range (every assumption you have not set, at its low or at its high)');
    // With the energy slider set, the next assumption in line is named.
    const energySet = shownFor(stateAfter([chose('claude-code'), paste(ANSWER_A), setTo('energy', 1)])).view;
    expect(energySet.method.notes[0]).toContain('Of the assumptions you have not set, what matters most is “Re-reading a stored token, compared with writing one”.');
  });

  it('says in the label of the extreme range that tips are applied', () => {
    const one = claude(ANSWER_A, TODAY, toggle('cc-clear')).view;
    expect(one.method.extremeLabel).toBe('Extreme range (every low or every high assumption combined, with your tip applied)');
    const two = shownFor(stateAfter([chose('claude-code'), paste(ANSWER_A), toggle('cc-clear'), toggle('cc-effort'), setTo('grid', 300)])).view;
    expect(two.method.extremeLabel).toBe('Extreme range (every assumption you have not set, at its low or at its high, with your tips applied)');
  });

  it('adds the history sentence and the four fixed assumptions for ChatGPT', () => {
    const { view } = chatgpt(exampleReading('current', true));
    expect(view.method.notes.slice(-5)).toEqual([
      "The whole-history line uses today's energy and grid values for use from years ago. The hidden instructions are counted smaller for earlier years.",
      'We assume ChatGPT reuses its earlier reading when you reply within 30 minutes. OpenAI documents this for its developer service, not for ChatGPT.',
      'We assume ChatGPT keeps at most about 34,000 tokens of earlier conversation for instant models and 236,000 for thinking models on Plus or Pro, and 7,000 on Free or Go. OpenAI publishes the total window, not this share.',
      "We count each image you sent with OpenAI's published rule for developers at its 'high' setting. ChatGPT's own setting is not published; a large photo may have cost up to five times more.",
      'We count the hidden instructions as text ChatGPT can reuse, even on the first message of a chat. If it reads them afresh at the start of every chat, this part is several times larger.',
    ]);
  });

  it('gives Fable its sentence when it is used and another size leads the slider', () => {
    // The slider's own sentence for Fable, then its range: the price fact is worded in one place.
    const FABLE = `${ENERGY_ROWS.fable.explanation} Its energy runs from 0.5 to 10.8 Wh per 1,000 tokens.`;
    expect(FABLE.startsWith('Fable is treated as a large model with a higher top end, because it costs ')).toBe(true);
    const part = claude(answer([{ model: 'claude-opus-5-5', in: 10, out: 9000 }, { model: 'claude-fable-5-1', in: 10, out: 100 }]));
    expect(part.calc?.lead).toBe('large');
    expect(part.view.method.notes).toContain(FABLE);
    expect(part.view.method.assumptions[0]?.parts?.map((entry) => entry.label)).toEqual(['large', 'Fable']);
    // When Fable leads, the slider itself shows the sentence.
    const lead = claude(answer([{ model: 'claude-opus-5-5', in: 10, out: 100 }, { model: 'claude-fable-5-1', in: 10, out: 9000 }]));
    expect(lead.calc?.lead).toBe('fable');
    expect(lead.view.method.notes).not.toContain(FABLE);
    expect(lead.view.method.assumptions[0]).toMatchObject({ explanation: ENERGY_ROWS.fable.explanation, high: 10.8 });
    // A tie goes to Fable: the same tokens give the same kilograms at typical values.
    expect(claude(answer([{ model: 'claude-opus-5-5', out: 500 }, { model: 'claude-fable-5-1', out: 500 }])).calc?.lead).toBe('fable');
  });

  it('gives the models it cannot place their sentence, and names their energy as just as uncertain', () => {
    const UNKNOWN = 'We could not tell how big some of your models are, so their energy runs from the low end of small models to the high end of large ones: 0.05 to 5.4 Wh per 1,000 tokens.';
    const WITH_UNKNOWN = "Among the numbers that apply to everyone, the least certain is “Re-reading a stored token, compared with writing one”: its high value is 100 times its low value. The energy of the models we don't know is as uncertain: its high value is 108 times its low value.";
    const part = claude(answer([{ model: 'claude-opus-5-5', in: 10, out: 9000 }, { model: 'my-local-model', in: 10, out: 100 }]));
    expect(part.view.method.notes).toContain(UNKNOWN);
    expect(part.view.method.notes).toContain(WITH_UNKNOWN);
    const lead = claude(answer([{ model: 'my-local-model', in: 10, out: 100 }]));
    expect(lead.calc?.lead).toBe('unknown');
    expect(lead.view.method.notes).not.toContain(UNKNOWN);
    expect(lead.view.method.notes).toContain(WITH_UNKNOWN);
    expect(lead.view.method.assumptions[0]).toMatchObject({ low: 0.05, typical: 0.6, high: 5.4, soft: true });
  });

  it('shows one energy part per size in use, the lead first, and none for one size', () => {
    expect(claude(ANSWER_A).view.method.assumptions[0]?.parts?.map((entry) => entry.label)).toEqual(['large', 'mid-size', 'small']);
    expect(claude(answer([{ model: 'claude-haiku-4-5', in: 5, out: 100 }])).view.method.assumptions[0]).toMatchObject({ label: ENERGY_ROWS.small.label, low: 0.05, high: 0.4 });
    expect(claude(answer([{ model: 'claude-haiku-4-5', in: 5, out: 100 }])).view.method.assumptions[0]?.parts).toBeUndefined();
  });

  it('marks the slider of a piece that is switched off, and leaves out the slider of a piece with nothing to count', () => {
    const on = chatgpt(exampleReading('current', true)).view;
    // No file without a size lies in the 30 days of the example.
    expect(on.method.assumptions.map((slider) => slider.id)).not.toContain('hidden:files');
    expect(on.method.assumptions.find((slider) => slider.id === 'hidden:thinking')?.note).toBeNull();
    const off = chatgpt(exampleReading('current', true), report(), toggle('thinking')).view;
    expect(off.method.assumptions.find((slider) => slider.id === 'hidden:thinking')?.note).toBe(NOTE_SWITCHED_OFF);
    expect(off.method.assumptions.find((slider) => slider.id === 'hidden:prompt')?.note).toBeNull();
  });

  it('has no extreme range and no "matters most" when there is one outcome', () => {
    const all = shownFor(stateAfter([chose('claude-code'), paste(ANSWER_A), ...['energy', 'freshInput', 'cacheWrite', 'cacheRead', 'pue', 'grid', 'hardware'].map((id) => setTo(id, -1))]));
    expect(all.view.result?.single).toBe(true);
    expect(all.view.method.extreme).toBeNull();
    expect(all.view.method.notes.some((note) => note.includes('matters most') || note.includes('Matters most'))).toBe(false);
    expect(all.view.method.notes.some((note) => note.includes('all-typical'))).toBe(false);
    expect(all.view.method.notes[1]).toMatch(/^Counted with the clean power that Google and Microsoft buy, about 70 g per kWh, and with making the hardware counted as before, your result would be about [\d.]+ (kg|g)\. The power their data centres draw is no cleaner than the local grid's, so this is shown only for comparison\.$/);
    if (!all.counted || !all.calc) throw new Error('no result');
    expect(methodNotes(all.counted, all.calc)).toEqual(all.view.method.notes);
  });
});

// ---------- the words themselves ----------

describe('every sentence the store words', () => {
  /** The label of every slider, as the sentence about what matters most names it. */
  const SLIDER_LABELS = [...Object.values(ENERGY_ROWS), ...Object.values(ASSUMPTION_ROWS)].map((row) => row.label);
  /** Each function of words.ts, called with values that reach each of its forms. */
  const SPOKEN: string[] = [
    ...texts(Object.values(words).filter((entry) => typeof entry !== 'function')),
    words.nameWithSize('GPT-5.6', 'large'),
    words.unknownModelNote('acme', 0.12),
    words.unknownModelNote('acme', 0.001),
    ...(Object.keys(words.PLAN_REASONS) as words.PlanReason[]).flatMap((reason) => [words.planModelNote('GPT-5.6', 'large', reason), words.planModelNote('GPT-5.6', 'small', reason)]),
    words.hiddenTierNote('claude-code', 'GPT-6'),
    words.hiddenTierNote('chatgpt', 'GPT-6'),
    words.noModelNote(1),
    words.noModelNote(12),
    words.answerHeadline(1, 5, '2026-09-08', '2026-10-07'),
    words.answerHeadline(3, 781e6, '2026-09-08', '2026-10-07'),
    words.shortDataNote('2026-09-26', '2026-10-07', 12),
    words.shortDataNote('2026-10-07', '2026-10-07', 1),
    words.staleNote('2026-09-26'),
    words.readingText(0),
    words.readingText(1),
    words.exportHeadline(1, 1, '2026-10-02'),
    words.exportHeadline(1284, 612, null),
    ...(['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'E9'] as const).map((code) => words.problemWords({ code })),
    words.problemWords({ code: 'E5', name: 'notes.json' }),
    words.problemWords({ code: 'E8', newest: '2026-07-01' }),
    words.problemWords({ code: 'E8', newest: null }),
    words.oldExportNote('2026-09-20'),
    words.rescuedNote(1),
    words.rescuedNote(40),
    words.cutOffNote('conversations-001.json'),
    words.duplicatesNote(1),
    words.duplicatesNote(3),
    words.skippedNote(1),
    words.skippedNote(3),
    words.ignoredNote(1),
    words.ignoredNote(3),
    ...(['claude-code', 'chatgpt'] as const).flatMap((source) =>
      (['last-30', 'older-30', 'days', 'one-day'] as const).flatMap((form) => [true, false].map((single) => words.summaryWords(source, form, '2026-09-08', '2026-10-07', 12, single)))),
    words.setLabel(1) ?? '',
    words.setLabel(3) ?? '',
    ...[true, false].flatMap((set) => [0, 1, 2].map((tips) => words.extremeLabel(set, tips))),
    ...SLIDER_LABELS.flatMap((label) => [words.mattersMostNote(label, 4.1, 44, 'kg', false), words.mattersMostNote(label, 0.0041, 0.044, 'g', true)]),
    ...[0.004, 0.2].flatMap((share) => [words.unknownModelNote('my-local-llm', share), words.unnamedStepsNote(share)]),
    words.appliedLabel(['A third less re-reading']) ?? '',
    words.appliedLabel(['a', 'b']) ?? '',
    words.problemWords({ code: 'E10' }),
    words.problemWords({ code: 'E11', name: 'conversations.json' }),
    ...(['start', 'end', 'both'] as const).flatMap((gap) => (['days', 'one-day'] as const).map((form) => words.summaryWords('chatgpt', form, '2026-09-08', '2026-10-07', 12, false, gap))),
    words.allTypicalNote(8.6, 9.8, 5746, 'kg', false) ?? '',
    words.allTypicalNote(9.8, 8.6, 4000, 'kg', true) ?? '',
    words.marketNote(1.1, 2.8, 9.6, 'kg', false),
    words.marketNote(1.7, 1.7, 1.7, 'kg', true),
  ];

  it('is a sentence', () => {
    expect(SPOKEN.length).toBeGreaterThan(150);
    for (const text of SPOKEN) {
      expect(text.trim()).not.toBe('');
      expect(text).not.toMatch(/\bNaN\b|undefined|\bnull\b|\[object|\{|\}/);
    }
  });

  it('uses none of the words the page never says about emissions', () => {
    for (const text of SPOKEN) expect([text, bannedIn(text)]).toEqual([text, null]);
  });

  it('prints a count of one as one, and no number as nothing', () => {
    expect(words.setLabel(0)).toBeNull();
    expect(words.setLabel(Number.NaN)).toBeNull();
    expect(words.allTypicalNote(8.6, 8.6000001, 5000, 'kg', false)).toBeNull();
    expect(words.noModelNote(1284)).toContain('for 1,284 of');
    expect(words.marketNote(0.5, 0.5, 0.5, 'kg', false)).toContain('your result would be about 0.5 kg.');
  });

  it('the test for banned words finds what it looks for', () => {
    for (const text of ['Offset your AI use', 'carbon neutral', 'You are compensated', 'net zero', 'what you owe', 'Saves up to 2 kg a month', 'This would save up to roughly 3 kg']) {
      expect(bannedIn(text)).not.toBeNull();
    }
    // The one sentence that may say "up to": a tip that is on and can cost more.
    expect(bannedIn('Could save up to roughly 2 kg, or cost up to roughly 1 kg more.')).toBeNull();
    expect(bannedIn('a large photo may have cost up to five times more.')).toBeNull();
    expect(bannedIn('The lowest value we take seriously.')).toBeNull();
  });
});

describe('every View of this file', () => {
  const VIEWS: View[] = [
    shownFor(stateAfter([])).view,
    claude(ANSWER_A).view,
    claude(ANSWER_A, TODAY, toggle('cc-clear'), toggle('cc-opus-to-sonnet')).view,
    claude('nonsense').view,
    claude(answer([{ model: 'my-local-model', in: 10, out: 100 }, { model: 'gpt-6', out: 5 }], { first: '2026-09-26' }), '2026-10-20').view,
    chatgpt(exampleReading('current', true)).view,
    chatgpt(exampleReading('current', false), report(), toggle('thinking'), toggle('gpt-shorter-answers')).view,
    chatgpt(exampleReading('older', null)).view,
    chatgpt(read([turn('a', at('2026-07-01'), 'gpt-5-5')], { now: NOW })).view,
  ];

  it('holds no banned word, no number that is none and no empty sentence', () => {
    for (const view of VIEWS) {
      expect(flaws(view)).toEqual([]);
      for (const text of sentences(view)) expect([text, bannedIn(text)]).toEqual([text, null]);
    }
  });
});
