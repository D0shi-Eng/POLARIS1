---
id: polaris.playbook.presentation
name: Presentation
description: Build a clear slide deck (.pptx) with one idea per slide and verify it.
version: 1.0.0
publisher: POLARIS
license: Apache-2.0
when_to_use: the user asks for slides, a deck or a presentation
required_tools: polaris.artifact.presentation
---
# Presentation

1. Fix the slide count first (the user's number, otherwise 6–10) and write a one-line message for each slide.
2. Slide 1 is the title; the last slide is a summary or next steps. One idea per slide, a headline that states it, and at most five short bullets.
3. Put numbers in tables, not in long bullets. Keep wording consistent across slides.
4. Create the deck with `create_presentation` under `outputs/`.
5. Re-open it with `read_file` and check the slide count and that every headline is present.
6. Reply with the file name and the list of slide headlines.
