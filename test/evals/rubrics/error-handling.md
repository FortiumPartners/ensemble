# Error Handling Rubric

## Purpose

This rubric measures the quality of error handling in generated code. It evaluates input validation, exception handling patterns, graceful degradation, and error communication to users. The rubric is language-agnostic and applies to Python, TypeScript, PHP, and other languages with appropriate pattern adaptations.

## Scoring Scale

### Score 1 - Poor

Code exhibits dangerous or absent error handling practices:

- **Input Validation**: No validation of user input; accepts any value without checks
- **Exception Handling**: Uses bare `except:` (Python), empty `catch` blocks, or catches all exceptions silently
- **Graceful Degradation**: Crashes on unexpected input; may corrupt data or leave resources in inconsistent state
- **Error Communication**: No error messages; silent failures or cryptic stack traces exposed to users
- **Resource Management**: No cleanup of resources (files, connections) on failure

**Indicators**:
- Bare `except:` or `catch (Exception e) {}` with no handling
- Division, file operations, or network calls without any error handling
- User input passed directly to dangerous operations (SQL, file paths, shell commands)
- No distinction between recoverable and fatal errors

### Score 2 - Below Average

Code has minimal error handling that may mask issues:

- **Input Validation**: Basic null/undefined checks only; no type or format validation
- **Exception Handling**: Catches broad exception types; may swallow important errors
- **Graceful Degradation**: Prevents crashes but provides poor user experience
- **Error Communication**: Generic "An error occurred" messages; no actionable guidance
- **Resource Management**: Inconsistent cleanup; some resources may leak on failure

**Indicators**:
- `except Exception:` with generic logging only
- Validation limited to `if x is None` without format checks
- Error messages don't indicate what went wrong or how to fix it
- Some functions have error handling, others do not

### Score 3 - Acceptable

Code meets minimum standards for production error handling:

- **Input Validation**: Validates required fields and basic types; checks for null/undefined
- **Exception Handling**: Catches specific exception types in most cases; some error logging
- **Graceful Degradation**: Fails without data corruption; returns error responses
- **Error Communication**: Error messages identify the problem but may lack detail
- **Resource Management**: Uses try/finally or context managers for critical resources

**Indicators**:
- Catches specific exceptions (`ValueError`, `TypeError`, `HttpException`)
- Basic input validation at API/function boundaries
- Error messages include what failed: "Failed to connect to database"
- Context managers or try/finally for file/database operations

### Score 4 - Good

Code demonstrates solid error handling practices:

- **Input Validation**: Comprehensive validation with type checking, format validation, and range checks
- **Exception Handling**: Catches specific exceptions with appropriate handling; proper exception chaining
- **Graceful Degradation**: Provides fallback behavior where appropriate; maintains data integrity
- **Error Communication**: Clear, actionable error messages with context
- **Resource Management**: Consistent use of context managers; no resource leaks

**Indicators**:
- Custom exception types for domain-specific errors
- Validation includes format checks (email regex, date formats, numeric ranges)
- Error messages include context: "Invalid email format for field 'contact_email'"
- Retry logic for transient failures (network, database connections)
- Exception cause chaining: `raise NewError from original`

### Score 5 - Excellent

Code exemplifies best-practice error handling:

- **Input Validation**: Exhaustive validation at trust boundaries; defense in depth
- **Exception Handling**: Well-designed exception hierarchy; appropriate use of custom exceptions
- **Graceful Degradation**: Recovers when possible; provides partial results; circuit breaker patterns
- **Error Communication**: Structured error responses with codes, messages, and remediation guidance
- **Resource Management**: Robust cleanup in all scenarios; transaction rollback on failure

**Indicators**:
- Custom exception hierarchy with meaningful categorization
- Structured error responses: `{"code": "VALIDATION_ERROR", "field": "email", "message": "...", "suggestion": "..."}`
- Implements retry with exponential backoff for transient failures
- Logging includes correlation IDs, timestamps, and context
- API returns appropriate HTTP status codes (400 vs 404 vs 422 vs 500)
- Input sanitization to prevent injection attacks
- Partial success handling for batch operations

## Evaluation Prompt Template

```
You are evaluating error handling quality in code. Review the following code and provide:
1. A score from 1-5 based on the rubric below
2. Brief justification (2-3 sentences)
3. Key strengths and weaknesses

Consider these dimensions:
- Input Validation: Does code validate user input at boundaries?
- Exception Handling: Are exceptions caught specifically and handled appropriately?
- Graceful Degradation: Does code fail safely without data corruption?
- Error Communication: Are error messages clear and actionable?
- Resource Management: Are resources properly cleaned up on failure?

Rubric Summary:
1 = Poor: No validation, bare except/catch, silent failures, crashes on bad input
2 = Below Average: Minimal checks, catches broad exceptions, generic error messages
3 = Acceptable: Validates required fields, catches specific exceptions, identifies problems
4 = Good: Comprehensive validation, custom exceptions, clear messages with context
5 = Excellent: Exception hierarchy, structured errors, recovery patterns, defense in depth

Code to evaluate:
{code_content}

Respond in JSON format:
{
  "score": <1-5>,
  "justification": "<2-3 sentence summary of overall quality>",
  "dimension_scores": {
    "input_validation": <1-5>,
    "exception_handling": <1-5>,
    "graceful_degradation": <1-5>,
    "error_communication": <1-5>,
    "resource_management": <1-5>
  },
  "strengths": ["<specific strength with code example>", "..."],
  "weaknesses": ["<specific weakness with code example>", "..."],
  "reasoning": "<detailed step-by-step analysis>"
}
```

## Language-Specific Patterns

### Python

**Good patterns**:
```python
# Specific exception handling
try:
    result = process(data)
except ValueError as e:
    logger.warning("Invalid data: %s", e)
    raise ValidationError(f"Invalid input: {e}") from e
except ConnectionError as e:
    logger.error("Connection failed: %s", e)
    raise ServiceUnavailableError("Database unavailable") from e

# Context managers for resources
async with aiofiles.open(path) as f:
    content = await f.read()

# Input validation
def create_user(email: str, age: int) -> User:
    if not email or not re.match(r'^[\w\.-]+@[\w\.-]+\.\w+$', email):
        raise ValueError("Invalid email format")
    if not 0 < age < 150:
        raise ValueError("Age must be between 1 and 149")
```

**Anti-patterns**:
```python
# Bare except (catches KeyboardInterrupt, SystemExit)
try:
    do_something()
except:
    pass

# Catching Exception but ignoring
try:
    risky_operation()
except Exception:
    return None  # Silently swallows all errors
```

### TypeScript

**Good patterns**:
```typescript
// Type guards for validation
function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && /^[\w.-]+@[\w.-]+\.\w+$/.test(email);
}

// Custom error types
class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Structured error responses
function handleError(error: unknown): ApiErrorResponse {
  if (error instanceof ValidationError) {
    return { status: 422, code: 'VALIDATION_ERROR', field: error.field, message: error.message };
  }
  if (error instanceof NotFoundError) {
    return { status: 404, code: 'NOT_FOUND', message: error.message };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
}
```

**Anti-patterns**:
```typescript
// Empty catch block
try {
  await fetchData();
} catch (e) {
  // Silent failure
}

// Catching any without type narrowing
catch (error: any) {
  console.log(error.message);  // May crash if error is not Error
}
```

### PHP

**Good patterns**:
```php
// Specific exception handling
try {
    $user = $repository->find($id);
} catch (NotFoundException $e) {
    return response()->json(['error' => 'User not found'], 404);
} catch (DatabaseException $e) {
    Log::error('Database error', ['exception' => $e]);
    return response()->json(['error' => 'Service unavailable'], 503);
}

// Input validation
$validated = $request->validate([
    'email' => ['required', 'email', 'max:255'],
    'age' => ['required', 'integer', 'min:1', 'max:150'],
]);
```

**Anti-patterns**:
```php
// Catching Exception too broadly
try {
    $result = $this->process($data);
} catch (Exception $e) {
    return null;  // Swallows all errors including fatal ones
}
```

### CLI Applications

**Good patterns**:
- Return appropriate exit codes (0 success, 1 error, 2 invalid args)
- Print errors to stderr, not stdout
- Provide `--help` guidance in error messages
- Validate arguments before processing

**Anti-patterns**:
- Exit code 0 on failure
- Errors printed to stdout (breaks piping)
- Crash with stack trace instead of user-friendly message

## Scoring Decision Guide

| Dimension | Weight | Key Questions |
|-----------|--------|---------------|
| Input Validation | 25% | Are inputs validated at boundaries? Type, format, range? |
| Exception Handling | 25% | Specific exceptions? Appropriate handling? No swallowing? |
| Graceful Degradation | 20% | Safe failure? Data integrity? Partial success handling? |
| Error Communication | 20% | Clear messages? Actionable? Appropriate codes? |
| Resource Management | 10% | Context managers? Cleanup on failure? No leaks? |

When evaluating, start at Score 3 (baseline) and adjust based on presence of good patterns (+) or anti-patterns (-).
