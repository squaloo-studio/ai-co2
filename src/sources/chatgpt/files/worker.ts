// The Web Worker's entry. Both halves of the ChatGPT reader run here, off the page's main thread:
// this folder opens the files, ../account counts what is in them. Nothing leaves the worker but
// counts, and the worker makes no network request.

import { createAccount } from '../account/account';
import { goOffline } from './offline';
import { serve } from './serve';

// Before the first message, and so before any file: see offline.ts for why the page's policy does not do this.
goOffline(self);
serve(self, createAccount);
