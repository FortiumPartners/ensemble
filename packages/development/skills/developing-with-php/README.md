# PHP Skill

Core PHP language patterns, PSR standards, and foundational concepts for modern PHP development.

## Purpose

This skill provides PHP language fundamentals applicable to **any** PHP project—Laravel, Symfony, WordPress, or vanilla PHP. Framework-specific patterns are covered in dedicated skills (see Laravel skill).

## When to Load

- Any PHP backend development
- Working with Composer packages
- PSR-compliant library development
- Understanding core language features before framework abstractions
- Non-Laravel PHP projects (Symfony, Slim, WordPress)

## Key Topics

| Topic | Description |
|-------|-------------|
| PHP 8.x Features | Enums, attributes, readonly, match, named args |
| OOP Patterns | Traits, interfaces, design patterns, DI |
| Handler/Service Pattern | Repository-like business logic layers |
| Map/DTO Pattern | Data transformation objects |
| PDO | Database access, prepared statements, transactions |
| Composer | Autoloading, PSR-4, scripts |
| PSR Standards | PSR-4, PSR-12, PSR-7, PSR-11, PSR-15 |
| PHPUnit | Testing fundamentals (framework-agnostic) |
| Security | Input validation, password hashing, SQL injection prevention |

## File Structure

```
php/
├── README.md           # This file
├── SKILL.md            # Quick reference (~800 lines)
├── REFERENCE.md        # Comprehensive guide (~1400 lines)
├── VALIDATION.md       # Coverage matrix
├── templates/
│   ├── composer.template.json
│   ├── phpunit.template.xml
│   ├── class.template.php
│   ├── interface.template.php
│   ├── trait.template.php
│   ├── enum.template.php
│   ├── handler.template.php
│   ├── map_data.template.php
│   └── pdo_repository.template.php
└── examples/
    ├── php8_features.example.php
    ├── pdo_crud.example.php
    ├── design_patterns.example.php
    └── handler_architecture.example.php
```

## Relationship to Other Skills

| Skill | Relationship |
|-------|--------------|
| **Laravel** | Builds on this skill; Laravel skill assumes PHP fundamentals |
| **Prisma** | Alternative ORM approach (TypeScript) |
| **Python** | Comparable language skill structure |

## Context7 Integration

Use Context7 for:
- PHP RFC details and edge cases
- Specific extension documentation (e.g., sodium, ffi)
- Framework-specific PHP usage (covered in framework skills)

## Quick Start

```php
<?php
// PHP 8.3 features
enum Status: string {
    case Active = 'active';
    case Inactive = 'inactive';
}

readonly class UserDTO {
    public function __construct(
        public string $name,
        public string $email,
        public Status $status = Status::Active,
    ) {}
}

// Handler pattern
class UserHandler {
    public function __construct(
        private readonly PDO $db
    ) {}

    public function create(UserDTO $data): int {
        $stmt = $this->db->prepare(
            'INSERT INTO users (name, email, status) VALUES (?, ?, ?)'
        );
        $stmt->execute([$data->name, $data->email, $data->status->value]);
        return (int) $this->db->lastInsertId();
    }
}
```

## Version

- **Skill Version**: 1.0.0
- **PHP Version**: 8.1+ (8.3 recommended)
- **Last Updated**: 2025-01-01
