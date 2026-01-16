# CLAUDE.md - AI-Augmented Development

## Core Workflow

```
/init-project          --> Initialize project structure (once per project)
/create-prd            --> Product Requirements Document
/refine-prd            --> (optional) Iterate on PRD with feedback
/create-trd            --> Technical Requirements Document
/refine-trd            --> (optional) Iterate on TRD with feedback
/implement-trd         --> Execute implementation tasks
/fold-prompt           --> Optimize context for continued work
```

Always check for existing PRD/TRD before creating new ones.

---

## Project: Wordle CLI

A command-line version of the Wordle game where players guess a five-letter word within six attempts. Built in Python using only the standard library, with colored terminal feedback to indicate correct letters, misplaced letters, and incorrect guesses.

## Tech Stack

- **Language:** Python 3.x (standard library only)
- **Testing:** pytest with comprehensive coverage for game logic, UI, and word management
- **Architecture:** Modular design with separation of concerns (game logic, UI/feedback, word management)
- **Interface:** Command-line (stdin/stdout) with ANSI color codes for feedback

## Key Files

- `story.md` - Feature story with requirements and acceptance criteria
- `.claude/rules/constitution.md` - Project absolutes and architecture invariants
- `.claude/rules/stack.md` - Technology stack definition
- `.claude/rules/process.md` - Development workflow documentation

## Project Structure (Target)

```
src/wordle/          # Main package
  __init__.py
  game.py            # Core game logic (word matching, attempt tracking)
  ui.py              # Terminal UI/feedback (colors, output formatting)
  words.py           # Word list management (loading, validation)
tests/               # pytest test suite
  test_game.py
  test_ui.py
  test_words.py
words.txt            # Five-letter word list
```

---

## Remote Sessions

Remote sessions run on Claude's cloud infrastructure. Use them for parallel work or when you want sessions accessible from the web UI.

**Starting a remote session:**
```bash
# From within a git repo that is pushed to GitHub
claude --remote "Your prompt here"
```

**Requirements:**
- Must run from a git repository pushed to GitHub
- Prompt is the argument (not piped via stdin)
- Cannot use `--dangerously-skip-permissions` or `--session-id`
- Runs at repo ROOT (not subdirectory you invoked from)

**Output:**
```
Created remote session: Your task description
View: https://claude.ai/code/session_018oKtL6CSbVA9gNttj41T13?m=0
Resume with: claude --teleport session_018oKtL6CSbVA9gNttj41T13
```

**Retrieving a remote session locally:**
```bash
claude --teleport session_018oKtL6CSbVA9gNttj41T13
```

**Note:** Remote sessions commit code artifacts but NOT session logs. Use teleport to retrieve full session context.

---

## Learnings

*Learnings will be captured here by the SessionEnd hook.*
