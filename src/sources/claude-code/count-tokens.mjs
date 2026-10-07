// ai-co2 token count, v1. Reads Claude Code's own log files and prints totals.
// It opens no network connection and writes no file. Works with Node.js 18+.
// Rules:
//  1. Files: every *.jsonl under <config>/projects, subagents/ folders included. <config> is
//     $CLAUDE_CONFIG_DIR if set, otherwise ~/.claude and ~/.config/claude (or $XDG_CONFIG_HOME/claude).
//  2. Window: the 30 calendar days that end today, in this computer's time zone.
//  3. A usage line is a JSON line with message.usage. Skip the model "<synthetic>".
//  4. One request can be logged several times. Key = message.id + requestId
//     (without a requestId: message.id + sessionId + timestamp).
//     Keep the copy with the highest output_tokens.
//  5. A side conversation can replay a message of the main conversation under a
//     new requestId. If a message.id exists outside a side conversation, drop
//     the copies that exist only inside one (isSidechain is true).
//  6. usage.iterations lists the steps of one request. The top-level numbers
//     leave some steps out: "advisor_message" and "compaction" steps, and, when
//     a "fallback_message" step exists, the "message" steps (attempts that
//     another model declined). Add those under the step's own model.
//  7. Print one line per model, then the sum of all numbers as a check.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const FIELDS = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"];
const home = os.homedir();
const config = process.env.CLAUDE_CONFIG_DIR;
const roots = config ? [config] : [
  path.join(home, ".claude"),
  path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "claude"),
];
const now = new Date();
const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29); // local midnight
const pad = (n) => String(n).padStart(2, "0");
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (v) => (typeof v === "number" && v > 0 && v < 1e15 ? Math.floor(v) : 0);
const stepsOf = (usage) => (Array.isArray(usage.iterations) ? usage.iterations : [])
  .filter((s) => s && typeof s === "object" && !Array.isArray(s));

function* logFiles(dir, seen = new Set()) { // a folder that links lead back to is walked once
  let entries = [];
  try {
    const real = fs.realpathSync(dir);
    if (seen.has(real)) return;
    seen.add(real);
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.isDirectory()) { if (!e.name.startsWith(".")) yield* logFiles(full, seen); }
    else if (e.name.endsWith(".jsonl") && !e.name.startsWith(".") && stat.mtimeMs >= start.getTime()) yield full;
  }
}

const best = new Map(); // key -> { rank, day, model, usage, advisor, side, replay }
const higher = (a, b) => { // compares [output, number of steps, time stamp]
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};
for (const root of roots) {
  for (const file of logFiles(path.join(root, "projects"))) {
    try {
      const lines = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.includes('"usage"')) continue;
        let entry, usage, model, when, stamp;
        try {
          entry = JSON.parse(line);
          usage = entry.message.usage;
          model = entry.message.model;
          stamp = entry.timestamp; // UTC, like 2026-10-07T09:30:00.123Z
          when = new Date(stamp);
        } catch { continue; } // broken line, or not a usage line
        if (typeof usage !== "object" || usage === null || Array.isArray(usage)) continue;
        if (typeof stamp !== "string" || Number.isNaN(when.getTime())) continue;
        if (when < start || day(when) > day(now)) continue;
        if (typeof model !== "string" || model === "<synthetic>") continue;
        const id = entry.message.id;
        const request = entry.requestId;
        const key = JSON.stringify([String(id), String(request || [entry.sessionId, stamp])]);
        const rank = [num(usage.output_tokens), stepsOf(usage).length, stamp];
        const old = best.get(key);
        const side = entry.isSidechain === true && (!old || old.side);
        if (!old || higher(rank, old.rank)) {
          const replay = Boolean(request) && typeof id === "string";
          best.set(key, { id: String(id), rank, day: day(when), model, usage, advisor: entry.advisorModel, side, replay });
        } else old.side = side;
      }
    } catch { continue; } // unreadable file
  }
}
const mainIds = new Set();
for (const kept of best.values()) if (!kept.side) mainIds.add(kept.id);

const totals = new Map();
const days = [];
function add(model, usage) {
  // Keep the name to plain letters, digits and . _ : / @ - so the line stays readable.
  let name = String(model).replace(/[^A-Za-z0-9._:\/@-]/g, "_");
  name = (/^[A-Za-z]/.test(name) ? name : "m_" + name).slice(0, 80);
  if (!totals.has(name)) totals.set(name, [0, 0, 0, 0]);
  let added = 0;
  FIELDS.forEach((field, i) => { totals.get(name)[i] += num(usage[field]); added += num(usage[field]); });
  return added;
}
for (const kept of best.values()) {
  if (kept.side && kept.replay && mainIds.has(kept.id)) continue; // rule 5
  let counted = add(kept.model, kept.usage);
  const steps = stepsOf(kept.usage);
  const fallback = steps.some((step) => step.type === "fallback_message");
  for (const step of steps) { // rule 6
    if (step.type === "compaction") counted += add(step.model || kept.model, step);
    else if (step.type === "advisor_message") counted += add(step.model || kept.advisor || "unknown", step);
    else if (step.type === "message" && fallback) counted += add(step.model || "unknown", step);
  }
  if (counted) days.push(kept.day);
}

const sum = (row) => row.reduce((a, b) => a + b, 0);
const rows = [...totals].filter(([, row]) => sum(row) > 0)
  .sort((a, b) => sum(b[1]) - sum(a[1]) || (a[0] < b[0] ? -1 : 1));
days.sort();
const data = rows.length ? `data ${days[0]} to ${days[days.length - 1]}` : "data none";
console.log(`ai-co2 v1 | ${day(start)} to ${day(now)} | ${data}`);
for (const [name, [fresh, write, read, out]] of rows) {
  console.log(`${name} | in ${fresh} | cache_write ${write} | cache_read ${read} | out ${out}`);
}
console.log(`total | ${rows.reduce((a, [, row]) => a + sum(row), 0)}`);
