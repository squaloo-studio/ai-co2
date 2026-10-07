---
name: ai-co2
description: A browser-only tool that turns your AI use into a CO2 range, drawn as a forecast you can change.
colors:
  accent: "#C8F04B"
  accent-press: "#B6DE38"
  accent-deep: "#5E8200"
  on-accent: "#0A1020"
  navy: "#0A1020"
  navy-2: "#111A2F"
  on-navy: "#F4F2EA"
  on-navy-2: "#A9B0C4"
  on-navy-3: "#8A93AA"
  navy-line: "rgba(255,255,255,.09)"
  ink: "#0B1222"
  ink-2: "#4A5168"
  ink-3: "#666B80"
  paper: "#FFFFFF"
  paper-2: "#F3F4F6"
  card: "#FFFFFF"
  line: "#E5E7EB"
  line-2: "#D1D5DB"
  ok: "#16794F"
  ok-soft: "#E3F1E9"
  bad: "#B42318"
  bad-line: "#D4483B"
  bad-soft: "#FBEAE7"
typography:
  readout:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "88px"
    fontWeight: 800
    lineHeight: 0.86
    letterSpacing: "-0.04em"
    fontFeature: "lining-nums"
  display:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "76px"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "46px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.035em"
  title-xl:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.035em"
  title-lg:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  statement:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  lede:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "21px"
    fontWeight: 400
    lineHeight: 1.45
  body:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
  mono-number:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tabular-nums"
  mono-code:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.65
  mono-tick:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1
rounded:
  xs: "6px"
  sm: "12px"
  md: "14px"
  card: "18px"
  panel: "22px"
  pill: "999px"
spacing:
  page-margin: "32px"
  page-margin-phone: "16px"
  page-max: "1200px"
  chapter: "96px"
  chapter-first: "88px"
  intro-top: "88px"
  head-to-figure: "28px"
  head-gap: "28px"
  side-notes: "320px"
  caption-gap: "14px"
  list-row: "11px"
  grid-cell: "44px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    height: "42px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.accent-press}"
  button-line:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "38px"
    padding: "0 16px"
  button-line-hover:
    backgroundColor: "{colors.paper-2}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.on-navy-2}"
    rounded: "{rounded.pill}"
    height: "42px"
    padding: "0 20px"
  button-quiet-hover:
    textColor: "{colors.on-navy}"
  switch:
    rounded: "{rounded.pill}"
    width: "44px"
    height: "26px"
  chip-checked:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "26px"
    padding: "0 11px"
  chip-problem:
    backgroundColor: "{colors.bad-soft}"
    textColor: "{colors.bad}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "26px"
    padding: "0 11px"
  chip-waiting:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "26px"
    padding: "0 11px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  title-mark:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "0.14em"
    padding: "0 0.12em"
  choice-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px 16px 30px"
  choice-scene:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.on-navy-2}"
    rounded: "{rounded.md}"
    height: "170px"
    padding: "0 28px"
  choice-button:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    height: "46px"
    padding: "0 22px"
  choice-button-hover:
    backgroundColor: "{colors.accent-press}"
  tool-box:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  tool-box-header:
    backgroundColor: "{colors.card}"
    padding: "20px 32px"
  tool-box-body:
    backgroundColor: "{colors.card}"
    padding: "30px 32px"
  tool-box-notes:
    backgroundColor: "{colors.card}"
    width: "320px"
    padding: "32px"
  tool-icon:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.on-navy}"
    rounded: "{rounded.sm}"
    size: "44px"
  result-panel:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.on-navy}"
    rounded: "{rounded.panel}"
    padding: "38px 46px 24px"
  floating-pill:
    backgroundColor: "rgba(10,16,32,.9)"
    textColor: "{colors.on-navy}"
    rounded: "{rounded.pill}"
    height: "58px"
    padding: "0 9px 0 22px"
  prompt-block:
    backgroundColor: "{colors.navy}"
    textColor: "#DCE1EE"
    typography: "{typography.mono-code}"
    rounded: "{rounded.md}"
    padding: "16px 20px"
  answer-field:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-code}"
    rounded: "{rounded.md}"
    padding: "14px 16px"
  drop-zone:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "28px 20px"
  save-mark:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.xs}"
  delta-chip:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.mono-number}"
    rounded: "{rounded.pill}"
    padding: "5px 8px"
  step-number:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "32px"
  inline-code:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xs}"
---

# Design System: ai-co2

Recorded from the finished mock at `design/boards/playground.html`, in the look the maintainer chose: dot chart, floating pill, lime accent, Schibsted Grotesk headings, navy result panel, white page, roomy spacing, and a lime highlight on "CO₂" in the page title.

## Overview

**Creative North Star: "The Forecast Desk"**

ai-co2 reads like a short printed report with one live instrument in the middle of it. The report part is white, calm and typographic: five chapters, each with a heavy heading in the left half and a plain explanation that starts on the page's centre line, followed by a figure and a caption. The instrument is the result: a deep navy panel with a faint grid, where your footprint is drawn as 100 possible outcomes on a scale. It is a forecast, so it is always a range, and it visibly re-settles whenever you change anything on the page.

Colour is rationed. The page is navy-black ink on white with grey hairlines. Lime appears only where there is data to point at: the likely outcomes, the middle estimate, a saving, a change, and the one main action in a card. It appears once more in the page title, as a block behind "CO₂", the thing being measured. Green and red are kept for "this was read correctly" and "this could not be read". Nothing on the page uses red, size or motion to make the amount of CO2 feel like an alarm.

The page works with one tool at a time. You pick Claude Code or ChatGPT, and from then on every chapter shows that tool only.

The system is dense without being cramped. Chapters sit 96px apart, but inside a chapter things are tight: hairline lists, small captions, numbers in a mono face. Depth is almost absent. Cards carry one soft shadow, and only the pinned pill really floats.

The direction contract described warm paper and 16px card corners. The build landed on a white page and 18px card corners, with warmth kept only in the cream text on navy. The build is what this file records.

Also tried in the playground and dropped: a band chart and a curve chart for the result, a top strip and a side column for the pinned result, an aqua accent, Archivo and Bricolage Grotesque headings, a light result panel, a warm paper background, compact spacing, and an underlined or plain page title. An earlier build stacked two tool cards that could both be filled in; that is gone too.

**Key Characteristics:**
- A white report page with one navy instrument panel.
- The result is always a range, drawn as 100 dots on a labelled scale.
- Lime marks data and the one main action in a card, plus "CO₂" in the page title.
- One tool at a time: Claude Code or ChatGPT, never both.
- Heavy, tight headings in the left half; plain explanations starting on the centre line.
- Hairlines instead of boxes inside cards.
- One change moves every number on the page at once, and leaves a trace of where it was.

## Colors

Navy-black ink on white, grey hairlines, one deep navy panel, and a single lime that points at data.

### Primary
- **Signal Lime** (`accent`): the likely dots in the chart, the highlight behind the middle estimate, the highlight behind a saving, the change chip, the small dot in the pinned pill, the "after" bar in a tip, the block behind "CO₂" in the page title, the main button in a card ("Use Claude Code", "Use ChatGPT", "Copy prompt"), text selection, and the focus ring on navy. On navy it is also a text colour for sample data: the answer lines and the file name in the two choice scenes. Its pressed and hover shade is `accent-press`.
- **Navy on Lime** (`on-accent`): the only text colour allowed on lime.
- **Deep Lime** (`accent-deep`): the lime family's dark member, for data shapes drawn on white where Signal Lime would be too pale to see. In the chosen look it draws the outline and soft fill of the small "now" range bar in a tip.

### Secondary
- **Instrument Navy** (`navy`): the result panel, the pinned pill (at 90% opacity over a blur), the prompt block, the scene at the top of each choice card, and the square icon tile beside the chosen tool's name.
- **Navy Step** (`navy-2`): the button row under the prompt block.
- **Cream on Navy** (`on-navy`): main text and the middle estimate marker on navy. `on-navy-2` is for supporting text, `on-navy-3` for the quietest text, axis labels and the hollow dots.
- **Navy Hairline** (`navy-line`): dividers and the 1px edge on navy surfaces.

### Tertiary
- **Checked Green** (`ok` on `ok-soft`): a source was read and the numbers look plausible. Used in the status chip and the one-line confirmation.
- **Problem Red** (`bad` on `bad-soft`, border `bad-line`): an answer or file could not be read. Used in the status chip, the field or drop zone border, and the message under it.

### Ink, surfaces and lines
- **Ink** (`ink`): headings, body text, the default focus ring, slider fill, share bars, the progress bar, and the edge of a choice card under the pointer.
- **Ink 2** (`ink-2`): explanations, captions, list text.
- **Ink 3** (`ink-3`): the quietest text: sources, hints, table headers, placeholder text, the "Runs in your browser" line.
- **Page White** (`paper`) and **Card White** (`card`): the page and its cards. They are the same white in the chosen look and stay separate tokens so they can part again.
- **Soft Grey** (`paper-2`): the fill behind inline code, the formula block, step numbers, and a hovered line button or drop zone.
- **Hairline** (`line`): every divider and the 1px edge of a card. **Hairline Strong** (`line-2`): edges of controls: line buttons, the answer field, the drop zone, step numbers.

### Named Rules
**The Lime Means Data Rule.** Lime marks a likely outcome, the middle estimate, a saving, a change, or the one main action in a card. In headings it appears exactly once: the block behind "CO₂" in the page title, which names the thing being measured. It is never a section background, the colour of a heading's letters, or decoration.

**The Navy Text On Lime Rule.** Text on lime is always `on-accent`. Lime is never used as a text colour on white; as text it appears only on navy, for sample data.

**The Calm Number Rule.** Red belongs to things that could not be read. The amount of CO2 is never shown in red, however large it is.

**The Green Means Checked Rule.** Green says a source was read correctly. It is not used to say something is good for the climate.

## Typography

**Display Font:** Schibsted Grotesk (with ui-sans-serif, system-ui, sans-serif)
**Body Font:** Schibsted Grotesk (with ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)

**Character:** One grotesque does both jobs: very heavy and tightly set for headings, regular and open for reading. JetBrains Mono carries the small numbers, so figures read as measured values and line up in columns. Both are free fonts.

### Hierarchy
- **Readout** (800, 88px, line-height 0.86, -0.04em, lining figures): the range itself, "3.7–34 kg". Drops to 60px on phones. The unit is 38% of the size, weight 700, in the supporting text colour.
- **Display** (800, 76px, 0.95, -0.04em): the page title, with "CO₂" on a lime block. 46px on phones.
- **Headline** (800, 46px, 1.0, -0.035em): chapter headings. The empty result uses the same style at 40px.
- **Title Extra Large** (800, 34px, 1.0, -0.035em): the tool name on each choice card.
- **Title Large** (800, 24px, 1.1, -0.03em): tip headings and the three contribute options.
- **Title** (800, 18px, 1.25, -0.015em): side notes, step headings, list headings, the heading over the switches in the result card. The chosen tool's name in the box header uses 22px at -0.025em.
- **Statement** (600, 23px, 1.3, -0.015em): the "Middle estimate: 9.8 kg" line under the readout. 20px on phones.
- **Lede** (400, 21px, 1.45): the one sentence under the page title, at most 52 characters wide, in Ink 2. 18px on phones.
- **Body** (400, 17px, 1.55): chapter explanations (at most 56 characters wide), the sentence on a choice card (at most 40) and tip text (at most 62).
- **Body Small** (400, 15px, 1.5): captions, hairline lists, option details, the status summary. Step text and tip how-tos sit at 15.5px, messages and the "Runs in your browser" line at 14.5px.
- **Label** (600, 13px): status chips, source lines, the dashed tag. Buttons use 600 at 15px (14.5px on line buttons, 16px on the choice button). "Apply this tip" and the chart's "middle estimate" label use 600 at 14px. Table headers and detail labels use 600 at 12.5px.
- **Mono Number** (600, 12 to 14px, tabular): readouts in the chart bracket, slider values, the change chip, step numbers. The sample lines in the choice scenes use the same face at 400, 13px.
- **Mono Code** (400, 12.5px, 1.65): the prompt and the pasted answer. Inline code is 500 at 0.86em.
- **Mono Tick** (500, 11.5px): axis labels and slider scale ends. This is the smallest text in the system; nothing goes below it.

The wordmark is the name set in Schibsted Grotesk 900 at 23px, -0.04em.

### Named Rules
**The Big Numbers Are Headings Rule.** A number you are meant to read from across the room (the range, the pill's range) is set in the heading font. A number you read up close (tokens, shares, ticks, prices for your range) is set in JetBrains Mono with tabular figures.

**The Small Numbers Keep A Decimal Rule.** A kilogram value under 10 shows one decimal (0.6, 1.8, 6.5), and a whole value drops the ".0" (5). From 10 up, kilograms are whole numbers. Euros follow the same idea, with two decimals under 1. Distances are rounded to the nearest 10 km.

**The Sentence Case Rule.** Headings, labels and buttons are sentence case. No all-caps, no wide letter-spacing.

**The Balanced Heading Rule.** Headings wrap with balanced lines and negative tracking that grows with size: -0.015em at 18px up to -0.04em at 76px and above.

## Layout

The page is a single column, 1200px at most, with 32px side margins (16px on phones). It is laid out like a report.

**Header and intro.** A thin header holds the wordmark on the left and two text links on the right, with a hairline under it. The intro is one column, starting 88px below the header (48px on phones): the big page title with a lime block behind "CO₂", one sentence in Lede 24px under it, then, 20px lower, the "Runs in your browser. Nothing is uploaded." line with a small lock icon in Ink 3.

**Chapters.** There are five: Your data, Your result, Ways to cut, Fund carbon removal, How it's calculated. Each starts 96px below the last (88px for the first). Each opens with a head of two equal columns, 28px apart and lined up on their bottom edge: the heading in the left half, and a short explanation in Ink 2 that starts on the page's centre line. The content starts 28px below the head.

**Figures and captions.** A chapter's main content is a full-width figure: the result panel, the tips card, the options card, the method card. Under it, 14px below, sits a caption in Body Small, Ink 2, at most 78 characters wide. A caption opens with one bold sentence in Ink that says what to take from the figure ("How to read it.", "Each saving is a range too.", "Estimates, not measurements.").

**Your data.** The chapter is an either/or choice. Before the choice, two equal cards sit side by side, 28px apart, with nothing pre-selected, and the "What leaves your computer" note runs full width 40px under them. After the choice, one box replaces the cards: a header row, then the chosen tool's steps on the left and the same note in a 320px column on the right, behind a vertical hairline.

**Side notes.** A side note is a Title heading over a hairline list. It has no box and no background of its own.

**Hairline lists.** Lists, toggles, table rows and tips are separated by 1px lines, not boxed. A list row has 11px of padding above and below, a line on top, Body Small text in Ink 2, and an optional bold lead-in in Ink. Toggle rows use 13px. Columns inside a card (the three contribute options, the notes column in the data box) are divided by a vertical hairline.

**Inside the result panel.** Padding is 38px top, 46px sides, 24px bottom. The top row is the readout on the left and a block of switches on the right in a column 280 to 360px wide, 56px apart. The chart runs the full width below.

**Responsive changes.**
- Below 1100px: the switches in the result card drop under the readout; the three sliders stack.
- Below 900px: chapter heads, the data box and the counted/left-out lists become one column, and the notes move under the steps with a hairline on top; the three options stack and swap their vertical hairlines for horizontal ones; tips stack, with the switch on the left.
- Below 640px: margins become 16px, the header links hide, the title, lede and readout shrink, the two choice cards stack, the box header wraps, the result panel tightens to 26px/20px padding with 18px corners, and the pinned pill spans the screen width.

The page keeps 120px of empty space at the bottom so the pinned pill never covers the footer.

### Page states

The page has five states, and each one belongs to the chosen tool. Only what is listed changes.

- **First visit (the choice).** Two choice cards, nothing selected, both lines of the "What leaves your computer" note under them. The result panel shows a Headline-style line, "Your range will land here", one sentence that says to pick a tool, and an empty scale. Ways to cut and Fund carbon removal are not shown. How it's calculated stays. The pinned pill never appears.
- **Steps.** The box shows the chosen tool with a dashed "Waiting" chip and its steps open. The note keeps only the lines about that tool. The result panel stays empty, and the two chapters that depend on a result are not shown. Choosing a tool, or switching tools, always lands here.
- **Loading (ChatGPT only).** The steps and the drop zone give way to a progress bar (8px, Ink on a faint track) with a plain sentence that counts conversations, and the chip reads "Reading". Claude Code has no loading state; it stays on Steps.
- **Error.** The chip turns red with a warning icon and "Needs a look". The answer field or the drop zone gets a red border, and a red message under it says what is wrong and what to do next. The result panel stays empty.
- **Done.** The steps fold away. The box shows a green chip ("Counted" or "Read"), a one-line summary, and a line button to redo the step. Every chapter is shown for that tool only: its switches in the result card, its tips, and for ChatGPT the full-history line. The pinned pill appears once the result has scrolled away.

### Named Rules
**The One Tool At A Time Rule.** The page works with Claude Code or ChatGPT, never both. Before the choice the two are equal and neither is pre-selected. After it, the other tool is one "Switch to …" button away and nothing of it stays on the page.

**The Heading Left, Explanation On The Centre Line Rule.** Every chapter opens with two equal columns: the heading in the left half, a short explanation starting on the page's centre line. The explanation is plain sentences, never a second heading.

**The Figure Gets A Caption Rule.** A chart or a card that carries numbers gets a caption that opens with one bold sentence saying how to read it.

**The Hairline Rule.** Inside a card, things are separated by 1px lines and space. A card never sits inside another card.

## Elevation & Depth

The system is close to flat. Surfaces are told apart by a 1px inner edge and by colour (white, soft grey, navy), not by stacked shadows. Glass (a blurred, see-through background) is used in exactly one place, the pinned pill.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 2px rgba(11,18,34,.05), 0 12px 32px -18px rgba(11,18,34,.22)`): every white card and the result panel, always together with the 1px inner edge.
- **Lift** (`box-shadow: 0 2px 4px rgba(11,18,34,.06), 0 24px 44px -22px rgba(11,18,34,.35)`): a choice card under the pointer only, together with a 1.5px Ink inner edge and a 3px rise.
- **Float** (`box-shadow: 0 20px 44px -18px rgba(10,16,32,.6), 0 2px 8px rgba(10,16,32,.2)`): the pinned pill only.
- **Inner edge** (`box-shadow: inset 0 0 0 1px` in Hairline, Hairline Strong or Navy Hairline): the border of cards, line buttons, step numbers, inline code and the result panel.
- **Field focus** (`box-shadow: 0 0 0 3px rgba(11,18,34,.08)`): the soft ring around the focused answer field, with its border turned Ink.

### Named Rules
**The One Thing Floats Rule.** Only the pinned pill uses the Float shadow and glass. Everything else rests on the page. The two choice cards rise 3px while the pointer is over them and settle back.

## Shapes

Soft, round and friendly, in three sizes. Small things inside text have 6px corners (inline code, the saving highlight; 7px on the middle estimate highlight; the title's lime block scales with the type at 0.14em). Blocks inside a card have 12 to 14px corners (icon tile, formula block, prompt block, answer field, drop zone, the scene on a choice card). Cards have 18px corners; the result panel and the two choice cards have 22px. Every control is a full pill or a circle: buttons, switches, chips, tags, step numbers, the pinned pill, bars and tracks.

Lines are 1px for dividers and 1.5px for anything drawn as data or state: the chart marker, the bracket, hollow dots, the switch outline, dashed tags.

Icons are simple outlined drawings on a 24px grid with a 1.75px rounded stroke, shown at 20px (15px inside chips and tags). They always sit beside words.

### Named Rules
**The Dashed Means Not Final Rule.** A dashed line always means "not settled yet": a source that is waiting, a tip that is switched on to try, the place to drop a file, and the ghost of where the range was a moment ago. Solid lines are for what is true now.

**The Shape Plus Words Rule.** A state is never shown by colour alone. Checked is a filled green chip with a tick and a word. Waiting is a dashed outline with a clock and a word. A problem is a red chip with a warning sign and a word. Unlikely outcomes are hollow dots; likely ones are filled.

## Components

Controls are quiet pills that stay out of the way of the numbers. State changes take 0.15s. Larger movements use one easing (`cubic-bezier(.16,1,.3,1)`) and 0.75s. With reduced motion switched on in the system, every change is instant.

### Buttons
- **Shape:** full pill (999px), 42px high, 20px side padding, 600 at 15px, 9px between icon and label. Pressing nudges it down 1px.
- **Primary:** Signal Lime with Navy on Lime text. Hover goes to `accent-press`. One per card at most: "Copy prompt" in the steps, and the "Use …" button on each choice card.
- **Line:** Card White with a 1px Hairline Strong inner edge, Ink text, 38px high, 16px padding, 14.5px. Hover fills Soft Grey. This is the default button: switching tools, redoing a step, leaving for a provider, resetting sliders.
- **Quiet:** no background, `on-navy-2` text, for navy surfaces only. Hover adds a faint white wash and Cream text.
- **Round:** a 40px circle with a faint white wash, on the pinned pill, holding one icon and a spoken label.
- **Focus:** a 2px Ink outline, 3px away from the control. On navy surfaces the outline is Signal Lime.

### Switches
- **Style:** 44 by 26px pill with a 1.5px outline and a 17px knob, both drawn in the surrounding text colour at reduced strength. On: the track fills with the text colour and the knob takes the surface colour and slides 18px. So a switch is navy-on-white on the page and cream-on-navy in the result panel, with no lime.
- **State:** a disabled switch drops to 40% opacity. No current page state disables one.
- **Row:** a switch sits at the right end of a hairline row. The label is 600 at 15.5px, with a 13px line under it: a source with a small icon ("Typical setting", "Set from your export") or a saving ("Saves roughly 1–5 kg a month").
- **Beside a tip:** the label "Apply this tip" (600 at 14px, Ink 2) sits to the left of the switch, with no row line.

### Chips
- **Checked:** `ok-soft` fill, `ok` text, tick icon. 26px high, 600 at 13px. Reads "Counted" for Claude Code and "Read" for ChatGPT.
- **Problem:** `bad-soft` fill, `bad` text, warning icon. Reads "Needs a look".
- **Waiting / Reading:** no fill, 1.5px dashed Hairline Strong outline, Ink 2 text, clock icon.
- **Dashed tag** under the readout: a pill with a 1.5px dashed lime outline and an eye icon, 600 at 13.5px. It appears while a tip is switched on and names it ("With: Sonnet for routine work", or "With 2 tips applied").

### Choice cards
The first-visit choice. Two cards of equal size and weight, Claude Code and ChatGPT, and each whole card is one button.
- **Shape:** Card White, 22px corners, Card shadow with the 1px inner edge. Padding is 16px, and 30px at the bottom. The three parts sit 24px apart.
- **Scene:** a navy block at the top, 170px high, 14px corners, with the result panel's 44px grid. It is a small picture of what you will do. Claude Code shows three mono lines at 13px: the prompt in the supporting cream, and two answer lines in lime. ChatGPT shows a file name with a file icon in lime, inside a dashed lime outline (1.5px, 14px corners), centred. Scenes are pictures only and are hidden from screen readers.
- **Text:** the tool name in Title Extra Large, then one sentence in Body, Ink 2, at most 40 characters wide.
- **Button:** a lime pill, 46px high, 22px side padding, 600 at 16px, with an arrow: "Use Claude Code", "Use ChatGPT".
- **Hover:** the card rises 3px over 0.25s, its edge turns Ink at 1.5px and it takes the Lift shadow. The lime pill darkens to `accent-press` and its arrow moves 4px to the right. The file in the ChatGPT scene rises 4px.
- **On phones:** the two cards stack.

### Chosen tool box
After the choice, one card (18px corners) that shows that tool only.
- **Header:** a 44px navy icon tile with 12px corners (a terminal for Claude Code, a speech bubble for ChatGPT), the tool's name at 22px, and at the far right a line button that reads "Switch to ChatGPT" or "Switch to Claude Code". Padding is 20px by 32px, with a hairline under it.
- **Body:** two columns under the header. On the left, 30px by 32px of padding around a status line (chip plus a one-line summary in Body Small) and the steps under a hairline. On the right, the "What leaves your computer" note in a 320px column with 32px of padding, behind a vertical hairline. The note lists only what applies to the chosen tool, plus what happens afterwards.
- **Claude Code steps:** two numbered steps. Each has a 32px Soft Grey circle with a mono number, then a Title heading and text at most 64 characters wide. Step 1 holds the prompt block, step 2 the answer field.
- **ChatGPT steps:** a plain numbered list of three short lines at 15.5px in Ink 2, with the menu path in bold Ink, then the drop zone.
- **Done:** the steps fold away and a line button appears beside the status line ("Paste a new answer", "Drop a new export") to open them again.

### Inputs / Fields
- **Answer field:** white, 14px corners, 1.5px Hairline Strong border, Mono Code text that does not wrap. Focus turns the border Ink and adds the soft ring. In a problem state the border turns `bad-line` and a red message with a warning icon appears under it. When the answer checks out, the message is replaced by a green one-line confirmation and a small table.
- **Drop zone:** 14px corners, 1.5px dashed border, centred upload icon, a bold line and a hint. Hover, or a file dragged over it, turns the border Ink and fills Soft Grey. A problem turns the border `bad-line`.
- **Sliders:** a 6px track filled Ink up to the thumb, a 22px white thumb with a 2px Ink ring, the label and a mono value above, mono scale ends with "typical" in the middle below, and a source line in Ink 3.
- **Progress bar:** 8px pill, Ink fill, with a plain sentence under it.

### Navigation
The wordmark on the left and two text links on the right in Ink 2 at 15px. Hover turns them Ink and underlines them. On phones the links are hidden. The page has no menu and no second page.

### Title highlight
One word in the page title, "CO₂", sits on a Signal Lime block with Navy on Lime letters. The block has 0.12em of side padding and 0.14em corners, so it grows and shrinks with the title. It is used once on the page.

### Prompt block
A navy block with 14px corners that holds the prompt in Mono Code. Folded, it shows about five lines and fades into the navy. Below a hairline, on `navy-2`, sit the primary "Copy prompt" button and a quiet "Show all" button.

### Result panel (signature)
The navy instrument. 22px corners, a faint 44px square grid in the background, a 1px Navy Hairline edge.
- **Readout:** the range in Readout style, a one-line description that names the tool, then the Statement line "Middle estimate:" with the value on a lime highlight. Under it, a car comparison (also a range) in `on-navy-2`, and for ChatGPT the full-history line in `on-navy-3`.
- **Switches inside the card:** to the right of the readout sits one block with a Title heading, a one-line note, and a hairline list of switches. For ChatGPT it is "Hidden work in ChatGPT", with three switches for work the export does not show, each with its source. For Claude Code it is "Try a change", with the two tips as switches, each with its saving. These are the same switches as the ones beside the tips: flipping either one flips both.
- **Dot chart:** 100 dots, each one possible outcome, stacked in columns over a kilogram scale. The middle 90 are filled lime. The 5 lowest and 5 highest are hollow rings. Dots are 12px (10px in narrow panels, 8px on phones). A 1.5px cream line marks the middle estimate, with the label "middle estimate 9.8 kg" beside it. Under the axis, a bracket spans the likely range and says "90 of 100 land here: 3.7–34 kg". The axis has six ticks with Mono Tick labels.
- **The scale** has fixed steps (10, 20, 50, 100, 200, 500, 1000 kg) and moves to the next step only when the range no longer fits. Outcomes beyond the end stack in a narrow gutter past a dashed stretch of axis.
- **When something changes:** the dots slide to their new places over 0.75s, each starting a hair after the last. A dashed ghost of the old marker and bracket stays for about 1.4s. A lime change chip ("−2 kg") appears beside the label for 2.6s. The numbers count across to their new values. While a tip is switched on, the ghost stays and the dashed tag names the tip.
- **Empty:** one Headline-style sentence, one line of help, and the empty scale.

**The Chip Matches The Screen Rule.** The change chip always equals the difference between the two numbers the reader can see: the middle estimate as it was shown before and as it is shown now. It never uses a hidden decimal. If the shown number did not change, no chip appears.

### Floating pill (signature)
The pinned copy of the result. It appears at the bottom centre, 22px up, once the result panel has scrolled out of view, and only in the Done state. 58px high, navy at 90% over a blur, Float shadow. It holds the range (800 at 20px), "middle estimate 13" with a small lime dot, a 150px mini range bar, and a round button back to the result. When the result changes, its edge flashes lime for about a second and the change chip pops up above it. On phones it spans the screen with 12px margins, is 54px high, and drops the words "middle estimate".

### Mini range bar
A 6px track with a band for the likely range and a 12px lime pin at the middle estimate. It is used in the floating pill and in a tip's "now" and "after" comparison, where the "after" band is solid lime with a 1.5px Ink edge.

### Tips
A hairline list inside one card, showing the chosen tool's tips only. Each tip has a Title Large heading that states a finding, a paragraph with the saving on a lime highlight, and a "How:" line with inline code. On the right sits an "Apply this tip" switch. Switching it on changes the range everywhere on the page: the result card, the pill, the car comparison and the costs. Switching it off goes back. The first Claude Code tip also shows two mini range bars, "Now" and "Sonnet", each with its range in mono.

### Contribute options
Three columns in one card, divided by vertical hairlines. Each names the kind of contribution and the provider, lists price, minimum, what you get and the cost for your range as label-over-value pairs, and ends with a line button that leaves the site (with an arrow icon).

### Method
A folded card. Closed, it is a single bold row with a chevron. Open, it shows the formula in a Soft Grey mono block, two hairline lists (Counted, Left out), three sliders, and a footer row with the extreme range and a reset button.

## Do's and Don'ts

### Do:
- **Do** show the result as a range with the middle estimate beside it, everywhere it appears: panel, pill, tips, costs.
- **Do** call the marker the "middle estimate", and explain it as half of the outcomes below, half above.
- **Do** make the first step an either/or choice between two equal cards, with nothing pre-selected, and show one tool only after that.
- **Do** open every chapter with the heading in the left half and a short explanation starting on the centre line, then a figure with a caption that starts with a bold sentence.
- **Do** keep lime for data and the one main action in a card, with `on-accent` text on it.
- **Do** separate things inside a card with 1px hairlines and space.
- **Do** give every state a shape, an icon and a word as well as a colour.
- **Do** use a dashed line for anything not final: waiting, a tip being tried, drop here, where it was.
- **Do** move every linked number together when one control changes, and leave a ghost and a change chip so the move can be followed.
- **Do** make the change chip equal the difference between the two numbers shown on screen.
- **Do** show one decimal on kilogram values under 10.
- **Do** set close-up numbers in JetBrains Mono with tabular figures.
- **Do** keep every control a pill or a circle, cards at 18px corners, and the result panel and choice cards at 22px.
- **Do** respect reduced motion: all movement becomes instant, and the ghost stays a little longer (2.6s) to make up for it.

### Don't:
- **Don't** show the result as one number on its own.
- **Don't** use red, or any warning styling, for the amount of CO2. Red is for input that could not be read.
- **Don't** use lime for section backgrounds, heading letters or decoration, and don't set lime text on white. The block behind "CO₂" in the page title is the only lime in a heading.
- **Don't** show both tools at once, pre-select one, or bring back tabs or stacked tool cards.
- **Don't** put a card inside a card.
- **Don't** use glass or the Float shadow on anything but the pinned pill.
- **Don't** set text smaller than 11.5px.
- **Don't** use all-caps or wide-tracked labels.
- **Don't** borrow the "Almanac" look of the studio's own website. This tool has its own style.
- **Don't** write on-page wording that breaks the word list in PRODUCT.md, Brand Commitments.
