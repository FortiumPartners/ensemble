# @fortium/ensemble-pytest

pytest testing framework integration for Claude Code - Execute and generate Python tests with fixtures, parametrization, and mocking support.

## Installation

```bash
claude plugin install @fortium/ensemble-pytest
```

Or via marketplace:
```bash
claude plugin add ensemble-pytest
```

## Description

Part of the ensemble plugin ecosystem for Claude Code. This plugin provides comprehensive pytest testing framework integration, enabling intelligent test generation and execution for Python projects.

## Features

- **Test Generation**: Automatic pytest test file creation from source code
- **Test Execution**: Structured test running with JSON output for CI/CD integration
- **Fixture Support**: Complete pytest fixture system for test setup and teardown
- **Parametrized Testing**: Data-driven tests with multiple input scenarios
- **Mocking with pytest-mock**: Comprehensive mocking and spying capabilities
- **Best Practices**: Industry-standard patterns for Python testing

## Skills Included

### pytest Test Framework Skill

Execute and generate pytest tests with comprehensive Python testing patterns.

**Quick Reference**: `skills/SKILL.md` - Essential pytest commands and patterns
**Comprehensive Guide**: `skills/REFERENCE.md` - Deep dive into fixtures, parametrization, mocking

## Usage

### Test Generation

Generate pytest test files from source code:

```bash
python lib/generate-test.py \
  --source=src/calculator.py \
  --output=tests/test_calculator.py \
  --type=unit \
  --description="Calculator arithmetic operations"
```

**Output Format**:
```json
{
  "success": true,
  "testFile": "tests/test_calculator.py",
  "testCount": 1,
  "template": "unit"
}
```

### Test Execution

Run pytest tests with structured output:

```bash
python lib/run-test.py \
  --file=tests/test_calculator.py \
  --config=pytest.ini
```

**Output Format**:
```json
{
  "success": false,
  "passed": 2,
  "failed": 1,
  "total": 3,
  "duration": 0.234,
  "failures": [
    {
      "test": "test_divide_by_zero",
      "error": "AssertionError: Expected ZeroDivisionError",
      "file": "tests/test_calculator.py",
      "line": 15
    }
  ]
}
```

## Python Testing Patterns

### Basic Test Structure

```python
"""Test module for calculator"""
import pytest
from calculator import Calculator

class TestCalculator:
    """Test suite for Calculator class"""

    def test_addition(self):
        """Test basic addition"""
        calc = Calculator()
        assert calc.add(2, 3) == 5

    def test_division_by_zero(self):
        """Test division by zero raises exception"""
        calc = Calculator()
        with pytest.raises(ZeroDivisionError):
            calc.divide(10, 0)
```

### Fixtures for Setup/Teardown

```python
import pytest

@pytest.fixture
def calculator():
    """Provide a Calculator instance for tests"""
    calc = Calculator()
    yield calc
    # Cleanup happens here if needed

def test_addition(calculator):
    """Test uses calculator fixture"""
    result = calculator.add(2, 3)
    assert result == 5
```

### Parametrized Tests

```python
@pytest.mark.parametrize("x,y,expected", [
    (2, 3, 5),
    (5, 7, 12),
    (10, -5, 5),
])
def test_addition(x, y, expected):
    """Test addition with multiple inputs"""
    calc = Calculator()
    assert calc.add(x, y) == expected
```

### Mocking with pytest-mock

```python
def test_api_call(mocker):
    """Test with mocked API call"""
    mock_get = mocker.patch('requests.get')
    mock_get.return_value.status_code = 200
    mock_get.return_value.json.return_value = {"data": "test"}

    response = fetch_data("http://api.example.com")

    assert response == {"data": "test"}
    mock_get.assert_called_once()
```

## Directory Structure

```
packages/pytest/
├── .claude-plugin/
│   └── plugin.json          # Plugin configuration
├── skills/
│   ├── SKILL.md            # Quick reference guide
│   └── REFERENCE.md        # Comprehensive pytest patterns
├── lib/
│   ├── generate-test.py    # Test generation utility
│   ├── run-test.py         # Test execution utility
│   └── index.js            # Node.js skill metadata
├── tests/                   # Plugin tests
├── README.md               # This file
├── CHANGELOG.md            # Version history
└── package.json            # NPM package configuration
```

## Integration with Deep Debugger

This plugin integrates with the ensemble deep-debugger workflow:

1. **Test Detection**: Identifies pytest as the test framework
2. **Test Generation**: Creates failing tests for bug reproduction
3. **Test Validation**: Runs tests to confirm failure
4. **Fix Verification**: Re-runs tests after fix to verify passing

## Prerequisites

- Python 3.7+
- pytest installed (`pip install pytest`)
- pytest-mock for mocking support (`pip install pytest-mock`)
- pytest-asyncio for async tests (`pip install pytest-asyncio`)

## Configuration

### pytest.ini Example

```ini
[pytest]
# Test discovery
python_files = test_*.py *_test.py
python_classes = Test*
python_functions = test_*

# Test paths
testpaths = tests

# Command line options
addopts =
    -v
    --strict-markers
    --tb=short

# Custom markers
markers =
    slow: marks tests as slow
    integration: marks tests as integration tests
    unit: marks tests as unit tests
```

## Common pytest Commands

```bash
# Run all tests
pytest

# Run with verbose output
pytest -v

# Run specific test file
pytest tests/test_calculator.py

# Run specific test function
pytest tests/test_calculator.py::test_addition

# Run tests matching pattern
pytest -k "addition"

# Run with coverage
pytest --cov=src --cov-report=html

# Show local variables on failure
pytest -l

# Run last failed tests
pytest --lf
```

## Advanced Features

### Fixture Scopes

- `function`: Run for each test (default)
- `class`: Run once per test class
- `module`: Run once per module
- `session`: Run once per test session

### Markers

```python
@pytest.mark.slow
def test_slow_operation():
    """Test marked as slow"""
    pass

# Skip slow tests
# pytest -m "not slow"
```

### Exception Testing

```python
def test_exception():
    """Test exception is raised"""
    with pytest.raises(ValueError, match="invalid value"):
        validate_input("bad")
```

## Best Practices

1. **One Assertion Per Test**: Keep tests focused and easy to debug
2. **Arrange-Act-Assert Pattern**: Structure tests clearly (setup, execution, verification)
3. **Use Fixtures**: Reuse common setup across tests
4. **Mock External Dependencies**: Isolate unit tests from external systems
5. **Descriptive Test Names**: Use clear, specific test function names
6. **Parametrize Similar Tests**: Reduce duplication with parametrized tests

## Dependencies

- `ensemble-quality@4.0.0`: Quality assurance and testing foundation

## Documentation

- **Skills Reference**: See `skills/SKILL.md` for quick reference
- **Comprehensive Guide**: See `skills/REFERENCE.md` for detailed patterns
- **Main Repository**: [ensemble](https://github.com/FortiumPartners/ensemble)

## Support

For issues, questions, or contributions, please visit the [ensemble repository](https://github.com/FortiumPartners/ensemble).

## License

MIT

---

Part of the [ensemble plugin ecosystem](https://github.com/FortiumPartners/ensemble) - Modular, composable plugins for Claude Code.
