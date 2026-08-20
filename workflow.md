# Experiment workflow

From idea to client site. Follow this rather than jumping straight to code — the
planning passes are what stop a design coming out generic.

---

## 1. Start

```bash
# copy the template (PowerShell)
Copy-Item -Recurse "_template" "experiments\my-idea"
```

Name it after the *idea*, not the client — `brutalist-hero`, `spa-warm-minimal`,
`dark-dashboard`. Experiments are about techniques you can reuse.

## 2. Pass one — plan

Get data first:

```bash
python "$env:USERPROFILE\.claude\skills\ui-ux-pro-max\scripts\search.py" "<product type> <industry> <keywords>" --design-system -p "My Idea"
```

Steer it with the dials if the default feels too safe or too busy:

```bash
... --design-system --variance 8 --motion 6 --density 4
```

Then write a **token system** into `NOTES.md` before touching HTML:

- **Color** — 4–6 named hex values
- **Type** — display face (characterful, used with restraint) + body face + optional utility face
- **Layout** — one-sentence concept, plus an ASCII wireframe
- **Signature** — the one element this page will be remembered by

## 3. Pass two — critique the plan

Before building, interrogate it:

- Would I produce this same plan for *any* site in this sector? If yes, it's a default, not a choice.
- Is it drifting into one of the three clichés? (cream+serif+terracotta / near-black+acid accent / broadsheet hairlines — see [design-principles.md](design-principles.md))
- Does the structure encode something true? Numbered steps only if order genuinely matters.
- What's the one real risk I'm taking, and can I justify it?

Revise, and note what changed and why. **Only now write code.**

## 4. Build

Work in `index.html`. Keep everything scoped under the wrapper class so it stays
drop-in ready for Divi.

Ask Claude to preview and screenshot it — faster than eyeballing markup, and it can
check console errors, responsive breakpoints and dark mode at the same time.

Targeted lookups while building:

```bash
# UX rule check
... "keyboard focus modal" --domain ux

# type pairing
... "editorial serif pairing" --domain typography

# stack-specific
... "view transitions" --stack astro
```

## 5. Evaluate

- Does it look like *this* subject, or like a template with the colours swapped?
- Does it hold up at mobile width?
- Contrast ≥ 4.5:1 on body text; visible focus on every interactive control; respects `prefers-reduced-motion`.
- Would a client recognise their business in it?

## 6. Promote to a client site

When an experiment earns it:

1. Create the client folder: `D:\Client Web Sites\Claude Sites\<Client Name>\`
2. Copy the experiment in as the starting point
3. Replace all placeholder copy with the client's real content — **real content changes layout decisions**, so expect to adjust
4. Re-run the critique against the *real* brief
5. For a Divi site, lift the module into a Fullwidth Code module (see the techhelpmacc build pattern)

Leave the original experiment in place — it's your reference for next time.

## Keeping the sandbox useful

- Bin experiments that didn't work, but note *why* in `NOTES.md` first
- One technique per experiment — mixing five ideas teaches you nothing about any of them
- Revisit old experiments before starting a new client; you've often solved it already
