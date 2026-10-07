// Chapter "Your data": the either/or choice, then the chosen tool's steps and what was read from it.

import type { Action } from '../contracts/store';
import type { SourceId } from '../contracts/usage';
import type { ModelRow, SourceStatus, View } from '../contracts/view';
import { percent, tokenCount } from '../format';
import { all, el, icon, need, setLines, setText, show } from './dom';
import type { Scope } from './motion';

export interface DataPart {
  update(view: View): void;
}

type ChipKind = 'checked' | 'problem' | 'waiting';

interface ToolWords {
  name: string;
  switchTo: string;
  /**
   * The word in the chip and the line beside it, for each state but "ok" (whose line comes from the View).
   * The line for a problem has to be true of every problem: an answer or an export that was read
   * without trouble and holds nothing to estimate is one of them. The message under it says which.
   */
  waiting: [string, string];
  reading: [string, string];
  problem: [string, string];
  okChip: string;
}

const WORDS: Record<SourceId, ToolWords> = {
  'claude-code': {
    name: 'Claude Code',
    switchTo: 'Switch to ChatGPT',
    waiting: ['Waiting', 'Paste Claude’s answer'],
    reading: ['Reading', 'Reading the answer'],
    problem: ['Needs a look', 'This answer gave no result'],
    okChip: 'Counted',
  },
  chatgpt: {
    name: 'ChatGPT',
    switchTo: 'Switch to Claude Code',
    waiting: ['Waiting', 'Drop your export'],
    reading: ['Reading', 'Reading your export'],
    problem: ['Needs a look', 'This export gave no result'],
    okChip: 'Read',
  },
};

const CHIP_ICONS: Record<ChipKind, string> = { checked: 'check', problem: 'alert', waiting: 'wait' };
/** Typing in the paste box is sent on once it pauses this long. */
export const ANSWER_PAUSE_MS = 120;
export const COPIED_MS = 2200;
/** The table shows this many models. A longer list ends in one row that says how many more there are. */
export const MODEL_ROWS = 8;

function chip(kind: ChipKind, word: string): HTMLElement {
  const node = el('span', `chip chip--${kind}`);
  node.append(icon(CHIP_ICONS[kind], true), word);
  return node;
}

function modelTable(models: readonly ModelRow[]): HTMLTableElement {
  const table = el('table', 'models');
  table.append(el('caption', 'sr', 'What was read, by model'));
  const head = el('tr');
  const columns: Array<[string, string]> = [['Model', ''], ['Tokens', 'c-tokens'], ['Share of the estimate', 'c-share']];
  for (const [text, className] of columns) {
    const th = el('th', className);
    th.scope = 'col';
    // The last heading has a one-word form for phones. The styles show one of the two.
    if (className === 'c-share') th.append(el('span', 'long', text), el('span', 'short', 'Share'));
    else th.textContent = text;
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  for (const model of models.slice(0, MODEL_ROWS)) {
    const row = el('tr');
    // A name is someone else's text. Kept apart, a name in right-to-left letters cannot reorder the numbers after it.
    const name = el('th');
    name.append(el('bdi', '', model.name));
    name.scope = 'row';
    const bar = el('span', 'share-bar');
    bar.append(el('i'));
    const cell = el('span', 'share');
    cell.append(bar, el('span', 'num'));
    const shareCell = el('td', 'c-share');
    shareCell.append(cell);
    row.append(name, el('td', 'c-tokens num', tokenCount(model.tokens)), shareCell);
    body.append(row);
  }
  const more = models.length - MODEL_ROWS;
  if (more > 0) {
    const row = el('tr', 'models-more');
    const cell = el('td', '', `and ${more.toLocaleString('en')} more ${more === 1 ? 'model' : 'models'}`);
    cell.colSpan = columns.length;
    row.append(cell);
    body.append(row);
  }
  table.append(thead, body);
  setShares(table, models);
  return table;
}

/** Writes the shares into a table that is already there. They move with the sliders; the rows do not. */
function setShares(table: Element, models: readonly ModelRow[]): void {
  const cells = all(table, 'tbody .share');
  models.slice(0, MODEL_ROWS).forEach((model, i) => {
    const cell = cells[i];
    if (!cell) return;
    // Only the bar's length is kept inside its track. The number is printed as it came.
    const length = `${(Math.max(0, Math.min(1, model.share)) * 100).toFixed(1)}%`;
    const fill = need(cell, 'i');
    if (fill.style.getPropertyValue('--share') !== length) fill.style.setProperty('--share', length);
    setText(need(cell, '.num'), percent(model.share));
  });
}

export function createData(root: ParentNode, scope: Scope, send: (action: Action) => void, say: (text: string) => void): DataPart {
  const section = need(root, '[data-chapter="data"]');
  const choose = need(section, '[data-choose]');
  const chosen = need(section, '[data-chosen]');
  const chosenName = need(section, '[data-chosen-name]');
  const switchButton = need<HTMLButtonElement>(section, '[data-switch-source]');
  const stack = need(section, '[data-tool-stack]');
  const panes: Record<SourceId, HTMLElement> = {
    'claude-code': need(section, '[data-tool="claude-code"]'),
    chatgpt: need(section, '[data-tool="chatgpt"]'),
  };
  const cc = panes['claude-code'];
  const gpt = panes.chatgpt;

  const prompt = need(cc, '[data-prompt]');
  const promptText = need(cc, '[data-prompt-text]');
  const copyButton = need<HTMLButtonElement>(cc, '[data-copy]');
  const copyLabel = need(cc, '[data-copy-label]');
  const copyMsg = need(cc, '[data-copy-msg]');
  const expandButton = need<HTMLButtonElement>(cc, '[data-expand]');
  const answer = need<HTMLTextAreaElement>(cc, '[data-answer]');
  const answerMsg = need(cc, '[data-answer-msg]');

  const drop = need(gpt, '[data-drop]');
  const fileInput = need<HTMLInputElement>(gpt, '[data-file]');
  const dropMsg = need(gpt, '[data-drop-msg]');
  const gptSteps = need(gpt, '[data-steps]');
  const stepList = need(gpt, '[data-step-list]');
  const stepNotes = need(gpt, '[data-step-notes]');
  const cancelRead = need<HTMLButtonElement>(gpt, '[data-cancel-read]');
  const progress = need(gpt, '[data-progress]');
  const progressBar = need(gpt, '[data-progress-bar]');
  const progressFill = need(gpt, '[data-progress-fill]');
  const progressText = need(gpt, '[data-progress-text]');

  /** Whether the steps are open. They fold away once the data is in, and "Paste a new answer" opens them again. */
  const open: Record<SourceId, boolean> = { 'claude-code': true, chatgpt: true };
  const seenState: Partial<Record<SourceId, SourceStatus['state']>> = {};
  const seenRead: Partial<Record<SourceId, string>> = {};
  const drawnStatus = new WeakMap<Element, string>();
  let source: SourceId | null = null;
  /** The export's problem that was last announced, so each one is spoken once. */
  let saidProblem: string | null = null;

  // ----- the paste box -----
  let pending: (() => void) | null = null;
  let lastSent: string | null = null;
  let lastSeen: string | null = null;
  scope.listen(answer, 'input', () => {
    pending?.();
    pending = scope.timer(() => {
      pending = null;
      lastSent = answer.value;
      send({ type: 'set-answer', text: answer.value });
    }, ANSWER_PAUSE_MS);
  });
  /** Typing that has not been sent yet belongs to the tool that is being left. It is dropped with it. */
  function forgetAnswer(): void {
    pending?.();
    pending = null;
    lastSent = null;
    lastSeen = null;
  }

  // ----- the choice and the switch -----
  scope.listen<MouseEvent>(choose, 'click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-choose-source]') : null;
    const picked = button?.getAttribute('data-choose-source');
    if (picked === 'claude-code' || picked === 'chatgpt') send({ type: 'choose-source', source: picked });
  });
  scope.listen(switchButton, 'click', () => {
    forgetAnswer();
    send({ type: 'switch-source' });
  });

  for (const id of ['claude-code', 'chatgpt'] as const) {
    scope.listen(need(panes[id], '[data-redo]'), 'click', () => {
      open[id] = !open[id];
      fold(id);
    });
  }

  function fold(id: SourceId): void {
    const pane = panes[id];
    const steps = need(pane, '[data-steps]');
    const redo = need(pane, '[data-redo]');
    // Folding steps that hold the focus would drop it on the page. The button that opens them takes it.
    if (!open[id] && steps.contains(document.activeElement) && !redo.hidden) redo.focus();
    show(steps, open[id]);
    redo.setAttribute('aria-expanded', String(open[id]));
  }

  // ----- the prompt -----
  let copyReset: (() => void) | null = null;
  const sizePrompt = () => promptText.style.setProperty('--open-h', `${promptText.scrollHeight}px`);
  function expand(on: boolean): void {
    sizePrompt();
    prompt.classList.toggle('is-open', on);
    expandButton.setAttribute('aria-expanded', String(on));
    setText(expandButton, on ? 'Show less' : 'Show all');
  }
  scope.listen(expandButton, 'click', () => expand(!prompt.classList.contains('is-open')));
  scope.listen(window, 'resize', () => { if (prompt.classList.contains('is-open')) sizePrompt(); }, { passive: true });
  scope.listen(copyButton, 'click', async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(promptText.textContent ?? '');
      copied = true;
    } catch {
      copied = false;
    }
    copyReset?.();
    copyReset = null;
    // The button's new label is seen but not spoken, so the status line says it too, out of sight.
    copyMsg.classList.toggle('sr', copied);
    if (copied) {
      setText(copyLabel, 'Copied');
      setText(copyMsg, 'Prompt copied.');
      copyReset = scope.timer(() => {
        setText(copyLabel, 'Copy prompt');
        setText(copyMsg, '');
        copyMsg.classList.remove('sr');
      }, COPIED_MS);
    } else {
      // The browser refused. Open the whole prompt, so it can be selected and copied by hand.
      setText(copyLabel, 'Copy prompt');
      setText(copyMsg, 'Your browser didn’t allow copying. Select the prompt above and copy it by hand.');
      expand(true);
    }
  });

  scope.listen(cancelRead, 'click', () => send({ type: 'cancel-read' }));

  // ----- the drop zone -----
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const addFiles = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length) send({ type: 'add-files', files });
  };
  // Only files make the zone react. Dragged text or a link is left to the browser.
  for (const type of ['dragenter', 'dragover']) {
    scope.listen<DragEvent>(drop, type, event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      drop.classList.add('is-over');
    });
  }
  scope.listen<DragEvent>(drop, 'dragleave', event => {
    if (!(event.relatedTarget instanceof Node) || !drop.contains(event.relatedTarget)) drop.classList.remove('is-over');
  });
  scope.listen<DragEvent>(drop, 'drop', event => {
    drop.classList.remove('is-over');
    if (!hasFiles(event)) return;
    event.preventDefault();
    addFiles(event.dataTransfer?.files);
  });
  scope.listen(fileInput, 'change', () => {
    addFiles(fileInput.files);
    // Cleared, so choosing the same file again still counts as a change.
    fileInput.value = '';
  });
  // A file that misses the zone would otherwise make the browser leave the page and open the file.
  for (const type of ['dragover', 'drop']) {
    scope.listen<DragEvent>(window, type, event => {
      const inZone = event.target instanceof Node && drop.contains(event.target);
      if (hasFiles(event) && !inZone) event.preventDefault();
    });
  }

  // ----- drawing -----
  function drawStatus(pane: HTMLElement, id: SourceId, status: SourceStatus): void {
    const words = WORDS[id];
    const [kind, word, line]: [ChipKind, string, string] =
      status.state === 'ok'
        ? ['checked', words.okChip, status.headline]
        : status.state === 'problem'
          ? ['problem', ...words.problem]
          : ['waiting', ...words[status.state]];
    const target = need(pane, '[data-status]');
    const key = `${kind}|${word}|${line}`;
    if (drawnStatus.get(target) === key) return;
    drawnStatus.set(target, key);
    target.replaceChildren(chip(kind, word), el('span', '', line));
  }

  /** Draws what was read. Returns a key that changes whenever the read data does. */
  function drawRead(pane: HTMLElement, status: SourceStatus): string | null {
    const target = need(pane, '[data-read]');
    show(target, status.state === 'ok');
    if (status.state !== 'ok') return null;
    // The shares are left out of the key: they change at every step of a dragged slider, and are
    // written into the table that stands.
    const key = JSON.stringify([status.headline, status.confirmation, status.models.map(model => [model.name, model.tokens]), status.notes]);
    if (drawnStatus.get(target) === key) {
      const table = target.querySelector('.models');
      if (table) setShares(table, status.models);
      return key;
    }
    drawnStatus.set(target, key);
    target.replaceChildren();
    // The green line is the logic's own verdict on the data. Without one, the page claims nothing.
    if (status.confirmation) {
      const line = el('p', 'sum-line');
      line.append(icon('check', true), el('span', '', status.confirmation));
      target.append(line);
    }
    if (status.models.length) target.append(modelTable(status.models));
    if (status.notes.length) {
      const notes = el('ul', 'list read-notes');
      setLines(notes, status.notes);
      target.append(notes);
    }
    return key;
  }

  function drawTool(id: SourceId, status: SourceStatus): void {
    const pane = panes[id];
    const redo = need(pane, '[data-redo]');
    seenState[id] = status.state;
    show(redo, status.state === 'ok');
    drawStatus(pane, id, status);
    const read = drawRead(pane, status);
    // The steps fold away each time new data is in, also when one good answer replaces another.
    if (read === null) open[id] = true;
    else if (read !== seenRead[id]) open[id] = false;
    seenRead[id] = read ?? undefined;
    fold(id);
  }

  return {
    update(view) {
      const picked = view.source !== null;
      const justPicked = picked && source === null;
      const cameFromChoice = justPicked && choose.contains(document.activeElement);
      if (view.source !== source) {
        forgetAnswer();
        // What the other tool was last doing says nothing about this one.
        seenState.chatgpt = undefined;
        saidProblem = null;
      }
      source = view.source;

      section.setAttribute('data-picked', String(picked));
      show(chosen, picked);
      show(stack, picked);
      for (const note of all(section, '[data-note-for]')) show(note, !picked || note.getAttribute('data-note-for') === view.source);
      for (const id of ['claude-code', 'chatgpt'] as const) show(panes[id], view.source === id);
      if (!view.source) {
        for (const id of ['claude-code', 'chatgpt'] as const) {
          seenState[id] = undefined;
          seenRead[id] = undefined;
        }
        saidProblem = null;
        return;
      }

      const words = WORDS[view.source];
      setText(chosenName, words.name);
      setText(switchButton, words.switchTo);
      for (const tile of all<SVGElement>(chosen, '[data-icon-for]')) show(tile, tile.getAttribute('data-icon-for') === view.source);
      // The card that was clicked is gone now. The tool's name takes the focus, so the steps come next.
      if (cameFromChoice) chosenName.focus();

      if (view.source === 'claude-code') {
        const data = view.data.claudeCode;
        setText(promptText, data.prompt);
        if (data.answer !== lastSeen) {
          lastSeen = data.answer;
          // Only an answer that came from elsewhere is written in. What the person is typing is left alone.
          if (data.answer !== lastSent && answer.value !== data.answer) answer.value = data.answer;
        }
        const problem = data.status.state === 'problem' ? data.status.message : null;
        answer.setAttribute('aria-invalid', String(problem !== null));
        // The message is always on the page and only its words change, so they are heard when they arrive.
        answerMsg.classList.toggle('is-bad', problem !== null);
        answerMsg.classList.toggle('is-empty', problem === null);
        show(need(answerMsg, 'svg'), problem !== null);
        setText(need(answerMsg, 'span'), problem ?? '');
        drawTool('claude-code', data.status);
      } else {
        const status = view.data.chatgpt.status;
        const before = seenState.chatgpt;
        const reading = status.state === 'reading';
        const focused = document.activeElement;
        const inSteps = focused instanceof HTMLElement && gptSteps.contains(focused);
        show(progress, reading);
        show(stepList, !reading);
        show(stepNotes, !reading);
        if (reading) {
          const total = status.total !== null && status.total > 0 ? status.total : null;
          const done = total === null ? 0 : Math.max(0, Math.min(100, (status.done / total) * 100));
          progressBar.classList.toggle('is-open-ended', total === null);
          progressFill.style.setProperty('--done', `${done.toFixed(1)}%`);
          if (total !== null) progressBar.setAttribute('aria-valuenow', String(Math.round(done)));
          else progressBar.removeAttribute('aria-valuenow');
          setText(progressText, status.text);
        }
        // The message is tied to the file field as its description. It is no live region of its own:
        // the status line below announces every problem, so nothing is spoken twice.
        const problem = status.state === 'problem' ? status.message : null;
        drop.classList.toggle('is-bad', problem !== null);
        fileInput.setAttribute('aria-invalid', String(problem !== null));
        dropMsg.classList.toggle('is-bad', problem !== null);
        dropMsg.classList.toggle('is-empty', problem === null);
        show(need(dropMsg, 'svg'), problem !== null);
        setText(need(dropMsg, 'span'), problem ?? '');
        drawTool('chatgpt', status);

        if (reading && before !== 'reading') say('Reading your export.');
        // "Stop reading" was pressed. Saying so also clears the line, so the next read is announced again.
        if (status.state === 'waiting' && before === 'reading') say('Stopped reading.');
        if (problem !== null && problem !== saidProblem) say(`${words.problem[1]}. ${problem}`);
        saidProblem = problem;
        // Whatever held the focus may just have been hidden: the file field while the export is read,
        // the progress bar once it is done. The focus moves to what took its place.
        if (inSteps && focused.closest('[hidden]')) {
          if (reading) progressBar.focus();
          else if (status.state === 'ok') need(gpt, '[data-redo]').focus();
          else fileInput.focus();
        }
      }
    },
  };
}
