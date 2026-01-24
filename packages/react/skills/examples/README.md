# React Framework Examples

Real-world implementation examples demonstrating production-ready patterns and best practices.

## Available Examples

### 1. component-patterns.example.tsx

**Component Composition and Design Patterns**

Demonstrates:
- ✅ Functional components with TypeScript
- ✅ Component composition (container/presentational)
- ✅ Props interface design and validation
- ✅ Children patterns and render props
- ✅ Controlled vs uncontrolled components
- ✅ Error boundaries for graceful error handling
- ✅ Accessibility (ARIA attributes, keyboard navigation)

**Use this example when:**
- Building reusable component libraries
- Implementing component composition patterns
- Creating accessible user interfaces
- Structuring component hierarchies

**Key sections:**
1. Basic functional component with props
2. Container/presentational pattern
3. Render props pattern
4. Children as function pattern
5. Compound components pattern
6. Error boundary implementation

---

### 2. state-management.example.tsx

**State Management Approaches**

Demonstrates:
- ✅ useState for local state
- ✅ useReducer for complex state logic
- ✅ Context API for global state
- ✅ Custom hooks for state encapsulation
- ✅ State lifting patterns
- ✅ Optimistic UI updates
- ✅ Form state management

**Use this example when:**
- Managing complex state in React applications
- Implementing global state without Redux
- Building forms with validation
- Creating reusable state logic with custom hooks

**Key sections:**
1. Local state with useState
2. Complex state with useReducer
3. Context API implementation
4. Custom hooks for state logic
5. Form state management
6. Optimistic updates pattern

---

### 3. performance-optimization.example.tsx (Planned)

**Performance Optimization Techniques**

Will demonstrate:
- React.memo for component memoization
- useMemo for expensive computations
- useCallback for function memoization
- Code splitting with React.lazy and Suspense
- Virtual scrolling for large lists
- Debouncing and throttling

---

## How to Use These Examples

### 1. Copy the Pattern

Each example is self-contained and can be adapted to your needs:

```bash
# Copy example to your project
cp examples/component-patterns.example.tsx src/examples/

# Adapt to your domain
# Modify component names, props interfaces, and business logic
```

### 2. Install Dependencies

```bash
# Core React dependencies
npm install react react-dom

# TypeScript (if using TS)
npm install --save-dev @types/react @types/react-dom

# Testing utilities
npm install --save-dev @testing-library/react @testing-library/jest-dom

# Optional: State management
npm install zustand  # or redux, jotai, etc.
```

### 3. Configure Your Project

Add to your `tsconfig.json` (TypeScript projects):

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "target": "ES2020",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

### 4. Run Examples

```bash
# Development server (if using Vite)
npm run dev

# Development server (if using Create React App)
npm start

# Run tests
npm test
```

## Best Practices Checklist

When implementing these patterns, ensure:

- [ ] **TypeScript**: All components have proper type definitions
- [ ] **Accessibility**: ARIA attributes and keyboard navigation
- [ ] **Error Handling**: Error boundaries for graceful failures
- [ ] **Performance**: Memoization where appropriate
- [ ] **Testing**: Unit tests with ≥80% coverage
- [ ] **Documentation**: JSDoc comments for public APIs
- [ ] **Code Style**: Consistent formatting (Prettier/ESLint)
- [ ] **Props Validation**: TypeScript interfaces or PropTypes
- [ ] **State Management**: Appropriate state location (local vs global)
- [ ] **Side Effects**: Proper useEffect cleanup

## Common Customizations

### Change Styling Approach

#### CSS Modules
```tsx
import styles from './Component.module.css';

export const Component = () => (
  <div className={styles.container}>...</div>
);
```

#### Styled Components
```tsx
import styled from 'styled-components';

const Container = styled.div`
  padding: 20px;
`;

export const Component = () => <Container>...</Container>;
```

#### Tailwind CSS
```tsx
export const Component = () => (
  <div className="p-4 bg-blue-500 text-white">...</div>
);
```

### Add Form Validation

#### React Hook Form
```tsx
import { useForm } from 'react-hook-form';

export const FormComponent = () => {
  const { register, handleSubmit, formState: { errors } } = useForm();

  const onSubmit = (data) => console.log(data);

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('email', { required: true })} />
      {errors.email && <span>This field is required</span>}
    </form>
  );
};
```

### Add Routing

#### React Router
```tsx
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';

export const App = () => (
  <BrowserRouter>
    <nav>
      <Link to="/">Home</Link>
      <Link to="/about">About</Link>
    </nav>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
    </Routes>
  </BrowserRouter>
);
```

## Testing Examples

Each example includes test scenarios. Run tests with:

```bash
# Unit tests
npm test

# Coverage report
npm test -- --coverage

# Watch mode
npm test -- --watch
```

## Performance Considerations

### Component Memoization
```tsx
import { memo } from 'react';

export const ExpensiveComponent = memo(({ data }) => {
  return <div>{/* expensive rendering */}</div>;
});
```

### Code Splitting
```tsx
import { lazy, Suspense } from 'react';

const HeavyComponent = lazy(() => import('./HeavyComponent'));

export const App = () => (
  <Suspense fallback={<div>Loading...</div>}>
    <HeavyComponent />
  </Suspense>
);
```

## Accessibility Guidelines

All examples follow WCAG 2.1 AA standards:

- **Semantic HTML**: Use appropriate HTML elements
- **ARIA Attributes**: Add when semantic HTML isn't sufficient
- **Keyboard Navigation**: Tab order and focus management
- **Screen Reader Support**: Meaningful labels and descriptions
- **Color Contrast**: Text meets contrast ratios (4.5:1 for normal text)

## Version Compatibility

These examples are compatible with:
- React: 18.0+ (recommended 18.2+)
- TypeScript: 5.0+
- Node.js: 18+
- Testing Library: 14.0+

## Related Documentation

- [SKILL.md](../SKILL.md) - Quick reference patterns
- [REFERENCE.md](../REFERENCE.md) - Comprehensive guide
- [templates/](../templates/) - Code generation templates

## Need Help?

Refer to the comprehensive patterns in `REFERENCE.md`:

- **Components** → Section 1: Component Architecture
- **State** → Section 2: State Management
- **Hooks** → Section 3: Hooks & Effects
- **Performance** → Section 4: Performance Optimization
- **Testing** → Section 5: Testing Strategies
- **TypeScript** → Section 6: TypeScript Integration

---

**Status**: 🚧 Examples in progress (TRD-029)

**Target**: 2-3 real-world examples demonstrating modern React patterns (400-600 lines each)
