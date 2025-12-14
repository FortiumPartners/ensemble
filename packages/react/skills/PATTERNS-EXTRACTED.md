# React Framework Patterns - Extracted from react-component-architect.yaml

**Source Agent**: react-component-architect.yaml (v1.0.1, 3.2KB)
**Extraction Date**: 2025-10-22
**Purpose**: Identify core patterns to inform SKILL.md and REFERENCE.md structure

---

## Agent Metadata Analysis

**Agent Profile**:
- **Name**: react-component-architect
- **Version**: 1.0.1
- **Category**: framework-specialist
- **Size**: 3.2KB (73 lines)
- **Tools**: Read, Write, Edit, Bash (minimal, appropriate for frontend work)

**Mission Statement**:
> "React component architecture specialist responsible for designing and implementing composable, accessible, and performant React components using modern patterns."

**Key Focus Areas**:
1. Composability and reusability
2. Modern React patterns (hooks)
3. Accessibility (WCAG 2.1 AA)
4. Performance optimization

---

## Core Expertise Areas (Extracted from Responsibilities)

### 1. Component Design (Priority: High)

**Responsibility**: Build composable, reusable components with clear props interfaces

**Key Patterns to Document**:
- Component composition patterns
- Props interface design
- Component hierarchies
- Container/presentational pattern
- Compound components
- Render props pattern
- Children patterns

**SKILL.md Coverage**:
```markdown
## Component Design Patterns

### Basic Functional Component
- Clear props interface with TypeScript
- Single responsibility principle
- Proper destructuring of props

### Component Composition
- Container/presentational separation
- Compound components pattern
- Render props for flexibility
```

**REFERENCE.md Coverage**:
- Deep dive into composition patterns
- Advanced patterns (HOCs, render props, compound components)
- Component design principles (SOLID applied to React)
- Props drilling avoidance strategies
- Component API design

---

### 2. Hooks Implementation (Priority: High)

**Responsibility**: Leverage modern React hooks (useState, useEffect, useContext, custom hooks)

**Key Patterns to Document**:
- Built-in hooks usage:
  - `useState` for local state
  - `useEffect` for side effects and cleanup
  - `useContext` for consuming context
  - `useReducer` for complex state logic
  - `useMemo` for expensive computations
  - `useCallback` for function memoization
  - `useRef` for DOM access and mutable values
- Custom hooks for reusable logic
- Hook rules and best practices
- Dependency array management

**SKILL.md Coverage**:
```markdown
## Hooks Patterns

### useState
- Local component state
- State updater functions
- Functional updates

### useEffect
- Side effects with cleanup
- Dependency management
- Common pitfalls

### Custom Hooks
- Extracting reusable logic
- Naming conventions (use prefix)
- Return value patterns
```

**REFERENCE.md Coverage**:
- Comprehensive hook documentation
- All built-in hooks with examples
- Custom hook patterns and best practices
- Advanced use cases (useImperativeHandle, useLayoutEffect)
- Hook composition strategies
- Common mistakes and how to avoid them

---

### 3. State Management (Priority: High)

**Responsibility**: Implement component-level and application-level state patterns

**Key Patterns to Document**:
- Component-level state (useState, useReducer)
- Application-level state (Context API)
- State lifting patterns
- Prop drilling avoidance
- State colocation
- Third-party solutions (Redux, Zustand, Jotai)
- Form state management
- Async state patterns

**SKILL.md Coverage**:
```markdown
## State Management

### Local State
- useState for simple state
- useReducer for complex state

### Global State
- Context API for shared state
- When to use vs prop drilling

### Best Practices
- State colocation
- Lift state only when needed
- Avoid unnecessary rerenders
```

**REFERENCE.md Coverage**:
- State management architectures
- Context API deep dive
- Redux integration patterns
- Form libraries (React Hook Form, Formik)
- Async state handling
- Optimistic updates
- State normalization

---

### 4. Accessibility (a11y) (Priority: Medium)

**Responsibility**: Ensure WCAG 2.1 AA compliance with semantic HTML and ARIA

**Key Patterns to Document**:
- Semantic HTML usage
- ARIA attributes (roles, labels, describedby)
- Keyboard navigation
- Focus management
- Screen reader support
- Color contrast requirements
- Form accessibility
- Modal/dialog accessibility

**SKILL.md Coverage**:
```markdown
## Accessibility Essentials

### Semantic HTML
- Use appropriate HTML elements
- Button vs div with onClick

### ARIA Attributes
- aria-label for screen readers
- aria-describedby for hints
- role attribute when needed

### Keyboard Navigation
- Tab order management
- Focus indicators
- Escape key handling
```

**REFERENCE.md Coverage**:
- WCAG 2.1 AA comprehensive guide
- Semantic HTML reference
- Complete ARIA attribute guide
- Keyboard navigation patterns
- Focus management strategies
- Screen reader testing
- Accessibility testing tools
- Common accessibility issues and fixes

---

### 5. Performance Optimization (Priority: Medium)

**Responsibility**: Implement memoization, code splitting, and rendering optimization

**Key Patterns to Document**:
- React.memo for component memoization
- useMemo for expensive computations
- useCallback for function identity
- Code splitting with React.lazy and Suspense
- Virtual scrolling for large lists
- Debouncing and throttling
- Bundle size optimization
- Image optimization

**SKILL.md Coverage**:
```markdown
## Performance Patterns

### Memoization
- React.memo for pure components
- useMemo for expensive calculations
- useCallback for stable function references

### Code Splitting
- React.lazy for dynamic imports
- Suspense boundaries
- Route-based splitting
```

**REFERENCE.md Coverage**:
- Performance profiling with React DevTools
- Rendering optimization strategies
- Code splitting techniques
- Bundle analysis and optimization
- Virtual scrolling implementations
- Web Vitals and React
- Performance testing
- Common performance anti-patterns

---

### 6. Testing Strategy (Priority: Medium)

**Responsibility**: Write co-located tests for components (unit, integration, visual)

**Key Patterns to Document**:
- React Testing Library patterns
- Unit testing components
- Integration testing user flows
- Mocking and test utilities
- Accessibility testing (jest-axe)
- Snapshot testing considerations
- Test organization

**SKILL.md Coverage**:
```markdown
## Testing Components

### React Testing Library
- Render components
- Query by accessibility role
- User event simulation
- Async operations

### Best Practices
- Test user behavior, not implementation
- Accessibility-first queries
- Co-locate tests with components
```

**REFERENCE.md Coverage**:
- Complete testing guide
- React Testing Library deep dive
- Testing hooks
- Testing context and providers
- Integration testing strategies
- Visual regression testing
- E2E testing with Playwright
- Test coverage guidelines

---

### 7. Type Safety (Priority: Low)

**Responsibility**: Leverage TypeScript for robust type definitions and prop validation

**Key Patterns to Document**:
- Props interfaces
- Event handler types
- Generic components
- Ref types
- Children types
- Union types for variants
- Type guards

**SKILL.md Coverage**:
```markdown
## TypeScript Patterns

### Props Interface
- Define clear prop types
- Optional vs required props
- Union types for variants

### Common Types
- FC<Props> for components
- ReactNode for children
- Event handler types
```

**REFERENCE.md Coverage**:
- TypeScript integration guide
- Advanced type patterns
- Generic components
- Type utilities
- Discriminated unions
- Type inference
- Common TypeScript issues

---

### 8. Styling Integration (Priority: Low)

**Responsibility**: Implement CSS-in-JS, CSS Modules, or Tailwind CSS patterns

**Key Patterns to Document**:
- CSS Modules
- Styled Components
- Emotion
- Tailwind CSS
- CSS-in-JS best practices
- Theme support
- Responsive design

**SKILL.md Coverage**:
```markdown
## Styling Approaches

### CSS Modules
- Scoped styles
- Composition

### CSS-in-JS
- Styled Components
- Emotion
- Dynamic styling

### Utility-First
- Tailwind CSS patterns
```

**REFERENCE.md Coverage**:
- Styling strategies comparison
- CSS Modules deep dive
- Styled Components guide
- Tailwind integration
- Theme implementation
- Dark mode support
- Responsive patterns

---

## Integration Protocols Analysis

### Handoff From (Input)

1. **tech-lead-orchestrator**: Receives React-specific UI implementation tasks from TRD breakdown
2. **ensemble-orchestrator**: Receives React frontend tasks requiring component architecture expertise
3. **frontend-developer**: Receives tasks specifically requiring React patterns and best practices
4. **backend-developer**: Receives API integration requirements for data-driven components

**Skill Loading Trigger**: When frontend-developer detects React framework and needs React-specific expertise

### Handoff To (Output)

1. **test-runner**: Delegates test execution after implementing React components
2. **code-reviewer**: Delegates comprehensive review before PR creation
3. **playwright-tester**: Delegates E2E testing for complex user flows

**Quality Gates**: Tests passing, accessibility validated, performance benchmarks met

---

## Content Structure Recommendations

### SKILL.md Structure (≤100KB, Quick Reference)

```markdown
# React Framework - Quick Reference

## When to Use
[Detection criteria]

## Core Patterns
### Component Design
[Essential patterns with brief examples]

### Hooks
[Most common hooks with usage]

### State Management
[Local and global state patterns]

### Accessibility
[Critical a11y checklist]

### Performance
[Key optimization techniques]

## Anti-Patterns
[Common mistakes to avoid]

## Quick Integration
[How to use templates and examples]

## See Also
[Links to REFERENCE.md sections]
```

### REFERENCE.md Structure (≤1MB, Comprehensive)

```markdown
# React Framework - Comprehensive Guide

## Section 1: Component Architecture
[Deep dive into component patterns]

## Section 2: Hooks & Effects
[All hooks with advanced examples]

## Section 3: State Management
[Complete state patterns including Context, Redux]

## Section 4: Accessibility (WCAG 2.1 AA)
[Comprehensive accessibility guide]

## Section 5: Performance Optimization
[Profiling, memoization, code splitting]

## Section 6: Testing Strategies
[React Testing Library, integration, E2E]

## Section 7: TypeScript Integration
[Advanced type patterns]

## Section 8: Styling Approaches
[CSS Modules, CSS-in-JS, Tailwind]

## Section 9: Advanced Patterns
[HOCs, render props, compound components]

## Section 10: Best Practices
[Production-ready patterns]
```

---

## Template Requirements (Based on Agent Patterns)

### 1. component.template.tsx
- Functional component with TypeScript
- Props interface
- useState/useEffect hooks
- Accessibility attributes
- JSDoc documentation

### 2. context.template.tsx
- Context creation
- Provider component
- Custom hook for consumption
- TypeScript types

### 3. hook.template.ts
- Custom hook with TypeScript
- State and effect management
- Return value interface
- Cleanup logic

### 4. component.test.template.tsx
- React Testing Library setup
- Render and query tests
- User interaction tests
- Accessibility tests with jest-axe

---

## Example Requirements (Based on Agent Patterns)

### 1. component-patterns.example.tsx
- Container/presentational pattern
- Compound components
- Render props
- Children patterns
- Error boundaries

### 2. state-management.example.tsx
- useState patterns
- useReducer for complex state
- Context API implementation
- Custom hooks for state
- Form management

---

## Quality Standards (Derived from Agent)

### Documentation
- JSDoc comments for public APIs
- Props interface documentation
- Usage examples in code comments

### Testing
- Unit tests: ≥80% coverage
- Integration tests: Key user flows
- Accessibility tests: 100% of interactive components

### Accessibility
- WCAG 2.1 AA compliance
- Semantic HTML
- Keyboard navigation
- Screen reader support

### Performance
- React.memo where appropriate
- Code splitting for routes
- Bundle size monitoring
- Web Vitals tracking

### Type Safety
- TypeScript for all components
- Strict mode enabled
- No `any` types without justification

---

## Feature Parity Checklist

Comparing skill against react-component-architect.yaml:

- [ ] **Component Design**: ≥95% coverage of composition patterns
- [ ] **Hooks Implementation**: All built-in hooks + custom hook patterns
- [ ] **State Management**: Local, global, and form state patterns
- [ ] **Accessibility**: Complete WCAG 2.1 AA guide
- [ ] **Performance**: Memoization, code splitting, optimization techniques
- [ ] **Testing**: React Testing Library + integration + accessibility
- [ ] **TypeScript**: Props, events, generics, type utilities
- [ ] **Styling**: CSS Modules, CSS-in-JS, Tailwind patterns

**Target**: ≥95% feature parity

---

## Key Insights for Implementation

### Agent Size Considerations
- Original agent: 3.2KB (very focused)
- SKILL.md can be more expansive (≤100KB) - significant room for detail
- REFERENCE.md can be comprehensive (≤1MB) - full coverage possible

### Priority Focus
1. **High Priority** (SKILL.md essentials):
   - Component design patterns
   - Hooks usage
   - State management basics

2. **Medium Priority** (SKILL.md + REFERENCE.md):
   - Accessibility checklist
   - Performance basics
   - Testing patterns

3. **Low Priority** (REFERENCE.md deep dives):
   - TypeScript advanced patterns
   - Styling integrations
   - Advanced patterns

### Integration Points
- Skill loads when frontend-developer detects React
- Handoff to test-runner for test execution
- Handoff to code-reviewer for quality gates
- Collaboration with backend-developer for API integration

---

## Next Steps (TRD-026 & TRD-027)

1. **TRD-026: Write SKILL.md**
   - Focus on high-priority patterns
   - Include quick reference examples
   - Add anti-patterns section
   - Target ≤50KB for fast loading

2. **TRD-027: Write REFERENCE.md**
   - Comprehensive 10-section guide
   - 100+ code examples
   - Cover all 8 expertise areas
   - Target ≤500KB

---

**Extraction Complete**: Ready for SKILL.md and REFERENCE.md implementation

**Pattern Count**: 8 major expertise areas, 25+ specific patterns identified

**Feature Parity Target**: ≥95% (significant expansion possible due to size budget)
