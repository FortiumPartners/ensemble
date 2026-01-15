# TypeScript Validation Module

## Overview
Build a TypeScript validation module with proper type definitions and comprehensive tests.

## Requirements

### Core Functions

**validation.ts:**
- `validateEmail(email: string): ValidationResult` - Validate email format
- `checkPasswordStrength(password: string): PasswordStrength` - Check password strength
- `formatPhoneNumber(phone: string): string` - Format phone number consistently

### Type Definitions

**types.ts:**
```typescript
interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

type PasswordStrength = 'weak' | 'medium' | 'strong';
```

### Technical Requirements
- TypeScript strict mode
- Proper type definitions (no `any`)
- Comprehensive error handling
- Jest or Vitest tests with >= 80% coverage

## Example Usage

```typescript
validateEmail('test@example.com')
// { isValid: true, errors: [] }

validateEmail('invalid-email')
// { isValid: false, errors: ['Invalid email format'] }

checkPasswordStrength('password123')
// 'weak'

checkPasswordStrength('P@ssw0rd!Strong')
// 'strong'

formatPhoneNumber('1234567890')
// '(123) 456-7890'
```

## File Structure

```
src/
  validation.ts   # Validation functions
  types.ts        # Type definitions
test/
  validation.test.ts  # Jest/Vitest tests
tsconfig.json     # TypeScript config (strict mode)
```

## Success Criteria
- All validation functions work correctly
- Types are properly defined and exported
- Tests pass with good coverage
- No use of `any` type
