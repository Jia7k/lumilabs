# Lumi5 Option 4 Logo Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and present four controlled refinements of the approved Lumi5 option 4 logo mark.

**Architecture:** Use the selected option 4 raster as a visual reference and issue one built-in image-generation call per variation. Treat every output as a preview-only artifact, inspect it against the shared constraints, and do not modify website assets or application code.

**Tech Stack:** Built-in OpenAI image generation, local image inspection

## Global Constraints

- Use the existing Lumi5 purple, `#6B4EE6`, as a single flat colour.
- Preserve two opposing brace forms and a correctly shaped semicolon centred between them.
- Avoid gradients, shadows, lighting, depth, texture, text, and unrelated symbols.
- Use a centred square composition on pure white with generous, consistent padding.
- Keep the mark understandable at the website's existing 30-pixel navbar icon size.
- Outputs are preview mockups only; do not update any website asset or application code.

---

### Task 1: Generate the four controlled refinements

**Files:**
- Reference: `/Users/jiarong/.codex/generated_images/019f7e81-c448-70d0-b4e0-62cdca6e1267/exec-93dbcc28-e440-4d18-bde1-a8f62f5ca6a0.png`
- Create: Built-in generated-image previews under `/Users/jiarong/.codex/generated_images/`

**Interfaces:**
- Consumes: The selected option 4 image as a visual reference and the global constraints above.
- Produces: Four square preview images labelled balanced, compact, rounded, and sharp.

- [ ] **Step 1: Load and inspect the selected reference**

Use the local image viewer on the reference file. Confirm it contains two opposing
purple brace forms around a centred semicolon on white.

- [ ] **Step 2: Generate the balanced refinement**

Use one built-in image-generation call with this request:

```text
Use case: logo-brand
Asset type: Lumi5 Labs logo-mark refinement preview
Primary request: Refine the supplied option 4 mark into a balanced, optically symmetrical connector icon. Preserve two opposing smooth brace forms surrounding one correctly shaped semicolon.
Input image: Image 1 is the selected concept reference; retain its core structure but simplify and polish its geometry.
Style/medium: Flat vector-friendly geometric logo
Composition: Centred square mark with generous even padding on pure white
Color palette: One solid colour only, exact Lumi5 purple #6B4EE6
Constraints: Moderate stroke weight; braces stay separate; semicolon is clearly punctuation; legible at 30px
Avoid: gradients, shadows, 3D, texture, glow, text, letters, people, faces, extra symbols, blue, black
```

- [ ] **Step 3: Generate the compact refinement**

Use one built-in image-generation call with this request:

```text
Use case: logo-brand
Asset type: Lumi5 Labs logo-mark refinement preview
Primary request: Refine the supplied option 4 mark into a compact small-size icon. Preserve two opposing brace forms surrounding one correctly shaped semicolon, using heavier geometry and tighter but uncluttered spacing.
Input image: Image 1 is the selected concept reference; retain its core structure.
Style/medium: Flat vector-friendly geometric logo
Composition: Centred square mark with generous even padding on pure white
Color palette: One solid colour only, exact Lumi5 purple #6B4EE6
Constraints: Bold silhouette; braces stay separate; semicolon is clearly punctuation; optimised for 30px navbar and favicon use
Avoid: gradients, shadows, 3D, texture, glow, text, letters, people, faces, extra symbols, blue, black
```

- [ ] **Step 4: Generate the rounded refinement**

Use one built-in image-generation call with this request:

```text
Use case: logo-brand
Asset type: Lumi5 Labs logo-mark refinement preview
Primary request: Refine the supplied option 4 mark into a friendly rounded connector icon. Preserve two opposing brace forms surrounding one correctly shaped semicolon, using soft terminals and smooth curves without making the symbol childish.
Input image: Image 1 is the selected concept reference; retain its core structure.
Style/medium: Flat vector-friendly geometric logo
Composition: Centred square mark with generous even padding on pure white
Color palette: One solid colour only, exact Lumi5 purple #6B4EE6
Constraints: Approachable, symmetrical, braces stay separate, semicolon reads clearly, legible at 30px
Avoid: gradients, shadows, 3D, texture, glow, text, letters, people, faces, extra symbols, blue, black
```

- [ ] **Step 5: Generate the sharp refinement**

Use one built-in image-generation call with this request:

```text
Use case: logo-brand
Asset type: Lumi5 Labs logo-mark refinement preview
Primary request: Refine the supplied option 4 mark into a precise technical connector icon. Preserve two opposing brace forms surrounding one correctly shaped semicolon, using crisp controlled terminals and subtly angular transitions.
Input image: Image 1 is the selected concept reference; retain its core structure.
Style/medium: Flat vector-friendly geometric logo
Composition: Centred square mark with generous even padding on pure white
Color palette: One solid colour only, exact Lumi5 purple #6B4EE6
Constraints: Professional, symmetrical, braces stay separate, semicolon reads clearly, legible at 30px
Avoid: gradients, shadows, 3D, texture, glow, text, letters, people, faces, extra symbols, blue, black
```

### Task 2: Inspect and present the refinements

**Files:**
- Inspect: The four generated preview images from Task 1

**Interfaces:**
- Consumes: Four generated image previews.
- Produces: Four visibly labelled inline choices and a concise recommendation.

- [ ] **Step 1: Inspect every full-size output**

For each image, verify:

```text
one flat purple treatment
pure white background
two visually separate opposing brace forms
one correctly shaped and centred semicolon
no text, extra symbols, gradient, shadow, lighting, depth, or texture
```

- [ ] **Step 2: Inspect small-size readability**

View each output at reduced detail and reject any variant whose semicolon disappears,
whose brace forms merge, or whose silhouette becomes visually ambiguous.

- [ ] **Step 3: Regenerate only failed variants**

Repeat the exact failed variant prompt with one targeted correction describing the
observed defect. Keep every unaffected constraint unchanged.

- [ ] **Step 4: Present the accepted choices**

Display the four accepted images inline, label them `1 Balanced`, `2 Compact`,
`3 Rounded`, and `4 Sharp`, and state which one best balances brand personality
with 30-pixel legibility.
