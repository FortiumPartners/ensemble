---
name: ensemble:sessionlog
description: Save a structured session transcript to SessionLogs with key decisions, commands, and resolutions
---
<!-- DO NOT EDIT - Generated from sessionlog.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Capture and persist the current session context as a structured markdown log file.
Analyzes the conversation to extract key decisions, commands executed, problems
encountered, and resolutions reached. Saves to ./SessionLogs/session-DDMMYY-HH:MM.md
relative to the current project directory. Useful for preserving session knowledge
across context boundaries, onboarding, and audit trails.

## Constraints

- Output directory is always ./SessionLogs/ relative to the current working project
- Filename format is session-DDMMYY-HH:MM.md using current date and time
- Create the SessionLogs directory if it does not exist
- Never overwrite an existing session log file
- Include all significant decisions, not just code changes
- Capture both successful and failed approaches for learning value
- Never include sensitive data such as API keys, tokens, passwords, secrets, credentials, or personally identifiable information (PII) in session logs
- If previous session logs exist in ./SessionLogs/, focus on changes since the last log rather than repeating prior context
- When prior logs exist, include a Continuation section at the top linking to the most recent previous log file

## Workflow

### Phase 1: Session Analysis

**1. Conversation Scanning**
   Review the full session conversation history

   - Identify all user requests and assistant responses
   - Extract commands executed and their outcomes
   - Note tool calls and their results
   - Flag any errors, retries, or approach changes

**2. Context Extraction**
   Extract structured information from the session

   - List key decisions made and their rationale
   - Identify problems encountered and how they were resolved
   - Capture file paths modified or created
   - Note any external resources referenced
   - Record configuration or environment details relevant to the work

**3. Check for Previous Logs**
   Scan for existing session logs to enable incremental logging

   - List files in ./SessionLogs/ directory if it exists
   - Identify the most recent session log by filename timestamp
   - If a previous log exists, scan its content to understand what was already captured
   - Focus this session log on new work, decisions, and changes since the last log

**4. Determine Output Path**
   Resolve the session log file path

   - Determine the current project root directory
   - Construct the SessionLogs directory path relative to project root
   - Generate the filename using current date and time in DDMMYY-HH:MM format
   - Verify the target file does not already exist

### Phase 2: Output Generation

**1. Compose Session Log**
   Generate the structured markdown session log

   - Write frontmatter with date, project, and branch metadata
   - If a previous session log exists, write a Continuation note linking to the previous log filename
   - Write a brief session summary paragraph
   - Write a Key Decisions section with rationale for each decision
   - Write a Commands & Actions section listing significant commands and outcomes
   - Write a Problems & Resolutions section documenting issues and fixes
   - Write a Files Changed section listing created, modified, or deleted files
   - Write a Notes section for any additional observations or follow-up items

**2. Sanitize and Write Session Log File**
   Review for sensitive data then save the session log to disk

   - Review the composed log and strip any API keys, tokens, passwords, secrets, credentials, or PII
   - Create the SessionLogs directory if it does not exist
   - Write the markdown content to the resolved file path
   - Confirm the file was written successfully
   - Report the file path to the user

## Expected Output

**Format:** Markdown Session Log

**Structure:**
- **SessionLogs/session-DDMMYY-HH:MM.md**: Structured session transcript with decisions, commands, problems, resolutions, and files changed

## Usage

```
/ensemble:sessionlog
```
