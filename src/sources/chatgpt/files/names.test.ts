import { describe, expect, it } from 'vitest';
import { CONVERSATION_FILE, USER_FILE, ZIP_FILE, isInnerExportZip } from './names';

describe('which names the reader acts on', () => {
  it('knows a conversations file, at the top or in a folder', () => {
    for (const name of ['conversations.json', 'conversations-000.json', 'conversations-1234.json', 'export/conversations-023.json', '../a/conversations.json']) {
      expect(CONVERSATION_FILE.test(name), name).toBe(true);
    }
    for (const name of ['conversations-1.json', 'conversations-00.json', 'conversations.json.bak', 'shared_conversations.json', '._conversations.json', '__MACOSX/._conversations.json', 'conversations (1).json', 'Conversations.json', 'conversations.json/x']) {
      expect(CONVERSATION_FILE.test(name), name).toBe(false);
    }
  });

  it('knows user.json and a ZIP by its ending', () => {
    expect(USER_FILE.test('user.json')).toBe(true);
    expect(USER_FILE.test('export/user.json')).toBe(true);
    expect(USER_FILE.test('user_settings.json')).toBe(false);
    expect(USER_FILE.test('superuser.json')).toBe(false);
    expect(ZIP_FILE.test('Export.ZIP')).toBe(true);
    expect(ZIP_FILE.test('export.zip.part')).toBe(false);
  });

  it('knows an export ZIP inside the privacy portal container', () => {
    for (const name of [
      'User Online Activity/Conversations__abc-chatgpt-0001.zip',
      'User Online Activity/Conversations__abc-chatgpt-0001-part-0002.zip',
      'Conversations__abc-chatgpt-0001.ZIP',
      'x-CHATGPT-7.zip',
    ]) {
      expect(isInnerExportZip(name), name).toBe(true);
    }
    for (const name of [
      'User Online Activity/Files__abc-files-0001.zip',
      'User Online Activity/Ads__abc-ads-0001.zip',
      'my-chatgpt-notes.zip',
      'x-chatgpt-.zip',
      'x-chatgpt-0001.zip/inside.txt',
      'x-chatgpt-0001/photos.zip',
      'x-chatgpt-0001.zip.part',
      'chatgpt-0001.zip',
    ]) {
      expect(isInnerExportZip(name), name).toBe(false);
    }
  });

  it('is quick on the longest and most awkward names a ZIP can hold', () => {
    // As one pattern, the check for an inner export ZIP took two seconds on the first of these.
    const awkward = [
      `x-chatgpt-${'1'.repeat(65_500)}.zi`,
      '-chatgpt-1'.repeat(6_500),
      `${'a/'.repeat(30_000)}conversations-`,
      `conversations-${'1'.repeat(65_500)}.jso`,
      '/'.repeat(65_535),
    ];
    const start = performance.now();
    for (const name of awkward) {
      expect(isInnerExportZip(name)).toBe(false);
      expect(CONVERSATION_FILE.test(name)).toBe(false);
      expect(USER_FILE.test(name)).toBe(false);
    }
    expect(performance.now() - start).toBeLessThan(250);
  });
});
