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

## Project: Kanban Task Board

A full-stack Kanban task management application that allows users to create boards, organize tasks into columns, and drag-and-drop cards between columns. Includes an AG Grid-powered reports dashboard for task analytics and CSV export.

## Tech Stack

- **Frontend**: React 18 with Vite, functional components, hooks
- **Backend**: Node.js with Express
- **Database**: PostgreSQL 15
- **Data Grid**: AG Grid Community for reports
- **Testing**: Jest (frontend + backend), React Testing Library
- **Infrastructure**: Docker Compose for local development

## Key Documents

- `story.md` - Complete feature specification including API design, database schema, and UI components

## Entry Points

- `backend/src/index.js` - Express server entry point
- `frontend/src/main.jsx` - React app entry point
- `docker-compose.yml` - Development environment orchestration

## Architecture Notes

- **Fractional indexing** for card/column position management
- **Cascading deletes** in database (board -> columns -> cards)
- **RESTful API** at `/api` prefix with `/reports` endpoints for analytics

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
