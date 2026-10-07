# ai-co2 token count, v1. Reads Claude Code's own log files and prints totals.
# It opens no network connection and writes no file. Works with Python 3.8+.
# Rules:
#  1. Files: every *.jsonl under <config>/projects, subagents/ folders included. <config> is
#     $CLAUDE_CONFIG_DIR if set, otherwise ~/.claude and ~/.config/claude (or $XDG_CONFIG_HOME/claude).
#  2. Window: the 30 calendar days that end today, in this computer's time zone.
#  3. A usage line is a JSON line with message.usage. Skip the model "<synthetic>".
#  4. One request can be logged several times. Key = message.id + requestId
#     (without a requestId: message.id + sessionId + timestamp).
#     Keep the copy with the highest output_tokens.
#  5. A side conversation can replay a message of the main conversation under a
#     new requestId. If a message.id exists outside a side conversation, drop
#     the copies that exist only inside one (isSidechain is true).
#  6. usage.iterations lists the steps of one request. The top-level numbers
#     leave some steps out: "advisor_message" and "compaction" steps, and, when
#     a "fallback_message" step exists, the "message" steps (attempts that
#     another model declined). Add those under the step's own model.
#  7. Print one line per model, then the sum of all numbers as a check.
import json, os, re, sys
from datetime import date, datetime, time, timedelta
if sys.version_info < (3, 8): sys.exit("This script needs Python 3.8 or later.")
FIELDS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
home = os.path.expanduser("~")
config = os.environ.get("CLAUDE_CONFIG_DIR")
xdg = os.environ.get("XDG_CONFIG_HOME") or os.path.join(home, ".config")
roots = [config] if config else [os.path.join(home, ".claude"), os.path.join(xdg, "claude")]
today = date.today()
first_day = today - timedelta(days=29)
start = datetime.combine(first_day, time.min).timestamp()  # local midnight

def num(value):
    ok = isinstance(value, (int, float)) and not isinstance(value, bool) and 0 < value < 1e15
    return int(value) if ok else 0

def steps_of(usage):
    steps = usage.get("iterations")
    return [s for s in steps if isinstance(s, dict)] if isinstance(steps, list) else []

def logs(top, seen=set()):  # every *.jsonl under top. A folder that links lead back to is walked once.
    for folder, dirs, names in os.walk(top, followlinks=True):
        real = os.path.realpath(folder)
        dirs[:] = [d for d in dirs if real not in seen and not d.startswith(".")]
        yield from (os.path.join(folder, n) for n in names if real not in seen and n.endswith(".jsonl") and not n.startswith("."))
        seen.add(real)

best = {}  # key -> [rank, day, model, usage, advisor model, only in side conversations, has requestId]
for root in roots:
    for path in logs(os.path.join(root, "projects")):
        try:
            if os.path.getmtime(path) < start:
                continue  # not changed since before the window
            with open(path, encoding="utf-8", errors="replace") as lines:
                for line in lines:
                    if '"usage"' not in line:
                        continue
                    try:
                        entry = json.loads(line)
                        message = entry["message"]
                        usage = message["usage"]
                        model = message["model"]
                        stamp = entry["timestamp"]  # UTC, like 2026-10-07T09:30:00.123Z
                        plain = re.sub(r"\.\d+", "", stamp).replace("Z", "+00:00")
                        when = datetime.fromisoformat(plain).astimezone()
                        rank = (num(usage.get("output_tokens")), len(steps_of(usage)), stamp)
                        msg_id = message.get("id")
                        request = entry.get("requestId")
                        key = (str(msg_id), str(request or (entry.get("sessionId"), stamp)))
                    except Exception:
                        continue  # broken line, or not a usage line
                    if when.timestamp() < start or when.date() > today:
                        continue
                    if not isinstance(model, str) or model == "<synthetic>":
                        continue
                    side = entry.get("isSidechain") is True
                    old = best.get(key)
                    if old:
                        side = side and old[5]
                    if not old or rank > old[0]:
                        replay = bool(request) and isinstance(msg_id, str)
                        best[key] = [rank, when.date(), model, usage, entry.get("advisorModel"), side, replay]
                    else:
                        old[5] = side
        except OSError:
            continue  # unreadable file

main_ids = {key[0] for key, kept in best.items() if not kept[5]}
totals, days = {}, []

def add(model, usage):
    # Keep the name to plain letters, digits and . _ : / @ - so the line stays readable.
    name = "".join(c if c.isascii() and (c.isalnum() or c in "._:/@-") else "_" for c in str(model))
    name = (name if name[:1].isalpha() else "m_" + name)[:80]
    row = totals.setdefault(name, [0, 0, 0, 0])
    for i, field in enumerate(FIELDS):
        row[i] += num(usage.get(field))
    return sum(num(usage.get(field)) for field in FIELDS)

for key, (rank, day, model, usage, advisor, side, replay) in best.items():
    if side and replay and key[0] in main_ids:
        continue  # rule 5
    counted = add(model, usage)
    steps = steps_of(usage)
    fallback = any(step.get("type") == "fallback_message" for step in steps)
    for step in steps:  # rule 6
        kind = step.get("type")
        if kind == "compaction":
            counted += add(step.get("model") or model, step)
        elif kind == "advisor_message":
            counted += add(step.get("model") or advisor or "unknown", step)
        elif kind == "message" and fallback:
            counted += add(step.get("model") or "unknown", step)
    if counted:
        days.append(day)

rows = sorted((r for r in totals.items() if sum(r[1])), key=lambda r: (-sum(r[1]), r[0]))
data = "data %s to %s" % (min(days), max(days)) if rows else "data none"
print("ai-co2 v1 | %s to %s | %s" % (first_day, today, data))
for name, (fresh, write, read, out) in rows:
    print("%s | in %d | cache_write %d | cache_read %d | out %d" % (name, fresh, write, read, out))
print("total | %d" % sum(sum(r[1]) for r in rows))
