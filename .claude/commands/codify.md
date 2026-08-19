---
description: Run the codifier manually on this session (or a transcript path)
---

Manual codify run. The instructions below are included from
`scripts/codify-prompt.md` — the same file the nightly codify routine uses,
so manual and scheduled behavior never drift. Do not restate or paraphrase
rules from memory; follow the included file.

Manual-mode context:

- Arguments: $ARGUMENTS
- If an argument is a transcript path, analyze that file; otherwise analyze
  the current conversation as the transcript.
- Because this run is interactive: present the findings (each with its
  ladder level and one-line rationale) and the intended diff before
  committing. The branch and PR steps still apply; main stays untouched.

@scripts/codify-prompt.md
