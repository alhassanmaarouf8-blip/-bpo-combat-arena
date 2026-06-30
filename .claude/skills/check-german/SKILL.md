---
name: check-german
description: Quality-gate the German the app teaches — run boss/scenario/lesson German through LanguageTool (free) to catch real grammar/spelling errors. Use after editing any German content (scenarios.js, lessons, boss lines).
---

# check-german — never teach wrong German (free, LanguageTool)

Run: `node scripts/german-check.mjs [file ...]`  (default: `server/scenarios.js`).

Extracts the discrete German spoken lines, checks each via the free public LanguageTool API, and
filters out noise (style/register notes, quote-extraction artifacts) so a flag = a real grammar/spelling
issue. Clean output = the German is sound. Add the file(s) you changed as args to check them too.
