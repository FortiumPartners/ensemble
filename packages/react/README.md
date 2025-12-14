# @fortium/ensemble-react

**Version**: 4.0.0
**Framework**: React 18+
**Category**: Frontend Development
**License**: MIT

React framework skills and component development plugin for Claude Code. Provides comprehensive React expertise including modern hooks patterns, state management, performance optimization, and TypeScript integration.

## Overview

This plugin extracts React framework skills from the ensemble monolith into a modular, reusable package. It provides progressive disclosure documentation, code generation templates, and real-world examples for building modern React applications.

### Key Features

- **Progressive Disclosure Documentation**: Quick reference (SKILL.md) and comprehensive guide (REFERENCE.md)
- **Code Generation Templates**: Component, hook, context, and test templates with TypeScript support
- **Real-World Examples**: Production-ready patterns for component architecture and state management
- **Automatic Detection**: Intelligent framework detection based on project structure and dependencies
- **TypeScript First**: Full TypeScript support with type-safe patterns
- **Testing Patterns**: React Testing Library integration with best practices
- **Performance Optimization**: Memoization, code splitting, and lazy loading patterns

## Installation

### Via Claude Code Marketplace

```bash
claude plugin install @fortium/ensemble-react
```

### Manual Installation

```bash
# Clone the ensemble repository
git clone https://github.com/FortiumPartners/ensemble.git
cd ensemble

# Install dependencies
npm install

# Build the plugin
npm run build

# Link for local development
cd packages/react
npm link
```

## Usage

After installation, the React skills will be automatically available when:

1. Your project has React as a dependency in `package.json`
2. JSX/TSX files are detected in your `src/` directory
3. React frameworks like Next.js or Vite are detected
4. You explicitly mention "React" in your task description

### Frontend Developer Integration

The `frontend-developer` agent automatically loads this skill when React is detected:

```yaml
# In frontend-developer.yaml
skills:
  - name: react-framework
    auto-detect: true
    minimum-confidence: 0.8
```

### Direct Skill Loading

You can also explicitly load React skills:

```javascript
// In your agent or command
const reactSkill = require('@fortium/ensemble-react');

// Load quick reference for fast lookups
const quickRef = await reactSkill.loadSkill('quick');

// Load comprehensive guide for deep dives
const comprehensive = await reactSkill.loadSkill('comprehensive');

// Get a code template
const componentTemplate = await reactSkill.getTemplate('component');

// Get an example
const stateExample = await reactSkill.getExample('state-management');
```

## Directory Structure

```
packages/react/
├── .claude-plugin/
│   └── plugin.json         # Plugin configuration and metadata
├── agents/                 # Agent configurations (if any)
├── commands/               # Custom commands (if any)
├── lib/
│   └── index.js           # Main plugin entry point and API
├── skills/
│   ├── SKILL.md           # Quick reference (<100KB) - Essential patterns
│   ├── REFERENCE.md       # Comprehensive guide - Deep dive
│   ├── README.md          # Skill overview and usage
│   ├── PATTERNS-EXTRACTED.md  # Extracted patterns from legacy agent
│   ├── VALIDATION.md      # Validation checklist and quality gates
│   ├── templates/         # Code generation templates
│   │   ├── component.template.tsx       # Functional component with hooks
│   │   ├── context.template.tsx         # Context provider pattern
│   │   ├── hook.template.ts             # Custom hook template
│   │   ├── component.test.template.tsx  # Component unit tests
│   │   └── README.md                    # Template usage guide
│   └── examples/          # Real-world implementations
│       ├── component-patterns.example.tsx    # Component composition
│       ├── state-management.example.tsx      # State management patterns
│       └── README.md                         # Examples index
├── tests/                 # Plugin tests
├── CHANGELOG.md          # Version history
├── package.json          # Package configuration
└── README.md             # This file

```

## Core Capabilities

### 1. Component Architecture
- Functional components with hooks
- Component composition patterns
- Props interface design with TypeScript
- Children patterns and render props
- Error boundaries and Suspense

### 2. State Management
- useState and useReducer patterns
- Context API for global state
- Third-party libraries (Redux, Zustand, Jotai)
- State lifting and prop drilling avoidance
- Form state management

### 3. Hooks & Effects
- Built-in hooks (useState, useEffect, useContext, useRef, etc.)
- Custom hooks for reusable logic
- Dependency management and optimization
- Hook rules and best practices
- Advanced patterns (useImperativeHandle, useLayoutEffect)

### 4. Performance Optimization
- React.memo for component memoization
- useMemo and useCallback for expensive operations
- Code splitting with lazy() and Suspense
- Virtual scrolling for large lists
- Bundle size optimization

### 5. Testing
- React Testing Library patterns
- Unit tests for components and hooks
- Integration tests for user flows
- Accessibility testing with jest-axe
- Mock patterns and test utilities

### 6. TypeScript Integration
- Props interfaces and type safety
- Generic components
- Event handler types
- Ref types for DOM access
- Type-safe Context patterns

## Framework Detection

The plugin uses a multi-signal detection system:

### Primary Signals (0.4 confidence each)
- `package.json` contains `"react"` in dependencies or devDependencies
- `*.jsx` or `*.tsx` files found in `src/` directory

### Secondary Signals (0.2 confidence each)
- `package.json` contains `"react-dom"`
- JSX/TSX import statements detected
- React-specific directory patterns (`src/components/`, `src/hooks/`)

### Boost Factors (+0.1 each)
- `next.config.js` or `next.config.mjs` (Next.js)
- `vite.config.js` or `vite.config.ts` with React plugin
- `.babelrc` with `@babel/preset-react`

**Minimum Confidence Required**: 0.8 (80%)

## Available Templates

### Component Template
**File**: `component.template.tsx`
**Use Case**: Functional component with TypeScript and hooks

```tsx
import { FC } from 'react';

interface {{ComponentName}}Props {
  title: string;
  onAction?: () => void;
}

export const {{ComponentName}}: FC<{{ComponentName}}Props> = ({ title, onAction }) => {
  return (
    <div>
      <h1>{title}</h1>
      <button onClick={onAction}>Action</button>
    </div>
  );
};
```

### Hook Template
**File**: `hook.template.ts`
**Use Case**: Custom hook for reusable logic

```typescript
import { useState, useEffect } from 'react';

export function use{{HookName}}() {
  const [state, setState] = useState(null);

  useEffect(() => {
    // Effect logic
  }, []);

  return { state };
}
```

### Context Template
**File**: `context.template.tsx`
**Use Case**: Context provider for state management

### Test Template
**File**: `component.test.template.tsx`
**Use Case**: Unit tests with React Testing Library

## Examples

### Component Patterns Example
**File**: `component-patterns.example.tsx`
Demonstrates:
- Component composition
- Props drilling avoidance
- Children patterns
- Render props
- HOC patterns

### State Management Example
**File**: `state-management.example.tsx`
Demonstrates:
- useState and useReducer
- Context API patterns
- Custom hooks for state
- State lifting strategies

## Progressive Disclosure

### SKILL.md (Quick Reference)
- **Size**: 20KB (target: <100KB)
- **Load Time**: <100ms
- **Content**: Essential patterns, common operations, anti-patterns
- **Use Case**: Fast lookups during active development

### REFERENCE.md (Comprehensive Guide)
- **Size**: 48KB (target: <1MB)
- **Load Time**: <500ms
- **Content**: Full API documentation, edge cases, advanced patterns
- **Use Case**: Deep dives, learning new patterns

## Performance Targets

- **Skill Load Time**: <100ms (quick), <500ms (comprehensive)
- **Template Generation**: <50ms per file
- **Code Generation Success Rate**: ≥95%
- **User Satisfaction**: ≥90%
- **Framework Detection Accuracy**: ≥80%

## Version Compatibility

| Plugin Version | React Versions | Frontend-Developer | Notes |
|---------------|----------------|-------------------|-------|
| 4.0.0 | 18.0.0 - 18.x | ≥4.0.0 | Initial plugin release |
| Future | 19.0.0+ | ≥4.1.0 | Server Components support planned |

## Dependencies

This plugin requires:
- `@fortium/ensemble-development@4.0.0` - Core development agent functionality

## Related Plugins

- `@fortium/ensemble-typescript` - TypeScript-specific patterns
- `@fortium/ensemble-testing` - Testing frameworks beyond React Testing Library
- `@fortium/ensemble-vite` - Vite bundler configuration
- `@fortium/ensemble-nextjs` - Next.js framework skills

## Contributing

Contributions are welcome! Please see the [main repository](https://github.com/FortiumPartners/ensemble) for contribution guidelines.

### Updating Content

When React releases new features:
1. Update `REFERENCE.md` with new APIs
2. Update `SKILL.md` if pattern becomes essential
3. Add templates for new patterns if commonly used
4. Update version compatibility matrix
5. Increment skill version (semantic versioning)

### Quality Gates

Before releasing updates:
- [ ] SKILL.md file size ≤100KB
- [ ] REFERENCE.md file size ≤1MB
- [ ] All templates pass linting
- [ ] Examples demonstrate production-ready code
- [ ] Feature parity ≥95% with original react-component-architect.yaml
- [ ] All tests passing
- [ ] Documentation updated

## Support

- **Issues**: [GitHub Issues](https://github.com/FortiumPartners/ensemble/issues)
- **Discussions**: [GitHub Discussions](https://github.com/FortiumPartners/ensemble/discussions)
- **Documentation**: [Official React Documentation](https://react.dev/)

## License

MIT © 2025 Fortium Partners

---

**Extracted from**: ensemble v3.x monolith
**Plugin Version**: 4.0.0
**Last Updated**: 2025-12-10
**Maintainer**: Fortium Software Configuration Team
