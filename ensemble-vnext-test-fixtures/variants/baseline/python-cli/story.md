# Python CLI Calculator

## Overview
Build a command-line calculator that accepts mathematical expressions and outputs the result.

## Requirements

### Core Functionality
- Accept command line arguments: `<number1> <operator> <number2>`
- Support operators: +, -, *, /
- Handle division by zero gracefully
- Provide clear error messages for invalid input

### Technical Requirements
- Use Python 3.x with type hints
- Include comprehensive tests using pytest
- Target 80%+ test coverage
- Handle edge cases (negative numbers, decimals, invalid operators)

## Example Usage

```bash
python calc.py 5 + 3
# Output: 8

python calc.py 10 / 0
# Error: Division by zero is not allowed

python calc.py abc + 5
# Error: Invalid number: abc
```

## Success Criteria
- All basic operations work correctly
- Error handling is comprehensive
- Tests pass with good coverage
- Code is clean and well-documented
