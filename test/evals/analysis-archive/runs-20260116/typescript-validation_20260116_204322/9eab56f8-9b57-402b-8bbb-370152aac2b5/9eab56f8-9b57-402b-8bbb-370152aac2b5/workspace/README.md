# validation-module

A TypeScript validation module providing functions for email validation, password strength checking, and phone number formatting.

## Features

- **Email Validation**: RFC 5322 compliant email validation with normalization
- **Password Strength**: Score-based password strength checking with detailed feedback
- **Phone Formatting**: US phone number formatting in multiple formats (national, E.164, digits)
- **Type-Safe**: Full TypeScript support with discriminated union types
- **Zero Dependencies**: No runtime dependencies for minimal bundle size
- **Tree-Shakeable**: ESM and CJS dual package format
- **Secure**: Linear-time regex patterns to prevent ReDoS attacks

## Installation

```bash
npm install validation-module
```

## Usage

### Email Validation

```typescript
import { validateEmail } from 'validation-module';

const result = validateEmail('user@example.com');

if (result.isValid) {
  console.log('Valid email:', result.value);
} else {
  console.log('Error:', result.error.message);
}
```

### Password Strength

```typescript
import { checkPasswordStrength } from 'validation-module';

const result = checkPasswordStrength('MyP@ssw0rd');

console.log('Score:', result.score);        // 0-4
console.log('Label:', result.label);        // 'very-weak' to 'very-strong'
console.log('Requirements:', result.requirements);
console.log('Suggestions:', result.suggestions);
```

### Phone Formatting

```typescript
import { formatPhoneNumber } from 'validation-module';

// National format (default)
const national = formatPhoneNumber('5551234567');
if (national.isValid) {
  console.log(national.formatted);  // '(555) 123-4567'
}

// E.164 format
const e164 = formatPhoneNumber('5551234567', 'e164');
if (e164.isValid) {
  console.log(e164.formatted);  // '+15551234567'
}

// Digits only
const digits = formatPhoneNumber('555-123-4567', 'digits');
if (digits.isValid) {
  console.log(digits.formatted);  // '5551234567'
}
```

## API Reference

### validateEmail(email: string): ValidationResult

Validates an email address and returns a normalized value on success.

**Returns:**
- On success: `{ isValid: true, value: string }` - normalized email (trimmed, lowercased)
- On failure: `{ isValid: false, error: ValidationError }`

**Error Codes:**
- `EMAIL_EMPTY` - Email is empty or whitespace only
- `EMAIL_INVALID_FORMAT` - Invalid email format
- `EMAIL_INVALID_DOMAIN` - Invalid domain format
- `EMAIL_TOO_LONG` - Email exceeds 254 characters
- `INPUT_TOO_LONG` - Input exceeds 1000 characters

### checkPasswordStrength(password: string): PasswordStrengthResult

Checks password strength and returns detailed feedback.

**Returns:**
```typescript
{
  score: 0 | 1 | 2 | 3 | 4,
  label: 'very-weak' | 'weak' | 'fair' | 'strong' | 'very-strong',
  requirements: {
    minLength: boolean,    // >= 8 characters
    uppercase: boolean,    // Has uppercase letter
    lowercase: boolean,    // Has lowercase letter
    number: boolean,       // Has number
    specialChar: boolean   // Has special character
  },
  suggestions: string[]    // Tips for improvement
}
```

**Scoring:**
- +1 for minimum length (8+ characters)
- +1 for uppercase letter
- +1 for lowercase letter
- +0.5 for number
- +0.5 for special character

### formatPhoneNumber(phone: string, format?: PhoneFormat): PhoneFormatResult

Formats a US phone number in the specified format.

**Parameters:**
- `phone` - Phone number (accepts various formats)
- `format` - Output format: `'national'` (default), `'e164'`, or `'digits'`

**Returns:**
- On success: `{ isValid: true, formatted: string, digits: string }`
- On failure: `{ isValid: false, error: ValidationError }`

**Error Codes:**
- `PHONE_EMPTY` - Phone is empty or whitespace only
- `PHONE_INVALID_LENGTH` - Not 10 digits (after stripping)
- `PHONE_INVALID_FORMAT` - Invalid format (11 digits not starting with 1)
- `INPUT_TOO_LONG` - Input exceeds 1000 characters

## Types

All types are exported for TypeScript users:

```typescript
import type {
  ValidationResult,
  ValidationSuccess,
  ValidationFailure,
  ValidationError,
  ErrorCodeType,
  PasswordStrengthResult,
  PasswordRequirements,
  PasswordStrengthLabel,
  PhoneFormatResult,
  PhoneFormatSuccess,
  PhoneFormatFailure,
  PhoneFormat,
} from 'validation-module';

// ErrorCode is exported as a const object
import { ErrorCode } from 'validation-module';
```

## Security

This module is designed with security in mind:

- **Input Length Limits**: All inputs are limited to 1000 characters
- **ReDoS Prevention**: All regex patterns are linear-time
- **No eval()**: Static analysis verified
- **Type-Safe**: Full TypeScript strict mode

## License

MIT
