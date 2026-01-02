# React Framework Skill

**Version**: 1.0.0
**Framework**: React 18+
**Language**: JavaScript/TypeScript
**Last Updated**: 2025-10-22

## Overview

Progressive disclosure documentation for React development with modern patterns (hooks, context, performance optimization). This skill provides framework-specific expertise to the `frontend-developer` agent.

## Architecture

```
react-framework/
├── README.md              # This file - overview and usage
├── SKILL.md               # Quick reference (<100KB) - Essential patterns
├── REFERENCE.md           # Comprehensive guide (<1MB) - Deep dive
├── templates/             # Code generation templates
│   ├── component.template.tsx       # Functional component with hooks
│   ├── context.template.tsx         # Context provider pattern
│   ├── hook.template.ts             # Custom hook
│   ├── component.test.template.tsx  # Component unit tests
│   └── README.md                    # Template usage guide
└── examples/              # Real-world implementations
    ├── component-patterns.example.tsx    # Component composition patterns
    ├── state-management.example.tsx      # State management approaches
    └── README.md                         # Examples index
```

## Progressive Disclosure Pattern

### SKILL.md (Quick Reference)
- **Size**: <100KB target
- **Use Case**: Fast lookups during active development
- **Content**: Essential patterns, common operations, anti-patterns
- **Load Time**: <100ms

### REFERENCE.md (Comprehensive Guide)
- **Size**: <1MB target
- **Use Case**: Deep dives, learning new patterns
- **Content**: Full API documentation, edge cases, advanced patterns
- **Load Time**: <500ms

## When to Use

The frontend-developer agent loads this skill when:
- `package.json` contains `"react"` dependency
- Files with `.jsx` or `.tsx` extensions detected
- User explicitly mentions "React" in task description
- `create-react-app`, `Next.js`, `Vite` project detected

## Framework Detection

**Primary Signals** (Confidence: 0.4 each):
- `package.json` → `dependencies.react` or `devDependencies.react`
- `*.jsx` or `*.tsx` files in `src/` directory

**Secondary Signals** (Confidence: 0.2 each):
- `package.json` → `dependencies.react-dom`
- `.jsx` or `.tsx` import statements
- React-specific file patterns: `src/components/`, `src/hooks/`

**Boost Factors** (+0.1 each):
- `next.config.js` (Next.js framework)
- `vite.config.js` with `@vitejs/plugin-react`
- `.babelrc` with `@babel/preset-react`

**Minimum Confidence**: 0.8 (80%) required for automatic detection

## Core Capabilities

### 1. Component Architecture
- Functional components with hooks
- Component composition patterns
- Props interface design
- Children patterns and render props

### 2. State Management
- useState and useReducer patterns
- Context API for global state
- Third-party libraries (Redux, Zustand, Jotai)
- State lifting and prop drilling avoidance

### 3. Hooks & Effects
- Built-in hooks (useState, useEffect, useContext, etc.)
- Custom hooks for reusable logic
- Dependency management and optimization
- Hook rules and best practices

### 4. Performance Optimization
- React.memo for component memoization
- useMemo and useCallback for expensive operations
- Code splitting with lazy() and Suspense
- Virtual scrolling for large lists

### 5. Testing
- React Testing Library patterns
- Unit tests for components and hooks
- Integration tests for user flows
- Accessibility testing with jest-axe

### 6. TypeScript Integration
- Props interfaces and type safety
- Generic components
- Event handler types
- Ref types for DOM access

## Version Compatibility

| Skill Version | React Versions | Frontend-Developer Versions | Notes |
|---------------|----------------|----------------------------|-------|
| 1.0.0 | 18.0.0 - 18.x | ≥3.0.0 | Initial release with hooks focus |
| Future | 19.0.0+ | ≥3.1.0 | Server Components support planned |

## Quick Start

### Loading the Skill

```typescript
// Embedded in frontend-developer.yaml
const skill = await skillLoader.loadSkill('react-framework', 'quick');
// Returns SKILL.md content for fast reference

const comprehensiveGuide = await skillLoader.loadSkill('react-framework', 'comprehensive');
// Returns REFERENCE.md content for deep dives
```

### Using Templates

```bash
# Generate a new component
cp templates/component.template.tsx src/components/MyComponent.tsx
# Replace placeholders: {{ComponentName}}, {{component-name}}

# Generate a custom hook
cp templates/hook.template.ts src/hooks/useMyHook.ts
# Replace placeholders: {{HookName}}, {{hook-name}}
```

## File Size Guidelines

- **SKILL.md**: Target ≤50KB (Quick reference should be fast)
- **REFERENCE.md**: Target ≤500KB (Comprehensive but still reasonable)
- **Templates**: 50-200 lines each (Focused, single responsibility)
- **Examples**: 200-500 lines each (Real-world, production-ready)

## Integration with Frontend-Developer

The frontend-developer agent uses this skill by:

1. **Detection Phase**: Runs framework-detector to identify React
2. **Loading Phase**: Loads SKILL.md for quick patterns
3. **Deep Dive Phase**: Loads REFERENCE.md when needed for complex scenarios
4. **Code Generation**: Uses templates for boilerplate reduction
5. **Learning Phase**: References examples for best practices

## Related Skills

- **typescript-framework**: TypeScript-specific patterns (if using TS)
- **testing-framework**: Testing patterns beyond React Testing Library
- **build-tools**: Webpack, Vite, or other bundler configurations
- **css-framework**: Styling approaches (CSS Modules, styled-components, Tailwind)

## Maintenance

### Updating Content

When React releases new features:
1. Update REFERENCE.md with new APIs
2. Update SKILL.md if pattern becomes essential
3. Add templates for new patterns if commonly used
4. Update version compatibility matrix
5. Increment skill version (semantic versioning)

### Validation

Before releasing updates:
- [ ] SKILL.md file size ≤100KB
- [ ] REFERENCE.md file size ≤1MB
- [ ] All templates pass linting
- [ ] Examples demonstrate production-ready code
- [ ] Feature parity ≥95% with original react-component-architect.yaml

## Support

For issues or improvements:
- Review existing examples for patterns
- Check REFERENCE.md for comprehensive coverage
- Consult react-component-architect.yaml for baseline behavior
- Reference official React documentation: https://react.dev/

## Performance Metrics

**Target Metrics**:
- Skill load time: <100ms (SKILL.md), <500ms (REFERENCE.md)
- Template generation: <50ms per file
- Code generation success rate: ≥95%
- User satisfaction: ≥90% approval

---

**Status**: 🚧 In Development (TRD-024)

**Next Steps**:
1. Extract patterns from react-component-architect.yaml (TRD-025)
2. Write SKILL.md with essential React patterns (TRD-026)
3. Write REFERENCE.md with comprehensive guide (TRD-027)
4. Create code generation templates (TRD-028)
5. Write real-world examples (TRD-029)
6. Validate feature parity ≥95% (TRD-030)

---

_Part of Skills-Based Framework Architecture_
_Related: docs/TRD/skills-based-framework-agents-trd.md_
