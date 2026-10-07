# ai-co2

ai-co2 is a web page that estimates the CO2 of your AI use over the last 30 days. It works with Claude Code or with ChatGPT, one tool at a time. It starts from data you already have, shows the estimate as a range, then shows ways to cut it and ways to give money to climate work.

It is free and open source, and it runs in your browser. Behind the page there is no server that works on your data and no AI, only fixed code.

The page: https://squaloo-studio.github.io/ai-co2/

One word comes up often: a token is a piece of a word. AI tools count their work in tokens.

## How it works

You pick one tool. The page then works with that tool only. The two are never added together.

### Claude Code

1. Copy the prompt from the page.
2. Paste it into Claude Code, in the terminal, your IDE or the desktop app. Start a fresh conversation first, so that a long one is not read again. Your own Claude Code runs a short counting script. The script reads Claude Code's log files on your computer and prints a few lines of totals.
3. Copy Claude's whole reply and paste it into the page. The page checks that the reply has the expected format and that the numbers add up. Then it shows your result.

The reply looks like this, here with made-up numbers. There is one line per model, with four token counts each: fresh input, text stored for re-use (cache write), stored text read again (cache read), and output.

```text
ai-co2 v1 | 2026-09-08 to 2026-10-07 | data 2026-09-26 to 2026-10-07
claude-opus-5-5 | in 1204551 | cache_write 48211973 | cache_read 912340118 | out 6120447
claude-haiku-4-5-20251001 | in 80112 | cache_write 2400310 | cache_read 31200455 | out 410220
total | 1001968186
```

### ChatGPT

1. Ask ChatGPT for your data export: Settings, then Data controls, then Export data, then Export.
2. Wait for the message. ChatGPT sends an email or a text message when the export is ready. That can take up to 7 days. The download link works for 24 hours.
3. Drop the ZIP on the page. If the export came as several files, drop them together. The page reads it in your browser, counts the tokens of what you wrote and what ChatGPT answered, and shows your result.

Business, Enterprise and Healthcare workspaces cannot make this export.

## What leaves your computer

- **The page sends nothing.** It uploads no data and has no analytics and no error reporting. It only fetches its own files from the site itself: scripts, styles and fonts, some of them only when they are needed. Opening the page is an ordinary request to the web host, GitHub Pages, as with any website.
- **ChatGPT:** nothing leaves your computer. The export is read in the browser tab. The page keeps counts, dates and model names from it, and no conversation text.
- **Claude Code:** only the totals. The counting script prints token counts, model names and dates, and nothing else. Your own Claude Code runs it, so the totals pass through Claude like any other message in that conversation. The prompt tells Claude not to open the log files itself. You then paste the totals into the page, where they stay in your browser.
- **Nothing is remembered.** The page sets no cookies and stores nothing in your browser. Closing the tab clears everything.

### What the counting script reads

The script reads Claude Code's own log files: every `.jsonl` file under `~/.claude/projects` and `~/.config/claude/projects`. If `CLAUDE_CONFIG_DIR` is set, it reads the `projects` folder inside that folder instead. If `XDG_CONFIG_HOME` is set, that folder takes the place of `~/.config`.

These files hold your conversations. The script keeps only token counts, model names and dates, and prints no conversation text. It opens no network connection and writes no file.

You can read it before you run it. It is 120 lines of Python and needs nothing beyond Python 3.8 or later:

- The script: [`src/sources/claude-code/count-tokens.py`](src/sources/claude-code/count-tokens.py)
- The text around it in the prompt: [`src/sources/claude-code/prompt.ts`](src/sources/claude-code/prompt.ts)

The prompt is built from that script file, so what you read in the repository is what the prompt asks Claude to run.

Three things to know:

- Claude writes the script out again as its command. Nothing guarantees an exact copy.
- If you want to see and approve the command first, switch Claude Code to Manual mode before you paste.
- If Python 3 is not on your computer, the prompt asks Claude to write the same count in Node.js or PowerShell, from the numbered rules at the top of the script. That code is then Claude's own, and this path has not been tested.

## What the result is

The result is a range with a middle estimate: a low end, a high end and a marker between them. It is not one exact number, because the electricity a token takes is not known exactly and has to be assumed.

The page works out your footprint 10,000 times, each time with a different combination of values for its assumptions. The range shown is where 90 of 100 of those results land. The middle estimate has half of the results below it and half above.

- **Your tokens are counted. The rest is assumed:** the energy per token, how much less energy reading takes than writing, the extra electricity a data centre uses for cooling and power supply, how much CO2 comes with each unit of electricity, and making the hardware. For ChatGPT, the hidden work is assumed too (see Limits).
- **Each assumption in the page's table has a low, a typical and a high value, a slider, and a line that says where the numbers come from.** Some come from published studies. Others are our own assumptions, and the page says which. If you set every slider yourself, one number remains, and the page says so.
- **A few assumptions about ChatGPT are fixed and have no slider.** The page lists them.
- **Nothing is random.** The same data and the same settings always give the same result.
- **The range is only as good as the assumptions.** If a real value lies below our low or above our high, your real footprint can lie outside the range too.

**Left out, among other things:** water; training the models; your own device and the networks to the data centre; idle spare machines and data storage. For Claude Code: use on other computers, in cloud sessions and over SSH. For ChatGPT: generated images, deep research and agent runs, the audio of voice chats, and temporary or deleted chats.

The numbers, where they come from, and the full lists of what is counted and left out are on the page, in the section "How it's calculated". This README does not repeat them, so that they live in one place.

After the result, the page shows up to three ways to cut your footprint, picked from your own numbers. Each comes with a saving that is also a range. Then it shows three ways to give money. One pays for taking CO2 out of the air, which is delivered later. One buys EU emission allowances and holds them, so that no company can use them. One is a donation fund. Giving money does not undo emissions, and your estimate stays what it is. ai-co2 gets nothing from the organisations it lists.

## Limits

- **These are estimates, not measurements.** The page cannot measure the electricity your tokens took. It relies on published estimates, and those differ widely. Some assumptions rest on little evidence, and the page marks them.
- **Claude Code counts are what Claude Code logged on this computer.** Other computers, cloud sessions and SSH sessions are not in them. Claude Code deletes its logs after 30 days by default, or sooner if that setting is lower. When the logs start three or more days after the 30 days begin, the page says how many days the result covers. It never scales a number up to 30 days.
- **Claude Code's log format is internal to Claude Code.** It can change with any release. The counting script may then count too little, and the project has no automatic way to notice.
- **The page cannot check that Claude ran the script unchanged.** It checks the format of the reply and that the numbers add up to the total. That catches a damaged reply. It does not catch a changed script.
- **ChatGPT tokens are counted by the page, not by OpenAI.** The export carries a token count for some messages and files only. The page uses the counts for files and counts all other text itself with an open-source tokenizer, a program that splits text into tokens. It uses the same one for every model. Compared with OpenAI's own counts in two exports, it reads about 1% low. For GPT-6 this is not confirmed.
- **Hidden work in ChatGPT is estimated.** The export does not show how much ChatGPT wrote while thinking, its hidden instructions, what it has saved about you, the text of the web pages it read, or the length of some uploaded files. The page adds estimates for these, and you can switch each group off. How often ChatGPT can reuse an earlier reading of a conversation is an assumption too.
- **OpenAI does not publish the export's format.** The reader was built from exports that people had made public, and the format can change without notice.
- **A model name does not always say which model answered.** A model the page does not know is counted with a wide range, from the low end of small models to the high end of large ones, and the page tells you.
- **The prices of the ways to give were checked on a date.** Each one shows that date. Prices and terms can change, so check on the organisation's own site before you give.
- **Testing so far (7 October 2026).** The counting script has only run on made-up log files, and nobody has yet run the prompt in Claude Code. The tests in this repository use made-up logs and exports and run in Node.js, not in a browser. Checks with real logs, a real export and the common browsers are still to be done.

## For developers

### Requirements

- Node.js 22 (22.12 or later), 24, or 26 and later, with npm.
- Python 3.8 or later, only for the tests of the Python counting script. Without it, those tests are skipped and say so.

### Commands

Run `npm install` once. Then:

| Command | What it does |
|---|---|
| `npm run dev` | Starts a local server that reloads when a file changes |
| `npm run build` | Checks the types, then builds the site into `dist/` |
| `npm run preview` | Serves the built site from `dist/` on your computer |
| `npm run typecheck` | Checks the types only |
| `npm test` | Runs all tests once |
| `npm run test:watch` | Runs the tests again whenever a file changes |

The site is built with relative paths, so the contents of `dist/` can be served from any folder of a static host. The build also writes `dist/licences.txt`: the licence of ai-co2 and, in full, the licence of every library and font the site carries.

The site is published by the workflow in [`.github/workflows/pages.yml`](.github/workflows/pages.yml). It runs only when a maintainer starts it by hand.

### Where things live

| Path | What is in it |
|---|---|
| `index.html` | The page's fixed text and structure |
| `src/main.ts` | The entry point |
| `src/sources/claude-code/` | The prompt, the counting script and the reader for the pasted reply |
| `src/sources/chatgpt/` | The export reader: `files/` opens the dropped files in a Web Worker, `account/` counts tokens and hidden work |
| `src/sources/models/` | Sorts model names into size classes: small, mid-size, large, Fable or unknown |
| `src/model/` | The estimate: the formula, the table of assumptions and the fixed pattern of 10,000 runs. Also the hidden work in ChatGPT, the ways to cut and the ways to give, each with its sentences |
| `src/contracts/` | The types shared by the logic and the page |
| `src/app/` | The logic behind the page: it takes what the two readers hand over, calls the estimate and words the sentences. `demo.ts` is a stand-in with made-up numbers for looking at the page's states; it is not part of the published site |
| `src/ui/` | Draws the page. Text from outside is always inserted as text, never as HTML |
| `src/styles/` | The style sheets |
| `src/format.ts`, `src/track.ts` | How numbers are printed, and how a slider position becomes a value |
| `src/links.ts` | Every web address the built site may hold. A test builds the site and fails on any other address |
| `vite.config.ts` | The build: the page's content security policy and the licence notices are added here |
| `design/boards/` | The design mock-ups. They are not part of the built site, and they load their fonts from Google Fonts |

`PRODUCT.md` says what the tool is for. `DESIGN.md` holds the rules for its look. [`SOURCES.md`](SOURCES.md) lists the full citation behind each assumption.

### The path a number takes

The page never calculates. It sends an `Action` to the store (a pasted reply, a dropped file, a moved slider) and draws the `View` the store hands back. Both types are in `src/contracts/`. Inside `src/app/`, every action takes the same path:

| Step | File | What happens |
|---|---|---|
| 1 | `state.ts`, `reduce` | The action changes what the store keeps: the data, the sliders that are set, the tips that are applied and the switches |
| 2 | `usage.ts`, `count` | What a reader handed over becomes token rows for the estimate. Every count is checked once more here |
| 3 | `calc.ts`, `recalc` | Calls `estimate` from `src/model/estimate.ts`. This is the only place in the store that does |
| 4 | `derive.ts`, `deriveView` | Builds the `View`, one file per chapter: `derive-data.ts`, `derive-result.ts` and `derive-method.ts` |

`store.ts` runs these four steps and tells the page when the `View` has changed. It is the only file that touches a clock, a timer or the Web Worker.

- **Sentences.** The ones the store words are in `src/app/words.ts`. The ones about sliders, switches, tips and ways to give are beside their data in `src/model/`. Text that never changes is in `index.html` and `src/ui/`.
- **Printing.** Every number and date on the page is printed by a function in `src/format.ts`.

### The stand-in store

`src/app/demo.ts` is a second store with made-up numbers. It shows the page in a chosen state, for example with a result or in the middle of reading an export, without any data. It labels the page "Example figures, not yours".

- With `npm run dev`, add `?demo=` and the name of a state to the address, for example `?demo=cc-done`. The names are in the list `SCENARIOS` in `demo.ts`.
- `npx vite build --mode demo` builds a site that has the same switch. It goes into the folder `dist-demo.local/`, which git ignores.
- `npm run build` leaves the stand-in out: `dist/` holds neither `demo.ts` nor the switch in the address. A test (`src/build.test.ts`) builds the site and checks this.

### Tests

- Tests sit beside the code they test, as `*.test.ts`. Vitest runs them.
- Most tests run in plain Node.js. A test that needs a page says so on its first line and runs in happy-dom, a stand-in for a browser.
- The repository holds no real logs and no real exports. The logs and exports the tests use are made up. They are in the `fixtures/` folders or are built by the tests themselves.
- The estimate is checked against fixed test vectors in `src/model/fixtures/vectors.json`.
- The reader for a pasted reply and the model classes are checked against case files in their `fixtures/` folders.

### Checking the counting script

1. Read [`src/sources/claude-code/count-tokens.py`](src/sources/claude-code/count-tokens.py). Its seven numbered rules are at the top.
2. Run its tests: `npx vitest run src/sources/claude-code`. They write made-up log files into a temporary folder, point the script at that folder, and compare what it prints with totals worked out by hand. They never read a real log folder. A second version of the script in Node.js, `count-tokens.mjs`, must print the same lines.
3. To try it on your own logs, run `python3 src/sources/claude-code/count-tokens.py`. It prints the same few lines the page expects.
4. If you change the script's rules or its output, change the Node.js version and the reader (`answer.ts`) with it, and raise the version in the first line of the output.

## Libraries and licences

The ChatGPT reader uses four libraries, and the page uses two fonts. They are installed from npm, built into the site and served from the site itself, never from another host.

| Library | Used for | Licence |
|---|---|---|
| `@zip.js/zip.js` | Opening the export ZIP | BSD-3-Clause |
| `fflate` | Reading a ZIP inside a ZIP, and a damaged ZIP | MIT |
| `@streamparser/json` | Reading one conversation at a time | MIT |
| `gpt-tokenizer` | Counting tokens in ChatGPT text | MIT |
| Schibsted Grotesk (`@fontsource-variable/schibsted-grotesk`) | The text font | OFL-1.1 |
| JetBrains Mono (`@fontsource-variable/jetbrains-mono`) | The font for figures | OFL-1.1 |

Vite, TypeScript, Vitest and happy-dom are used to build and test. They are not part of the built site.

ai-co2 itself is under the MIT licence. See [`LICENSE`](LICENSE).

## Report a mistake

If an assumption looks wrong, a source says something else than the page claims, or a newer source exists, please open an issue: https://github.com/squaloo-studio/ai-co2/issues

It helps to say:

- which assumption or sentence you mean,
- the source, with a link, and what it says,
- the value you think is right, and why.

Issues are public. Please do not attach your ChatGPT export or your Claude Code logs. They hold your conversations. If the page read your data wrongly, the few lines of totals, or the message the page showed, are enough.
