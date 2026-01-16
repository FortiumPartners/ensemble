# Text-Based Wordle Game

## Overview
A command-line version of the Wordle game where players guess a five-letter word within six attempts. After each guess, the game provides feedback indicating correct letters in the correct position, correct letters in the wrong position, and incorrect letters.

## Goals
- Build a lightweight, replayable CLI game in Python
- Mimic the core mechanics of Wordle using text-based feedback
- Ensure intuitive input and clear output formatting

## Target Users
- Terminal users and developers
- Word game enthusiasts
- Learners exploring Python game logic

## Core Features

### 1. Game Initialization
- Load a list of valid five-letter words
- Randomly select a target word from the list

### 2. Gameplay Loop
- Accept user input (guess)
- Validate guess (must be exactly 5 letters but does NOT need to be on the word list)
- Compare guess to target word
- Provide feedback per letter using terminal colors:
  - 🟩 (Green): correct letter, correct position
  - 🟨 (Yellow): correct letter, wrong position
  - ⬜ (Gray): incorrect letter
- Track number of attempts (max 6)
- End game on win or after 6 guesses

### 3. User Feedback
- Display guess results after each attempt
- Show win/loss message
- Offer option to play again

## Technical Requirements
- Language: Python 3.x
- Interface: Command-line (stdin/stdout)
- Dependencies: None (standard library only)

## Example Interaction

```
Welcome to Wordle CLI!
Guess the 5-letter word. You have 6 attempts.

Enter guess #1: CRANE
Feedback: 🟨⬜⬜⬜🟩

Enter guess #2: SLATE
Feedback: ⬜⬜🟩🟩🟩

...

Congratulations! You guessed the word in 4 attempts.
Play again? (y/n):
```

## Success Criteria
- Game runs smoothly in terminal
- Feedback is clear and accurate
- Word list is properly validated
- Replay loop functions correctly

## Out of Scope
- GUI or web interface
- Multiplayer or scoring system
- Non-English word support

## Implementation Notes
- Create a words.txt file with common 5-letter words
- Use colorama or ANSI escape codes for terminal colors
- Structure code with clear separation: game logic, UI, word management
- Include comprehensive pytest tests covering:
  - Word validation
  - Feedback generation (various letter position scenarios)
  - Game state management
  - Win/loss conditions
