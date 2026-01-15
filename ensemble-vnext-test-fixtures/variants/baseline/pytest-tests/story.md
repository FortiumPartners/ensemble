# Python String Utilities with Tests

## Overview
Build a Python string utility module with comprehensive pytest test coverage.

## Requirements

### Core Functions

**string_utils.py:**
- `capitalize_words(text: str) -> str` - Capitalize first letter of each word
- `reverse_string(text: str) -> str` - Reverse the string
- `count_vowels(text: str) -> int` - Count vowels (a, e, i, o, u, case-insensitive)

### Technical Requirements
- Python 3.x with type hints
- Docstrings for all functions
- Handle edge cases (empty strings, special characters)
- Target: >= 90% test coverage

### Test Requirements

**test_string_utils.py:**
- Test all three functions comprehensively
- Use pytest fixtures and parametrize for efficiency
- Cover edge cases: empty strings, single characters, special chars
- Organized test structure (grouped by function)

## Example Usage

```python
>>> capitalize_words("hello world")
'Hello World'

>>> reverse_string("hello")
'olleh'

>>> count_vowels("hello world")
3
```

## Success Criteria
- All functions work correctly
- Tests pass with >= 90% coverage
- pytest.mark.parametrize used effectively
- Code is clean and well-documented
