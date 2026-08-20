# Website Design Training

A **sandbox for testing web design ideas** before committing to a client site.

Try a direction here first — layouts, palettes, type pairings, motion, a new technique.
When something works, promote it into its own client folder under
`D:\Client Web Sites\Claude Sites\`. Nothing in here is precious; that's the point.

Started 2026-08-17. Companion to [SEO Services](../SEO%20Services/) — that project
optimises a finished site, this one is where the design gets figured out.

---

## The workflow

```
idea  →  experiments/<name>/  →  evaluate  →  promote to client folder
                  ↑                    ↓
                  └──── iterate ───────┘
```

1. **Start an experiment** — copy `_template/` into `experiments/<name>/`
2. **Plan before building** — two passes (see [workflow.md](workflow.md))
3. **Build and look at it** — open the HTML, or ask Claude to preview and screenshot it
4. **Keep or bin it** — most experiments are throwaway; that's healthy
5. **Promote the winners** — copy into a new client project folder

Full process, with the exact commands: **[workflow.md](workflow.md)**

## The toolchain

| Tool | Answers | Location |
|------|---------|----------|
| **ui-ux-pro-max** v2.13.0 | *"What are the options?"* — palettes, font pairings, UX rules, section patterns, 22 stacks | `~/.claude/skills/ui-ux-pro-max/` |
| **frontend-design** | *"Is this any good?"* — pushes past generic defaults | `~/.claude/skills/frontend-design/` |
| **Python 3.13.15** | Runs the ui-ux-pro-max search engine | `%LOCALAPPDATA%\Programs\Python\Python313\` |

Both are Claude skills, loaded automatically when design work comes up. Data without
judgement gives a competent-but-templated page; judgement without data gives vague
direction. Use both.

Generate a starting design system for any idea:

```bash
python "$env:USERPROFILE\.claude\skills\ui-ux-pro-max\scripts\search.py" "<what the site is>" --design-system
```

## Layout

```
Website design training/
  README.md              <- this file
  workflow.md            <- experiment → client, step by step
  design-principles.md   <- the design thinking (read before starting)
  design-toolchain.md    <- full search.py command reference
  setup-log-2026-08-17.md
  _template/             <- copy this to start an experiment
  experiments/           <- your tests live here
```

## House style note

Existing sites (techhelpmacc.co.uk et al) are built as **self-contained Divi Fullwidth
Code modules** — one block of HTML + scoped CSS + JS, everything namespaced under a
wrapper class so it can't leak into the theme. The `_template/` follows that same
shape, so anything proven here drops into Divi with minimal rework.
