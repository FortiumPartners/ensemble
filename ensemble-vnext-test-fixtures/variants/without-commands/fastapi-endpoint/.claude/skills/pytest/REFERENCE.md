# pytest Testing Framework - Comprehensive Reference

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [Test Organization](#test-organization)
4. [Fixtures](#fixtures)
5. [Parametrization](#parametrization)
6. [Mocking with pytest-mock](#mocking-with-pytest-mock)
7. [Assertions and Matchers](#assertions-and-matchers)
8. [Test Configuration](#test-configuration)
9. [Advanced Patterns](#advanced-patterns)
10. [Best Practices](#best-practices)

## Overview

pytest is a mature full-featured Python testing framework that makes it easy to write small, readable tests and scales to support complex functional testing for applications and libraries.

### Key Features

- Simple test function syntax (no classes required)
- Powerful fixture system for test setup/teardown
- Parametrized testing for data-driven tests
- Rich plugin ecosystem (pytest-mock, pytest-cov, pytest-asyncio, etc.)
- Detailed assertion introspection
- Modular architecture with plugins

## Core Concepts

### Test Discovery

pytest automatically discovers tests following these conventions:

- **Test files**: `test_*.py` or `*_test.py`
- **Test functions**: `test_*()` functions
- **Test classes**: `Test*` classes with `test_*()` methods

```python
# test_example.py
def test_simple():
    """Simple test function"""
    assert 1 + 1 == 2

class TestCalculator:
    """Test class for calculator operations"""

    def test_addition(self):
        assert 2 + 2 == 4

    def test_subtraction(self):
        assert 5 - 3 == 2
```

### Test Execution

```bash
# Run all tests in current directory
pytest

# Run specific test file
pytest tests/test_calculator.py

# Run specific test function
pytest tests/test_calculator.py::test_addition

# Run tests matching pattern
pytest -k "addition or subtraction"

# Run with verbose output
pytest -v

# Run with output capture disabled (show print statements)
pytest -s

# Run and show local variables on failure
pytest -l
```

## Test Organization

### Directory Structure

```
project/
├── src/
│   └── calculator.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py          # Shared fixtures
│   ├── test_calculator.py   # Calculator tests
│   └── test_integration.py  # Integration tests
├── pytest.ini               # pytest configuration
└── requirements-test.txt    # Test dependencies
```

### Test File Template

```python
"""Test module for calculator functionality"""
import pytest
from src.calculator import Calculator

class TestCalculator:
    """Test suite for Calculator class"""

    def test_addition(self):
        """Test basic addition"""
        calc = Calculator()
        result = calc.add(2, 3)
        assert result == 5

    def test_division_by_zero(self):
        """Test division by zero raises exception"""
        calc = Calculator()
        with pytest.raises(ZeroDivisionError):
            calc.divide(10, 0)
```

## Fixtures

Fixtures provide a fixed baseline for tests, handling setup and teardown.

### Basic Fixtures

```python
import pytest

@pytest.fixture
def calculator():
    """Provide a Calculator instance"""
    return Calculator()

def test_addition(calculator):
    """Test uses calculator fixture"""
    result = calculator.add(2, 3)
    assert result == 5
```

### Fixture Scopes

```python
# Function scope (default) - runs for each test
@pytest.fixture(scope="function")
def temp_file():
    f = open("temp.txt", "w")
    yield f
    f.close()
    os.remove("temp.txt")

# Class scope - runs once per test class
@pytest.fixture(scope="class")
def database():
    db = Database.connect()
    yield db
    db.disconnect()

# Module scope - runs once per module
@pytest.fixture(scope="module")
def app():
    app = create_app()
    yield app
    app.shutdown()

# Session scope - runs once per test session
@pytest.fixture(scope="session")
def test_config():
    return {"api_url": "http://test.example.com"}
```

### Fixture Dependencies

```python
@pytest.fixture
def database():
    """Database connection"""
    db = Database.connect()
    yield db
    db.disconnect()

@pytest.fixture
def user(database):
    """Create test user (depends on database)"""
    user = database.create_user("test@example.com")
    yield user
    database.delete_user(user.id)

def test_user_creation(user):
    """Test user creation"""
    assert user.email == "test@example.com"
```

### Autouse Fixtures

```python
@pytest.fixture(autouse=True)
def reset_state():
    """Automatically reset state before each test"""
    State.reset()
    yield
    # Cleanup happens automatically
```

### conftest.py Shared Fixtures

```python
# tests/conftest.py
import pytest

@pytest.fixture
def api_client():
    """Shared API client for all tests"""
    client = APIClient(base_url="http://test.example.com")
    yield client
    client.close()

@pytest.fixture
def authenticated_client(api_client):
    """Authenticated API client"""
    api_client.login("test@example.com", "password")
    yield api_client
    api_client.logout()
```

## Parametrization

### Basic Parametrization

```python
import pytest

@pytest.mark.parametrize("input,expected", [
    (2, 4),
    (3, 9),
    (4, 16),
    (5, 25),
])
def test_square(input, expected):
    """Test square calculation with multiple inputs"""
    assert input ** 2 == expected
```

### Multiple Parameters

```python
@pytest.mark.parametrize("x,y,expected", [
    (2, 3, 5),
    (5, 7, 12),
    (10, -5, 5),
])
def test_addition(x, y, expected):
    """Test addition with multiple parameter sets"""
    assert x + y == expected
```

### Parametrizing Fixtures

```python
@pytest.fixture(params=["sqlite", "postgres", "mysql"])
def database(request):
    """Parametrized database fixture"""
    db = Database.connect(request.param)
    yield db
    db.disconnect()

def test_user_creation(database):
    """Test runs 3 times, once for each database"""
    user = database.create_user("test@example.com")
    assert user.id is not None
```

### Named Parameters with IDs

```python
@pytest.mark.parametrize(
    "test_input,expected",
    [
        ({"name": "John", "age": 30}, True),
        ({"name": "Jane"}, False),
        ({}, False),
    ],
    ids=["complete", "missing_age", "empty"]
)
def test_user_validation(test_input, expected):
    """Test with descriptive IDs"""
    assert validate_user(test_input) == expected
```

## Mocking with pytest-mock

pytest-mock provides a thin wrapper around unittest.mock with pytest integration.

### Installation

```bash
pip install pytest-mock
```

### Basic Mocking

```python
def test_api_call(mocker):
    """Test with mocked API call"""
    # Mock the requests.get function
    mock_get = mocker.patch('requests.get')
    mock_get.return_value.status_code = 200
    mock_get.return_value.json.return_value = {"data": "test"}

    # Test your code
    response = fetch_data("http://api.example.com")

    # Assertions
    assert response == {"data": "test"}
    mock_get.assert_called_once_with("http://api.example.com")
```

### Mocking Class Methods

```python
def test_database_save(mocker):
    """Test with mocked database save"""
    mock_save = mocker.patch('database.Database.save')
    mock_save.return_value = True

    user = User("test@example.com")
    result = user.save()

    assert result is True
    mock_save.assert_called_once()
```

### Mocking with Side Effects

```python
def test_retry_logic(mocker):
    """Test retry logic with side effects"""
    mock_api = mocker.patch('api.call')
    # First two calls fail, third succeeds
    mock_api.side_effect = [
        Exception("Timeout"),
        Exception("Timeout"),
        {"status": "success"}
    ]

    result = retry_api_call()

    assert result == {"status": "success"}
    assert mock_api.call_count == 3
```

### Spy on Methods

```python
def test_method_called(mocker):
    """Spy on method calls without mocking behavior"""
    calculator = Calculator()
    spy = mocker.spy(calculator, 'add')

    result = calculator.add(2, 3)

    assert result == 5
    spy.assert_called_once_with(2, 3)
```

### Mock Context Managers

```python
def test_file_operations(mocker):
    """Test with mocked file operations"""
    mock_open = mocker.patch('builtins.open', mocker.mock_open(read_data='test data'))

    with open('test.txt', 'r') as f:
        content = f.read()

    assert content == 'test data'
    mock_open.assert_called_once_with('test.txt', 'r')
```

## Assertions and Matchers

### Basic Assertions

```python
def test_assertions():
    """Various assertion examples"""
    # Equality
    assert 1 + 1 == 2

    # Inequality
    assert 5 != 3

    # Comparison
    assert 10 > 5
    assert 3 <= 3

    # Identity
    x = [1, 2, 3]
    y = x
    assert x is y

    # Membership
    assert 'a' in 'apple'
    assert 3 in [1, 2, 3]

    # Boolean
    assert True
    assert not False
```

### Exception Assertions

```python
def test_exceptions():
    """Test exception handling"""
    # Basic exception check
    with pytest.raises(ValueError):
        int("invalid")

    # Check exception message
    with pytest.raises(ValueError, match="invalid literal"):
        int("invalid")

    # Capture exception for inspection
    with pytest.raises(ValueError) as exc_info:
        int("invalid")
    assert "invalid literal" in str(exc_info.value)
```

### Approximate Comparisons

```python
def test_approximate():
    """Test with approximate comparisons"""
    # Floating point comparison
    assert 0.1 + 0.2 == pytest.approx(0.3)

    # With tolerance
    assert 10.0 == pytest.approx(10.1, abs=0.2)

    # Relative tolerance
    assert 100.0 == pytest.approx(101.0, rel=0.02)
```

## Test Configuration

### pytest.ini

```ini
[pytest]
# Test discovery patterns
python_files = test_*.py *_test.py
python_classes = Test*
python_functions = test_*

# Minimum version
minversion = 6.0

# Test paths
testpaths = tests

# Command line options
addopts =
    -v
    --strict-markers
    --tb=short
    --cov=src
    --cov-report=html

# Custom markers
markers =
    slow: marks tests as slow (deselect with '-m "not slow"')
    integration: marks tests as integration tests
    unit: marks tests as unit tests
```

### Marking Tests

```python
import pytest

@pytest.mark.slow
def test_slow_operation():
    """Test marked as slow"""
    time.sleep(5)
    assert True

@pytest.mark.integration
def test_database_integration():
    """Integration test"""
    db = Database.connect()
    assert db.is_connected()

# Run only slow tests
# pytest -m slow

# Skip slow tests
# pytest -m "not slow"
```

### Skip and XFail

```python
@pytest.mark.skip(reason="Not implemented yet")
def test_future_feature():
    """Test to be implemented"""
    pass

@pytest.mark.skipif(sys.version_info < (3, 8), reason="Requires Python 3.8+")
def test_python_38_feature():
    """Test requiring Python 3.8+"""
    pass

@pytest.mark.xfail(reason="Known bug #123")
def test_known_bug():
    """Test expected to fail"""
    assert buggy_function() == expected_value
```

## Advanced Patterns

### Async Testing

```python
import pytest

@pytest.mark.asyncio
async def test_async_function():
    """Test async function"""
    result = await async_operation()
    assert result == expected
```

### Custom Fixtures with Cleanup

```python
@pytest.fixture
def resource():
    """Fixture with setup and teardown"""
    # Setup
    r = create_resource()

    yield r

    # Teardown (always runs)
    r.cleanup()
```

### Fixture Finalization

```python
@pytest.fixture
def database(request):
    """Database with request finalizer"""
    db = Database.connect()

    def cleanup():
        db.disconnect()

    request.addfinalizer(cleanup)
    return db
```

### Dynamic Test Generation

```python
def pytest_generate_tests(metafunc):
    """Dynamically generate test parameters"""
    if "test_input" in metafunc.fixturenames:
        metafunc.parametrize("test_input", load_test_data())
```

## Best Practices

### 1. Test Organization

```python
# Good: Organized test class
class TestUserAuthentication:
    """Tests for user authentication"""

    def test_successful_login(self, user):
        """Test successful login"""
        assert user.login("password") is True

    def test_failed_login(self, user):
        """Test failed login"""
        assert user.login("wrong") is False
```

### 2. Fixture Reusability

```python
# tests/conftest.py
@pytest.fixture
def temp_dir(tmp_path):
    """Reusable temporary directory fixture"""
    test_dir = tmp_path / "test"
    test_dir.mkdir()
    yield test_dir
    # Cleanup automatic with tmp_path
```

### 3. Clear Test Names

```python
# Good: Descriptive test names
def test_user_cannot_delete_other_users_posts():
    """Clear indication of what's being tested"""
    pass

# Bad: Vague test name
def test_delete():
    """Unclear what's being tested"""
    pass
```

### 4. Arrange-Act-Assert Pattern

```python
def test_user_creation():
    """Test following AAA pattern"""
    # Arrange
    email = "test@example.com"
    name = "Test User"

    # Act
    user = create_user(email, name)

    # Assert
    assert user.email == email
    assert user.name == name
```

### 5. One Assertion Per Test (When Possible)

```python
# Good: Focused test
def test_user_email():
    """Test user email validation"""
    user = User("test@example.com")
    assert user.email == "test@example.com"

def test_user_name():
    """Test user name setting"""
    user = User("test@example.com", name="Test")
    assert user.name == "Test"
```

### 6. Use Fixtures for Common Setup

```python
@pytest.fixture
def authenticated_user():
    """Common setup for authenticated user"""
    user = User("test@example.com")
    user.authenticate("password")
    return user

def test_user_profile(authenticated_user):
    """Test uses common setup"""
    profile = authenticated_user.get_profile()
    assert profile is not None
```

### 7. Mock External Dependencies

```python
def test_weather_api(mocker):
    """Test with mocked external API"""
    mock_api = mocker.patch('weather.fetch_weather')
    mock_api.return_value = {"temp": 72, "conditions": "sunny"}

    result = get_weather("San Francisco")

    assert result["temp"] == 72
    assert result["conditions"] == "sunny"
```

## Common Pytest Commands

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

# Run in parallel (with pytest-xdist)
pytest -n auto

# Run with debugging on failure
pytest --pdb

# Show local variables on failure
pytest -l

# Collect tests without running
pytest --collect-only

# Run last failed tests
pytest --lf

# Run failed tests first
pytest --ff
```

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
        with:
          python-version: 3.9
      - name: Install dependencies
        run: |
          pip install -r requirements-test.txt
      - name: Run tests
        run: |
          pytest --cov=src --cov-report=xml
      - name: Upload coverage
        uses: codecov/codecov-action@v2
```

## Resources

- [Official pytest Documentation](https://docs.pytest.org/)
- [pytest-mock Documentation](https://pytest-mock.readthedocs.io/)
- [pytest-asyncio](https://github.com/pytest-dev/pytest-asyncio)
- [pytest-cov](https://pytest-cov.readthedocs.io/)
- [pytest-xdist](https://github.com/pytest-dev/pytest-xdist)
