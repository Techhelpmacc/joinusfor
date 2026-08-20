# Design toolchain — command reference

The `ui-ux-pro-max` search engine, how to drive it directly.

## The command

```bash
python "$env:USERPROFILE\.claude\skills\ui-ux-pro-max\scripts\search.py" "<query>" [options]
```

> **Path note:** the skill's own docs use `${CLAUDE_PLUGIN_ROOT}/.claude/skills/...`,
> which assumes a *plugin* install. This machine has it as a **user skill**, so the
> real path is `~/.claude/skills/ui-ux-pro-max/scripts/search.py`. Use that when
> running commands by hand.

## The flagship: full design system

Give it a product/industry description and it returns a complete recommended system —
layout pattern, style, colour tokens, typography, with accessibility annotations.

```bash
python "<search.py>" "beauty spa wellness service" --design-system -p "Serenity Spa"
```

Add dials to steer it (each 1–10):

```bash
python "<search.py>" "internal analytics dashboard" --design-system \
  --variance 8 --motion 7 --density 8 -p "Ops Console"
```

| Dial | Low | High |
|------|-----|------|
| `--variance` | safe, conventional | experimental, distinctive |
| `--motion` | still, minimal | animated, kinetic |
| `--density` | airy, spacious | dense, information-rich |

Save the result into a project:

```bash
python "<search.py>" "<query>" --design-system --persist -p "Project Name" --output-dir "<project-root>"
```

## Targeted lookups

Search one domain instead of generating a whole system:

```bash
python "<search.py>" "keyboard focus modal" --domain ux
```

**Domains:** `style` `color` `chart` `landing` `product` `ux` `typography` `icons`
`gsap` `react` `web` `google-fonts`

## Stack-specific guidance

```bash
python "<search.py>" "suspense streaming bundle" --stack nextjs
```

**Stacks:** `react` `nextjs` `vue` `svelte` `astro` `swiftui` `react-native` `flutter`
`nuxtjs` `nuxt-ui` `html-tailwind` `shadcn` `jetpack-compose` `threejs` `angular`
`laravel` `javafx` `wpf` `winui` `avalonia` `uno` `uwp`

## Other options

| Flag | Purpose |
|------|---------|
| `--max-results 1-20` | cap results (default is small) |
| `--json` | machine-readable output |
| `--full` | fuller detail per result |
| `--format ascii\|markdown` | output style |
| `--page N` | paginate |
| `--force` | overwrite when persisting |

## What's in the data

`~/.claude/skills/ui-ux-pro-max/data/` — plain CSVs, readable without Python:

`styles.csv` · `colors.csv` · `typography.csv` · `google-fonts.csv` · `products.csv`
`ux-guidelines.csv` · `icons.csv` · `motion.csv` · `charts.csv` · `landing.csv`
`app-interface.csv` · `react-performance.csv` · `ui-reasoning.csv` · `stacks/*.csv`

Also `references/quick-reference.md` and `references/pro-rules.md` — worth reading directly.

## Troubleshooting

**"Python was not found"** — Windows ships a Microsoft Store *stub* at
`WindowsApps\python.exe` that isn't real Python. Real Python is at
`%LOCALAPPDATA%\Programs\Python\Python313\python.exe`. Verified 2026-08-17 that the
real one comes first in PATH (position 1 vs the stub at 11), so bare `python` works
in any new terminal. An *already-open* terminal keeps its old PATH — open a new one.

**Skill not showing up** — it must live in `~/.claude/skills/<name>/` with a `SKILL.md`.
Don't leave backup folders inside `~/.claude/skills/` — Claude Code loads them as
duplicate skills. Keep backups elsewhere.

**Updating the skill** — it's a plain copy, not a git checkout. To update:

```bash
git clone --depth 1 https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git
# then copy .claude/skills/ui-ux-pro-max/ over ~/.claude/skills/ui-ux-pro-max/
```

The complete, self-contained skill is the repo's `.claude/skills/ui-ux-pro-max/`
(SKILL.md + data + scripts + references). The top-level `src/ui-ux-pro-max/` has the
payload but **no SKILL.md**, so don't copy that one on its own.
