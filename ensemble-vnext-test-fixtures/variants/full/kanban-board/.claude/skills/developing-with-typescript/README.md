# TypeScript Development Skill

TypeScript 5.x development skill for Claude Code agents, providing comprehensive type system patterns, generics, utility types, and strict mode best practices.

## Overview

This skill is loaded by `backend-developer` or `frontend-developer` agents when working with TypeScript projects. It provides:

- **SKILL.md** (~450 lines): Quick reference for daily development
- **REFERENCE.md** (~800 lines): Comprehensive guide for advanced patterns

## When This Skill Loads

Automatically detected when:
- `tsconfig.json` exists in project root
- `package.json` contains `typescript` as a dependency
- `.ts` or `.tsx` files are present
- NestJS, Angular, or typed React frameworks detected

## Contents

### SKILL.md (Quick Reference)

Essential patterns for everyday TypeScript development:

- Basic types, interfaces, and type aliases
- Union, intersection, and literal types
- Type narrowing and guards
- Generics with constraints
- Essential utility types (Partial, Pick, Omit, Record, etc.)
- Function types and overloads
- tsconfig.json configuration
- Module patterns and imports
- Common patterns (discriminated unions, branded types)
- Error handling with types

### REFERENCE.md (Comprehensive Guide)

Advanced topics for complex scenarios:

1. **Advanced Generics** - Recursive types, variadic tuples, const type parameters
2. **Conditional Types** - Distribution, infer keyword, constraint narrowing
3. **Mapped Types Deep Dive** - Key remapping, property modifiers, deep types
4. **Template Literal Types** - String manipulation, type inference
5. **Declaration Files** - Writing .d.ts, augmenting modules
6. **Module Augmentation** - Extending third-party and global types
7. **Decorators** - Modern TS 5.0+ syntax and legacy patterns
8. **Advanced tsconfig** - Project references, path aliases, strict options
9. **Type Inference Patterns** - Contextual typing, const assertions, satisfies
10. **Build Tool Integration** - esbuild, SWC, Vite configuration
11. **Migration from JavaScript** - Progressive migration strategies
12. **Performance Optimization** - Type-level and build performance

## Usage

### Agent Integration

Agents can reference this skill for TypeScript-specific guidance:

```yaml
# In agent context
skill: developing-with-typescript
reference: SKILL.md  # Quick patterns
# or
reference: REFERENCE.md  # Deep dive
```

### Common Tasks

| Task | Reference |
|------|-----------|
| Add types to function | SKILL.md > Functions |
| Create type guard | SKILL.md > Type Guards |
| Configure strict mode | SKILL.md > tsconfig.json |
| Write declaration file | REFERENCE.md > Declaration Files |
| Migrate from JavaScript | REFERENCE.md > Migration |

## Version Compatibility

- **TypeScript**: 5.0+
- **Node.js**: 18+ (for modern ESM support)
- **Build Tools**: esbuild, SWC, tsc, Vite

## Related Skills

- `nestjs-framework` - NestJS-specific TypeScript patterns
- `react` - React with TypeScript (TSX)
- `prisma` - Prisma ORM TypeScript integration

## Contributing

When updating this skill:

1. Keep SKILL.md under 500 lines for quick reference
2. Place advanced topics in REFERENCE.md
3. Focus on TypeScript 5.x patterns
4. Do NOT include React-specific types (use react skill)
5. Test code examples for correctness

## License

MIT - Part of the Ensemble Plugins ecosystem
