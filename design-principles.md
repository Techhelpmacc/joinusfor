# Design principles

Distilled from the `frontend-design` skill — the judgement layer that stops a design
looking templated. Read this before starting any new site.

---

## Ground it in the subject

Before designing, name three things: the **concrete subject**, its **audience**, and
the page's **single job**. If the brief doesn't pin these down, pin them yourself and
say so.

The subject's own world — its materials, instruments, artifacts, vernacular — is where
distinctive choices come from. A computer repair business, a spa, and a law firm should
not end up with the same page wearing different colours.

## The hero is a thesis

Open with the most characteristic thing in the subject's world, in whatever form fits:
a headline, an image, an animation, a live demo, an interactive moment.

> A big number with a small label, supporting stats, and a gradient accent is the
> **template answer**. Only use it if it's genuinely the best option.

## Typography carries the personality

Pair display and body faces deliberately — not the same families you'd reach for on
any other project. Set a clear type scale with intentional weights, widths and spacing.
The type treatment should itself be memorable, not a neutral delivery vehicle.

## Structure is information

Numbering, eyebrows, dividers and labels should **encode something true** about the
content, not decorate it.

Numbered markers (01 / 02 / 03) are only appropriate when the content genuinely *is*
a sequence — a real process, or a timeline where order carries information the reader
needs. Question them before using them.

## Motion, deliberately

Decide *where and if* animation serves the subject: a page-load sequence, a
scroll-triggered reveal, hover micro-interactions, ambient atmosphere.

One orchestrated moment usually lands harder than scattered effects. Often less is
more — excess animation is itself a tell that a design was machine-generated.

## Match complexity to the vision

Maximalist directions need elaborate execution. Minimal directions need precision in
spacing, type and detail. Elegance is executing the chosen vision *well* — not
choosing a particular level of busyness.

---

## The three clichés to avoid

Current AI-generated design clusters hard around three looks. All are legitimate for
*some* briefs, but they show up regardless of subject, which makes them defaults rather
than choices:

1. **Warm cream** background (near `#F4F1EA`) + high-contrast serif display + terracotta accent
2. **Near-black** background + a single bright acid-green or vermilion accent
3. **Broadsheet** layout — hairline rules, zero border-radius, dense newspaper columns

If the brief explicitly asks for one of these, follow the brief — the brief's own words
always win. But where an axis is left free, don't spend that freedom on a default.

## The process: two passes

**Pass 1 — plan.** Build a compact token system:

- **Color** — the palette as 4–6 named hex values
- **Type** — typefaces for 2+ roles: a characterful display face used with restraint,
  a complementary body face, and a utility face for captions/data if needed
- **Layout** — a layout concept, described in one-sentence prose plus ASCII wireframes
  to compare options
- **Signature** — the single element this page will be remembered by

**Pass 2 — critique it before building.** Work through a similar prompt and see if you
arrive somewhere similar. If any part reads like the generic default you'd produce for
any comparable page, revise it — and say what changed and why.

Only then write code, following the revised plan exactly, deriving every colour and
type decision from it.

## Two practical traps

**CSS specificity.** It's easy to generate classes that cancel each other out —
especially a type-based selector like `.section` against an element-based one like
`.cta`. This bites most often on section padding/margins.

**Copy.** Writing can make a design feel as templated as the visuals. Use active voice
and plain language. Name controls by what the user *does*, not by system architecture.
Treat errors and empty states as directional moments — tell people what to do next —
not as opportunities for personality.
