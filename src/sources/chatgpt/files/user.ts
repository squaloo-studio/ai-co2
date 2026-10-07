// user.json is one small object. It is collected whole and parsed in one piece.

import type { FilePath } from './report';
import type { Run } from './run';

export interface UserCollector {
  /** false once the file has ended or was given up. Whoever unpacks it can then stop. */
  readonly open: boolean;
  /** Throws a ReadExportError when the whole read must end. Never throws for a bad file. */
  push(chunk: Uint8Array): void;
  end(): void;
  fail(): void;
}

export function collectUser(run: Run, path: FilePath): UserCollector {
  let chunks: Uint8Array[] | null = [];
  let size = 0;
  const fail = (): void => {
    if (chunks === null) return;
    chunks = null;
    run.notice({ code: 'user-unreadable', path });
  };
  return {
    get open() {
      return chunks !== null;
    },
    push(chunk) {
      if (chunks === null) return;
      run.checkpoint();
      size += chunk.byteLength;
      if (size > run.limits.maxUserFileBytes) return fail();
      // A copy: the buffer behind a chunk may be reused by whoever handed it over.
      chunks.push(chunk.slice());
    },
    end() {
      if (chunks === null) return;
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      chunks = null;
      let user: unknown;
      try {
        user = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        run.notice({ code: 'user-unreadable', path });
        return;
      }
      run.setUser(user);
    },
    fail,
  };
}
