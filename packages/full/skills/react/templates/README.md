# React Framework Templates

Code generation templates for rapid React development with production-ready patterns.

## Available Templates

### 1. component.template.tsx
**Functional Component with Hooks**

Demonstrates:
- TypeScript interface for props
- useState and useEffect hooks
- Error boundary integration
- Accessibility best practices
- JSDoc documentation

**Placeholders**:
- `{{ComponentName}}` → PascalCase (e.g., `UserProfile`)
- `{{component-name}}` → kebab-case (e.g., `user-profile`)

**Usage**:
```bash
cp component.template.tsx src/components/UserProfile.tsx
# Replace {{ComponentName}} with UserProfile
# Replace {{component-name}} with user-profile
```

---

### 2. context.template.tsx
**Context Provider Pattern**

Demonstrates:
- Context creation with TypeScript
- Provider component with state management
- Custom hook for consuming context
- Type-safe context access

**Placeholders**:
- `{{ContextName}}` → PascalCase (e.g., `Auth`, `Theme`)
- `{{context-name}}` → kebab-case (e.g., `auth`, `theme`)

**Usage**:
```bash
cp context.template.tsx src/context/AuthContext.tsx
# Replace {{ContextName}} with Auth
# Replace {{context-name}} with auth
```

---

### 3. hook.template.ts
**Custom Hook**

Demonstrates:
- Custom hook with TypeScript
- State management within hook
- Cleanup with useEffect
- Hook return value interface

**Placeholders**:
- `{{HookName}}` → camelCase with 'use' prefix (e.g., `useUserData`)
- `{{hook-name}}` → kebab-case (e.g., `user-data`)

**Usage**:
```bash
cp hook.template.ts src/hooks/useUserData.ts
# Replace {{HookName}} with useUserData
# Replace {{hook-name}} with user-data
```

---

### 4. component.test.template.tsx
**Component Unit Tests**

Demonstrates:
- React Testing Library setup
- Component rendering tests
- User interaction testing
- Accessibility testing with jest-axe

**Placeholders**:
- `{{ComponentName}}` → PascalCase (e.g., `UserProfile`)
- `{{component-name}}` → kebab-case (e.g., `user-profile`)

**Usage**:
```bash
cp component.test.template.tsx src/components/__tests__/UserProfile.test.tsx
# Replace {{ComponentName}} with UserProfile
# Replace {{component-name}} with user-profile
```

---

## Template Generation Script

For automated template generation with placeholder replacement:

```typescript
// generate-component.ts
import fs from 'fs';
import path from 'path';

interface ComponentConfig {
  ComponentName: string;      // PascalCase
  'component-name': string;   // kebab-case
}

function generateComponent(config: ComponentConfig) {
  const template = fs.readFileSync('templates/component.template.tsx', 'utf-8');

  let result = template;
  result = result.replace(/\{\{ComponentName\}\}/g, config.ComponentName);
  result = result.replace(/\{\{component-name\}\}/g, config['component-name']);

  const outputPath = `src/components/${config.ComponentName}.tsx`;
  fs.writeFileSync(outputPath, result);

  console.log(`✅ Generated: ${outputPath}`);
}

// Usage:
generateComponent({
  ComponentName: 'UserProfile',
  'component-name': 'user-profile'
});
```

## Validation Checklist

Before using templates in production:

- [ ] All placeholders replaced
- [ ] TypeScript compilation passes
- [ ] ESLint rules satisfied
- [ ] Prettier formatting applied
- [ ] Accessibility standards met (WCAG 2.1 AA)
- [ ] Unit tests written
- [ ] Props interface documented

## Best Practices

### Component Structure
```tsx
// 1. Imports (grouped and sorted)
import React, { useState, useEffect } from 'react';
import type { FC } from 'react';

// 2. Types/Interfaces
interface Props {
  title: string;
  onAction?: () => void;
}

// 3. Component
export const Component: FC<Props> = ({ title, onAction }) => {
  // 4. Hooks (state, effects, context)
  const [state, setState] = useState();

  // 5. Event handlers
  const handleClick = () => {};

  // 6. Render
  return <div>{title}</div>;
};
```

### File Naming Conventions
- Components: `PascalCase.tsx` (e.g., `UserProfile.tsx`)
- Hooks: `camelCase.ts` with `use` prefix (e.g., `useUserData.ts`)
- Context: `PascalCase` + `Context.tsx` (e.g., `AuthContext.tsx`)
- Tests: `ComponentName.test.tsx` in `__tests__/` directory

### TypeScript Guidelines
- Always define Props interface
- Use `FC<Props>` or explicit return type
- Prefer `type` over `interface` for unions
- Export types alongside components

## Common Customizations

### Adding Material-UI
```tsx
import { Button, TextField } from '@mui/material';
```

### Adding React Router
```tsx
import { useNavigate, useParams } from 'react-router-dom';
```

### Adding State Management
```tsx
// Redux Toolkit
import { useSelector, useDispatch } from 'react-redux';

// Zustand
import { useStore } from './store';
```

## Related Documentation

- [SKILL.md](../SKILL.md) - Quick reference for React patterns
- [REFERENCE.md](../REFERENCE.md) - Comprehensive React guide
- [examples/](../examples/) - Real-world implementation examples

---

**Status**: 🚧 Template creation in progress (TRD-028)

**Target**: 4 production-ready templates demonstrating modern React patterns
