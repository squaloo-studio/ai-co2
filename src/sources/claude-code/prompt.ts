// The prompt the person copies into Claude Code: the instructions, then the counting script.
// The script is the file count-tokens.py, taken in as text, so what people can read in the
// repository is exactly what the prompt asks Claude to run.

import script from './count-tokens.py?raw';
import nodeScript from './count-tokens.mjs?raw';

const INSTRUCTIONS = `Please count my Claude Code token use for the last 30 days. I need the totals for ai-co2, a web page that estimates the CO2 of AI use.

Run the Python script below exactly as it is. Do not change, shorten or improve it.

- Pass it to Python on standard input, so that no file is created. For example:
  python3 - <<'AI_CO2_END'
  (the script)
  AI_CO2_END
  On Windows, use python or py if python3 is missing.
- The script only reads Claude Code's own log files: the .jsonl files under ~/.claude/projects and ~/.config/claude/projects (or the folder XDG_CONFIG_HOME names), or under CLAUDE_CONFIG_DIR if that is set. It adds up token counts per model and prints a few lines. It writes nothing and connects to nothing.
- Do not open or read the log files yourself. They hold my conversations, and only the totals are needed.
- Do not run anything else, and do not install anything.

If Python 3 is not on this computer, write the same thing in Node.js or PowerShell instead. Follow the numbered rules at the top of the script exactly, print the same lines, and pass your code on standard input too. Add one sentence before the result that says which language you used.

Then reply with the script's output and nothing else: every line it printed, unchanged, inside one code block. Do not round, reformat or explain the numbers. If the script fails, reply with the error message instead. Never guess a number.
`;

/** For tests: the counting script (Python 3.8 or later), exactly as it is inside the prompt. */
export const SCRIPT: string = script;

/**
 * For tests and for later: the same count in Node.js 18 or later. It prints the same lines and is
 * kept as a tested second implementation. The page does not offer it, and the prompt never holds it.
 */
export const NODE_SCRIPT: string = nodeScript;

/** The whole text the person copies. */
export const PROMPT: string = `${INSTRUCTIONS}\n\`\`\`python\n${script}\`\`\`\n`;
