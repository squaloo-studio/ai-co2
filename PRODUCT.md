# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Undecided. The stack is chosen after the design is settled (the maintainer's decision). Whatever is chosen must run entirely in the browser and deploy as a static site on GitHub Pages under a sub-path, so internal links stay relative.

## Users

Two groups, with equal weight:

- **Everyday chat users** (ChatGPT in v1) who wonder what their AI use costs the climate. Most have never seen a token count.
- **Heavy coding-agent users** (Claude Code in v1) who spend hundreds of millions of tokens a month and want a number they can trust, and ways to bring it down.

Their job: find out roughly how much CO2 their AI use over the last 30 days caused, understand what drives it, cut it, and, if they want, fund carbon removal.

## Product Purpose

ai-co2 is a free, open-source, browser-only tool. It estimates the CO2 of someone's AI use over the last 30 days from data they already have, then helps them cut it, and optionally points them to ways of funding carbon removal.

Success: the person leaves knowing their range, what drives it, two or three concrete ways to cut it, and what a contribution would actually buy.

## Positioning

- It reads real usage instead of asking people to guess: Claude Code token counts (through a copy-and-paste prompt) and the ChatGPT data export (read in the browser).
- The result is always a range, never one number. Every assumption is visible, sourced, dated and adjustable.
- Cut first, contribute second. A contribution is never presented as cancelling out emissions.
- Free and MIT-licensed, with no accounts, no uploads and no commissions.

## Operating Context

- **Claude Code:** the person copies a prompt from the page and pastes it into Claude Code, in the terminal or an IDE. Claude counts the last 30 days read-only and prints a short fixed-format answer: one line per model with fresh input, cache write, cache read and output tokens, plus the date range. The person pastes that answer back. The page rejects answers that don't match the format and checks that the numbers are plausible.
- **ChatGPT:** the person requests the official data export (the download link expires after 24 hours), downloads the ZIP and drops it onto the page. The page reads it in the browser. 2026 exports can be split into several JSON files and multi-part ZIPs.
- **One visit:** nothing is remembered between visits, and closing the tab clears everything.

## Capabilities and Constraints

- **Sources:** v1 covers Claude Code and ChatGPT. Cursor (usage CSV) and Claude.ai (export) come next, then Codex CLI and Gemini CLI.
- **One page, one tool at a time.** It opens with an either/or choice between Claude Code and ChatGPT, as two equal cards with nothing pre-selected. The page then works with the chosen one only, and the two are never combined.
- **The result appears** as soon as the chosen tool's data is in.
- **Page order:** your data (the choice, then that tool's steps), the result with its switches, 2–3 personal cut tips, three contribute options, then "How it's calculated", folded at the bottom.
- **The result** is a range bar (for example "3.7–34 kg") with a marker at the middle estimate (9.8 in the example): half of the possible outcomes are below it and half above. It is pinned on screen and moves visibly whenever anything changes. The car comparison is also a range.
- **Ranges:** the likely range is the 5th–95th percentile. The extreme range (every low or every high assumption combined) lives in the method section.
- **Hidden work** that exports don't show (thinking, hidden instructions and memory, search results and file contents) is added through toggles the person controls. Each toggle says "set from your export" or "typical setting".
- **Controls by place:** switches sit inside the result card. For ChatGPT they are the hidden-work toggles; for Claude Code, whose counts are complete, they are the cut tips. Science assumptions are sliders in the folded method section, each with its source and date.
- **Time span:** the last 30 days for either tool. ChatGPT's full history appears as a second line.
- **Cut tips** are picked from the person's own numbers, each with an estimated saving range and an "Apply this tip" switch that shows the saving on the result.
- **Contribute options:** three, one per kind: lasting removal, EU avoidance and a donation fund. Each shows its price, minimum, what you actually get and a "last checked" date. The range becomes a money range, and people choose.
- **Large exports** are streamed in a Web Worker.
- **Language:** English only.
- **Not in v1:** browser extension, live tracking, accounts, payments, water, Gemini chat, sharing results, remembering anything between visits, German.

## Brand Commitments

- **Name:** ai-co2, a Squaloo Studio project.
- **Words:** never "offset", "neutral", "compensated", or anything about what someone owes. Contributions follow the Oxford Offsetting Principles (a contribution, not compensation) and the spirit of EU Directive 2024/825.
- **Voice:** plain language. Honest about uncertainty, and says which unknown matters most.
- **Visual:** the tool has its own style, with no resemblance to the "Almanac" look of the studio's own website. The maintainer chose improvability.ai's AI Emissions Tracker as inspiration for how it should feel, not as something to copy. Fonts must be free, and the heading font and accent colour are our own.
- **Anti-references:** an alarming or guilt-tripping tone; a cold dashboard that only engineers can read; a generic startup page with nothing of its own.

## Evidence on Hand

- The estimate method, factor tables and sources, verified 27–28 Sep 2026, are in the maintainer's plan, to be moved into `docs/`.
- The contribute options' prices and minimums were checked 28 Sep 2026.
- Example numbers are made up and labelled as an example. The repository holds no real usage data.
- There are no users, testimonials, press or partner claims. Don't invent any.

## Product Principles

1. **An honest range beats false precision.** Show the spread, and what drives it.
2. **Inform, never shame.** No alarm, no guilt and no debt language.
3. **Cut first, contribute second.** Saving comes before spending.
4. **Your data stays yours.** It's read in the browser. Nothing is uploaded, and nothing is remembered.
5. **Readable by everyday chat users, deep enough for engineers.** The detail lives in the folded method section.
