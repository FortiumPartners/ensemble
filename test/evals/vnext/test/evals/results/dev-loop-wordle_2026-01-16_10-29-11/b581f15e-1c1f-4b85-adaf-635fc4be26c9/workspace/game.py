"""Core game logic for Wordle - state management and feedback generation."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class LetterState(Enum):
    """State of a letter in feedback."""

    CORRECT = "correct"  # Green - letter in correct position
    PRESENT = "present"  # Yellow - letter in word but wrong position
    ABSENT = "absent"  # Gray - letter not in word


@dataclass
class LetterFeedback:
    """Feedback for a single letter."""

    letter: str
    state: LetterState

    def __str__(self) -> str:
        return f"{self.letter.upper()}:{self.state.value}"


@dataclass
class GuessFeedback:
    """Feedback for an entire guess."""

    letters: list[LetterFeedback]

    def __str__(self) -> str:
        return " ".join(lf.letter.upper() for lf in self.letters)

    def is_all_correct(self) -> bool:
        """Check if all letters are correct (winning guess)."""
        return all(lf.state == LetterState.CORRECT for lf in self.letters)

    def get_states(self) -> list[LetterState]:
        """Get list of letter states."""
        return [lf.state for lf in self.letters]


@dataclass
class GameState:
    """Tracks the current state of a Wordle game."""

    target_word: str
    max_attempts: int = 6
    guesses: list[str] = field(default_factory=list)
    feedbacks: list[GuessFeedback] = field(default_factory=list)
    _game_over: bool = False
    _won: bool = False

    @property
    def attempts_remaining(self) -> int:
        """Number of attempts remaining."""
        return self.max_attempts - len(self.guesses)

    @property
    def current_attempt(self) -> int:
        """Current attempt number (1-indexed)."""
        return len(self.guesses) + 1

    @property
    def is_game_over(self) -> bool:
        """Check if the game is over."""
        return self._game_over

    @property
    def is_won(self) -> bool:
        """Check if the game was won."""
        return self._won

    def mark_won(self) -> None:
        """Mark the game as won."""
        self._game_over = True
        self._won = True

    def mark_lost(self) -> None:
        """Mark the game as lost."""
        self._game_over = True
        self._won = False


class GuessValidationError(Exception):
    """Exception raised for invalid guesses."""

    pass


def validate_guess(guess: str) -> str:
    """Validate a guess and return the cleaned version.

    Args:
        guess: The user's guess.

    Returns:
        The cleaned and validated guess (lowercase).

    Raises:
        GuessValidationError: If the guess is invalid.
    """
    if not guess:
        raise GuessValidationError("Please enter a guess.")

    cleaned = guess.strip().lower()

    if not cleaned:
        raise GuessValidationError("Please enter a guess.")

    if not cleaned.isalpha():
        raise GuessValidationError("Guess must contain only letters.")

    if len(cleaned) != 5:
        raise GuessValidationError(f"Guess must be exactly 5 letters (you entered {len(cleaned)}).")

    return cleaned


def generate_feedback(guess: str, target: str) -> GuessFeedback:
    """Generate feedback for a guess against a target word.

    This implements the standard Wordle feedback algorithm:
    1. First pass: Mark all correct (green) letters
    2. Second pass: For remaining letters, mark present (yellow) if the letter
       exists in the target and hasn't been "used" by a correct or previous present match

    Args:
        guess: The 5-letter guess.
        target: The 5-letter target word.

    Returns:
        GuessFeedback with the state of each letter.
    """
    guess = guess.lower()
    target = target.lower()

    # Initialize all as absent
    states = [LetterState.ABSENT] * 5

    # Track which target letters have been "used"
    target_letters = list(target)
    target_used = [False] * 5

    # First pass: find correct letters (green)
    for i, (g, t) in enumerate(zip(guess, target)):
        if g == t:
            states[i] = LetterState.CORRECT
            target_used[i] = True

    # Second pass: find present letters (yellow)
    for i, g in enumerate(guess):
        if states[i] == LetterState.CORRECT:
            continue  # Already marked as correct

        # Look for this letter in unused positions in target
        for j, t in enumerate(target):
            if not target_used[j] and g == t:
                states[i] = LetterState.PRESENT
                target_used[j] = True
                break

    # Build feedback
    letters = [LetterFeedback(letter=g, state=s) for g, s in zip(guess, states)]
    return GuessFeedback(letters=letters)


def process_guess(game_state: GameState, guess: str) -> tuple[GuessFeedback, Optional[str]]:
    """Process a guess and update game state.

    Args:
        game_state: The current game state.
        guess: The validated guess.

    Returns:
        Tuple of (feedback, error_message). error_message is None if successful.
    """
    if game_state.is_game_over:
        return GuessFeedback(letters=[]), "Game is already over."

    # Generate feedback
    feedback = generate_feedback(guess, game_state.target_word)

    # Update game state
    game_state.guesses.append(guess)
    game_state.feedbacks.append(feedback)

    # Check win condition
    if feedback.is_all_correct():
        game_state.mark_won()
    elif game_state.attempts_remaining == 0:
        game_state.mark_lost()

    return feedback, None


def create_new_game(target_word: str, max_attempts: int = 6) -> GameState:
    """Create a new game with the given target word.

    Args:
        target_word: The word to guess.
        max_attempts: Maximum number of attempts allowed.

    Returns:
        A new GameState instance.
    """
    return GameState(target_word=target_word.lower(), max_attempts=max_attempts)
