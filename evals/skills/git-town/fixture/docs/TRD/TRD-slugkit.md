# TRD: slugkit text helpers

Two small changes, delivered as two pull requests. Each section is one pull request.

### PR 1: Add a slug helper

Create `src/slug.js` exporting `slugify(text)`. It lower-cases the text, replaces every run of characters that are not letters or digits with a single dash, and trims dashes from both ends. No other file changes.

### PR 2: Add a title slug

Create `src/title.js` exporting `titleSlug(title)`. It returns `slugify(title)` from `src/slug.js` cut to at most 40 characters, with no trailing dash. This change uses the helper from PR 1, so it needs that code to be present. No other file changes.
