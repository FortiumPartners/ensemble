# React Framework - Quick Reference

**Version**: 1.0.0
**Framework**: React 18+
**Use Case**: Fast lookups during active development

---

## When to Use

This skill is loaded by `frontend-developer` when:
- `package.json` contains `"react"` dependency (≥18.0.0)
- Project has `.jsx` or `.tsx` files in `src/`
- User explicitly mentions "React" in task description
- Next.js, Vite, or Create React App detected

**Minimum Detection Confidence**: 0.8 (80%)

---

## Quick Start

### Basic Component

```tsx
import { FC } from 'react';

interface Props {
  title: string;
  onAction?: () => void;
}

export const MyComponent: FC<Props> = ({ title, onAction }) => {
  return (
    <div>
      <h1>{title}</h1>
      <button onClick={onAction}>Action</button>
    </div>
  );
};
```

---

## Core Patterns

### 1. Component Design

#### Functional Component Structure

```tsx
// 1. Imports (grouped and sorted)
import { useState, useEffect } from 'react';
import type { FC, ReactNode } from 'react';

// 2. Types/Interfaces
interface Props {
  children: ReactNode;
  className?: string;
}

// 3. Component
export const Component: FC<Props> = ({ children, className }) => {
  // 4. Hooks (state, effects, context)
  const [state, setState] = useState<string>('');

  useEffect(() => {
    // Side effects
  }, []);

  // 5. Event handlers
  const handleClick = () => {
    setState('clicked');
  };

  // 6. Early returns (error states, loading)
  if (!children) return null;

  // 7. Main render
  return <div className={className}>{children}</div>;
};
```

#### Component Composition

```tsx
// Container/Presentational Pattern
interface User {
  id: number;
  name: string;
}

// Container: Logic and data fetching
export const UserProfileContainer: FC<{ userId: number }> = ({ userId }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/users/${userId}`)
      .then(res => res.json())
      .then(setUser)
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return <LoadingSpinner />;
  if (!user) return <ErrorMessage />;

  return <UserProfile user={user} />;
};

// Presentational: Pure UI
interface UserProfileProps {
  user: User;
}

export const UserProfile: FC<UserProfileProps> = ({ user }) => {
  return (
    <div>
      <h2>{user.name}</h2>
    </div>
  );
};
```

#### Compound Components

```tsx
interface TabsProps {
  children: ReactNode;
  defaultTab?: string;
}

interface TabsContextType {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabsContext = createContext<TabsContextType | undefined>(undefined);

export const Tabs: FC<TabsProps> & {
  List: FC<{ children: ReactNode }>;
  Tab: FC<{ id: string; children: ReactNode }>;
  Panel: FC<{ id: string; children: ReactNode }>;
} = ({ children, defaultTab = '' }) => {
  const [activeTab, setActiveTab] = useState(defaultTab);

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="tabs">{children}</div>
    </TabsContext.Provider>
  );
};

Tabs.List = ({ children }) => <div className="tabs-list">{children}</div>;

Tabs.Tab = ({ id, children }) => {
  const context = useContext(TabsContext);
  return (
    <button
      className={context?.activeTab === id ? 'active' : ''}
      onClick={() => context?.setActiveTab(id)}
    >
      {children}
    </button>
  );
};

Tabs.Panel = ({ id, children }) => {
  const context = useContext(TabsContext);
  return context?.activeTab === id ? <div>{children}</div> : null;
};

// Usage:
<Tabs defaultTab="tab1">
  <Tabs.List>
    <Tabs.Tab id="tab1">Tab 1</Tabs.Tab>
    <Tabs.Tab id="tab2">Tab 2</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel id="tab1">Content 1</Tabs.Panel>
  <Tabs.Panel id="tab2">Content 2</Tabs.Panel>
</Tabs>
```

---

### 2. Hooks

#### useState - Local State

```tsx
// Basic usage
const [count, setCount] = useState(0);
const [user, setUser] = useState<User | null>(null);

// Functional updates (when new state depends on old)
setCount(prevCount => prevCount + 1);

// Lazy initialization (expensive computation)
const [data, setData] = useState(() => {
  return expensiveComputation();
});
```

#### useEffect - Side Effects

```tsx
// Run once on mount
useEffect(() => {
  fetchData();
}, []); // Empty dependency array

// Run when dependencies change
useEffect(() => {
  fetchUser(userId);
}, [userId]);

// Cleanup function
useEffect(() => {
  const subscription = api.subscribe();

  return () => {
    subscription.unsubscribe(); // Cleanup on unmount
  };
}, []);

// Don't do this (missing dependency)
useEffect(() => {
  console.log(count); // 🚫 count should be in dependency array
}, []);
```

#### useContext - Consume Context

```tsx
// Context definition
interface ThemeContextType {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Provider
export const ThemeProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// Custom hook for consuming context
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

// Usage in component
const MyComponent = () => {
  const { theme, toggleTheme } = useTheme();
  return <div className={theme}>...</div>;
};
```

#### useReducer - Complex State

```tsx
interface State {
  count: number;
  status: 'idle' | 'loading' | 'success' | 'error';
}

type Action =
  | { type: 'increment' }
  | { type: 'decrement' }
  | { type: 'setLoading' }
  | { type: 'setSuccess' }
  | { type: 'setError' };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'increment':
      return { ...state, count: state.count + 1 };
    case 'decrement':
      return { ...state, count: state.count - 1 };
    case 'setLoading':
      return { ...state, status: 'loading' };
    case 'setSuccess':
      return { ...state, status: 'success' };
    case 'setError':
      return { ...state, status: 'error' };
    default:
      return state;
  }
};

const Counter = () => {
  const [state, dispatch] = useReducer(reducer, {
    count: 0,
    status: 'idle'
  });

  return (
    <div>
      <p>Count: {state.count}</p>
      <button onClick={() => dispatch({ type: 'increment' })}>+</button>
      <button onClick={() => dispatch({ type: 'decrement' })}>-</button>
    </div>
  );
};
```

#### useMemo - Expensive Computations

```tsx
const ExpensiveComponent = ({ items, filter }: Props) => {
  // Only recompute when items or filter changes
  const filteredItems = useMemo(() => {
    console.log('Filtering items...');
    return items.filter(item => item.includes(filter));
  }, [items, filter]);

  return (
    <ul>
      {filteredItems.map(item => <li key={item}>{item}</li>)}
    </ul>
  );
};
```

#### useCallback - Stable Function References

```tsx
const Parent = () => {
  const [count, setCount] = useState(0);
  const [other, setOther] = useState(0);

  // Without useCallback, this function is recreated on every render
  const handleClick = useCallback(() => {
    setCount(c => c + 1);
  }, []); // No dependencies = function never changes

  // Child won't re-render when 'other' changes
  return <MemoizedChild onClick={handleClick} />;
};

const MemoizedChild = memo(({ onClick }: { onClick: () => void }) => {
  console.log('Child rendered');
  return <button onClick={onClick}>Click</button>;
});
```

#### Custom Hooks

```tsx
// Custom hook for fetching data
function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    fetch(url, { signal: abortController.signal })
      .then(res => res.json())
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));

    return () => abortController.abort(); // Cleanup
  }, [url]);

  return { data, loading, error };
}

// Usage
const UserProfile = ({ userId }: { userId: number }) => {
  const { data: user, loading, error } = useFetch<User>(`/api/users/${userId}`);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!user) return <div>No user found</div>;

  return <div>{user.name}</div>;
};
```

---

### 3. State Management

#### Local State (useState)

```tsx
// Simple local state
const [isOpen, setIsOpen] = useState(false);

// Object state
const [form, setForm] = useState({
  email: '',
  password: ''
});

// Update object state
setForm(prev => ({ ...prev, email: 'new@email.com' }));
```

#### Global State (Context API)

```tsx
// Store definition
interface Store {
  user: User | null;
  setUser: (user: User | null) => void;
  logout: () => void;
}

const StoreContext = createContext<Store | undefined>(undefined);

export const StoreProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);

  const logout = () => {
    setUser(null);
    localStorage.removeItem('token');
  };

  return (
    <StoreContext.Provider value={{ user, setUser, logout }}>
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
};
```

#### Form State

```tsx
const LoginForm = () => {
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({ email: '', password: '' });
  const [touched, setTouched] = useState({ email: false, password: false });

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setValues(prev => ({ ...prev, [name]: value }));
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    const { name } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));

    // Validate on blur
    if (name === 'email' && !values.email.includes('@')) {
      setErrors(prev => ({ ...prev, email: 'Invalid email' }));
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Submit logic
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        name="email"
        value={values.email}
        onChange={handleChange}
        onBlur={handleBlur}
        aria-invalid={touched.email && !!errors.email}
        aria-describedby={errors.email ? 'email-error' : undefined}
      />
      {touched.email && errors.email && (
        <span id="email-error" role="alert">{errors.email}</span>
      )}
    </form>
  );
};
```

---

### 4. Accessibility (WCAG 2.1 AA)

#### Semantic HTML

```tsx
// ✅ Good: Semantic HTML
<button onClick={handleClick}>Click me</button>
<nav><a href="/about">About</a></nav>

// 🚫 Bad: Non-semantic with onClick
<div onClick={handleClick}>Click me</div>
```

#### ARIA Attributes

```tsx
// Labels for screen readers
<button aria-label="Close dialog">×</button>

// Descriptions
<input
  type="email"
  aria-describedby="email-hint"
/>
<span id="email-hint">We'll never share your email</span>

// Live regions for dynamic content
<div aria-live="polite" aria-atomic="true">
  {message}
</div>

// Hidden content (visually hidden but available to screen readers)
<span className="sr-only">Loading...</span>
```

#### Keyboard Navigation

```tsx
const Modal = ({ isOpen, onClose, children }: ModalProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Focus first focusable element
      dialogRef.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {children}
      <button onClick={onClose}>Close</button>
    </div>
  );
};
```

#### Focus Management

```tsx
const Dropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      menuRef.current?.focus();
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsOpen(false);
    buttonRef.current?.focus(); // Return focus to trigger
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        Menu
      </button>
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
        >
          <button role="menuitem" onClick={handleClose}>Item 1</button>
          <button role="menuitem" onClick={handleClose}>Item 2</button>
        </div>
      )}
    </>
  );
};
```

---

### 5. Performance Optimization

#### React.memo - Component Memoization

```tsx
// Prevents re-render if props haven't changed
export const ExpensiveComponent = memo(({ data }: { data: Data }) => {
  console.log('Rendering ExpensiveComponent');
  return <div>{/* expensive rendering */}</div>;
});

// Custom comparison function
export const CustomMemoComponent = memo(
  ({ user }: { user: User }) => {
    return <div>{user.name}</div>;
  },
  (prevProps, nextProps) => {
    // Return true if props are equal (skip re-render)
    return prevProps.user.id === nextProps.user.id;
  }
);
```

#### Code Splitting

```tsx
import { lazy, Suspense } from 'react';

// Lazy load component
const HeavyComponent = lazy(() => import('./HeavyComponent'));

const App = () => {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HeavyComponent />
    </Suspense>
  );
};

// Route-based code splitting
const routes = [
  {
    path: '/dashboard',
    component: lazy(() => import('./pages/Dashboard'))
  },
  {
    path: '/settings',
    component: lazy(() => import('./pages/Settings'))
  }
];
```

#### Debouncing User Input

```tsx
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// Usage
const SearchInput = () => {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 500);

  useEffect(() => {
    if (debouncedSearch) {
      // API call only fires 500ms after user stops typing
      fetchResults(debouncedSearch);
    }
  }, [debouncedSearch]);

  return <input value={search} onChange={e => setSearch(e.target.value)} />;
};
```

---

### 6. Testing

#### React Testing Library Basics

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

describe('Button', () => {
  it('renders with text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('handles click events', async () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click</Button>);

    await userEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('handles async operations', async () => {
    render(<AsyncButton />);

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByText(/success/i)).toBeInTheDocument();
    });
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Button>Click</Button>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

#### Testing Hooks

```tsx
import { renderHook, act } from '@testing-library/react';

describe('useCounter', () => {
  it('increments counter', () => {
    const { result } = renderHook(() => useCounter());

    act(() => {
      result.current.increment();
    });

    expect(result.current.count).toBe(1);
  });
});
```

---

## Anti-Patterns

### ❌ Don't: Mutate State Directly

```tsx
// 🚫 Bad
const [user, setUser] = useState({ name: 'John' });
user.name = 'Jane'; // Mutation!
setUser(user);

// ✅ Good
setUser({ ...user, name: 'Jane' });
```

### ❌ Don't: Use Index as Key

```tsx
// 🚫 Bad
{items.map((item, index) => <div key={index}>{item}</div>)}

// ✅ Good
{items.map(item => <div key={item.id}>{item}</div>)}
```

### ❌ Don't: Call Hooks Conditionally

```tsx
// 🚫 Bad
if (condition) {
  const [state, setState] = useState(0); // Conditional hook!
}

// ✅ Good
const [state, setState] = useState(0);
if (condition) {
  // Use state here
}
```

### ❌ Don't: Forget useEffect Dependencies

```tsx
// 🚫 Bad
useEffect(() => {
  fetchUser(userId); // userId not in dependency array!
}, []);

// ✅ Good
useEffect(() => {
  fetchUser(userId);
}, [userId]);
```

### ❌ Don't: Use Inline Functions in JSX (When Performance Matters)

```tsx
// 🚫 Bad (creates new function on every render)
<Button onClick={() => handleClick(id)}>Click</Button>

// ✅ Good (stable function reference)
const handleClickWithId = useCallback(() => handleClick(id), [id]);
<Button onClick={handleClickWithId}>Click</Button>
```

---

## TypeScript Quick Reference

### Component Props

```tsx
interface Props {
  // Required props
  title: string;
  count: number;

  // Optional props
  subtitle?: string;

  // Union types
  variant: 'primary' | 'secondary' | 'danger';

  // Functions
  onClick?: () => void;
  onSubmit: (data: FormData) => void;

  // Children
  children: ReactNode;

  // Complex types
  user: User;
  items: Item[];
}

export const Component: FC<Props> = ({ title, onClick }) => {
  return <div onClick={onClick}>{title}</div>;
};
```

### Event Handlers

```tsx
// Click events
const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
  console.log(e.currentTarget.value);
};

// Input events
const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
  console.log(e.target.value);
};

// Form events
const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
};

// Keyboard events
const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') {
    // Handle enter
  }
};
```

### Refs

```tsx
// DOM element refs
const inputRef = useRef<HTMLInputElement>(null);

useEffect(() => {
  inputRef.current?.focus();
}, []);

<input ref={inputRef} />

// Mutable value refs
const countRef = useRef(0);
countRef.current += 1;
```

---

## Integration Checklist

When using this skill:

- [ ] Components use TypeScript with strict types
- [ ] All interactive elements are keyboard accessible
- [ ] ARIA attributes added where semantic HTML isn't sufficient
- [ ] Performance optimization applied (memo, useMemo, useCallback)
- [ ] Unit tests written with React Testing Library
- [ ] Accessibility tests with jest-axe
- [ ] Custom hooks extracted for reusable logic
- [ ] Error boundaries implemented for error handling
- [ ] Code splitting applied for route-based chunks

---

## See Also

- **[REFERENCE.md](REFERENCE.md)** - Comprehensive React guide (10 sections)
- **[templates/](templates/)** - Code generation templates
- **[examples/](examples/)** - Real-world implementation examples

**Need more detail?** Load REFERENCE.md for comprehensive patterns and advanced use cases.

---

**Version**: 1.0.0 | **Last Updated**: 2025-10-22 | **Status**: Production Ready
