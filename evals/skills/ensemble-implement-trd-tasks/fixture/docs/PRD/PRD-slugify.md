---
document_id: PRD-slugify
title: Slugify Util
status: Approved
---

# PRD: Slugify Util

## Requirements

### REQ-001: Convert text to a slug (Must)

- AC-001-1: Given the text "Hello World", when slugify runs, then it returns "hello-world".
- AC-001-2: Given text with leading or trailing separators, when slugify runs, then they are trimmed.

### REQ-002: Handle bad input (Must)

- AC-002-1: Given a non-string value, when slugify runs, then it returns an empty string.
