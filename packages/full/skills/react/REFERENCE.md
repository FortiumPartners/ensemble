# React Framework - Comprehensive Guide

**Version**: 1.0.0
**Framework**: React 18+
**Use Case**: Deep dives, learning new patterns, comprehensive reference

---

## Table of Contents

1. [Component Architecture](#1-component-architecture)
2. [Hooks & Effects](#2-hooks--effects)
3. [State Management](#3-state-management)
4. [Accessibility (WCAG 2.1 AA)](#4-accessibility-wcag-21-aa)
5. [Performance Optimization](#5-performance-optimization)
6. [Testing Strategies](#6-testing-strategies)
7. [TypeScript Integration](#7-typescript-integration)
8. [Styling Approaches](#8-styling-approaches)
9. [Advanced Patterns](#9-advanced-patterns)
10. [Best Practices](#10-best-practices)

---

## 1. Component Architecture

### 1.1 Functional Components

#### Basic Structure

```tsx
import { FC, ReactNode } from 'react';

interface ComponentProps {
  title: string;
  children?: ReactNode;
  className?: string;
}

/**
 * Component description
 * @param title - The component title
 * @param children - Child elements
 * @param className - Optional CSS class
 */
export const Component: FC<ComponentProps> = ({
  title,
  children,
  className = ''
}) => {
  return (
    <div className={className}>
      <h1>{title}</h1>
      {children}
    </div>
  );
};

// Default props alternative (TypeScript)
Component.defaultProps = {
  className: 'default-class'
};
```

#### Component Organization

```
components/
├── Button/
│   ├── Button.tsx           # Component implementation
│   ├── Button.module.css    # Scoped styles
│   ├── Button.test.tsx      # Unit tests
│   ├── Button.stories.tsx   # Storybook stories
│   └── index.ts             # Public API
```

### 1.2 Container/Presentational Pattern

#### Container Component (Logic)

```tsx
import { useState, useEffect } from 'react';
import { UserProfile } from './UserProfile';
import type { User } from './types';

export const UserProfileContainer: FC<{ userId: number }> = ({ userId }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch(`/api/users/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch user');
        const data = await response.json();
        setUser(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [userId]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error.message} />;
  if (!user) return <NotFound />;

  return <UserProfile user={user} />;
};
```

#### Presentational Component (UI)

```tsx
import type { FC } from 'react';
import type { User } from './types';

interface UserProfileProps {
  user: User;
}

/**
 * Pure presentational component for displaying user profile
 * No data fetching, no side effects, just UI
 */
export const UserProfile: FC<UserProfileProps> = ({ user }) => {
  return (
    <article className="user-profile">
      <img src={user.avatar} alt={`${user.name}'s avatar`} />
      <h1>{user.name}</h1>
      <p>{user.bio}</p>
      <dl>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Joined</dt>
        <dd>{new Date(user.createdAt).toLocaleDateString()}</dd>
      </dl>
    </article>
  );
};
```

### 1.3 Compound Components

```tsx
import { createContext, useContext, useState, FC, ReactNode } from 'react';

// Context for internal state
interface AccordionContextType {
  openItems: Set<string>;
  toggle: (id: string) => void;
}

const AccordionContext = createContext<AccordionContextType | undefined>(undefined);

const useAccordionContext = () => {
  const context = useContext(AccordionContext);
  if (!context) {
    throw new Error('Accordion components must be used within Accordion');
  }
  return context;
};

// Main Accordion component
interface AccordionProps {
  children: ReactNode;
  allowMultiple?: boolean;
}

export const Accordion: FC<AccordionProps> & {
  Item: typeof AccordionItem;
  Trigger: typeof AccordionTrigger;
  Content: typeof AccordionContent;
} = ({ children, allowMultiple = false }) => {
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setOpenItems(prev => {
      const next = new Set(allowMultiple ? prev : []);
      if (prev.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <AccordionContext.Provider value={{ openItems, toggle }}>
      <div className="accordion">{children}</div>
    </AccordionContext.Provider>
  );
};

// Accordion.Item
interface AccordionItemProps {
  id: string;
  children: ReactNode;
}

const AccordionItem: FC<AccordionItemProps> = ({ id, children }) => {
  return <div className="accordion-item" data-id={id}>{children}</div>;
};

// Accordion.Trigger
interface AccordionTriggerProps {
  id: string;
  children: ReactNode;
}

const AccordionTrigger: FC<AccordionTriggerProps> = ({ id, children }) => {
  const { openItems, toggle } = useAccordionContext();
  const isOpen = openItems.has(id);

  return (
    <button
      className="accordion-trigger"
      onClick={() => toggle(id)}
      aria-expanded={isOpen}
      aria-controls={`accordion-content-${id}`}
    >
      {children}
      <span className="icon" aria-hidden="true">
        {isOpen ? '−' : '+'}
      </span>
    </button>
  );
};

// Accordion.Content
interface AccordionContentProps {
  id: string;
  children: ReactNode;
}

const AccordionContent: FC<AccordionContentProps> = ({ id, children }) => {
  const { openItems } = useAccordionContext();
  const isOpen = openItems.has(id);

  if (!isOpen) return null;

  return (
    <div
      id={`accordion-content-${id}`}
      className="accordion-content"
      role="region"
    >
      {children}
    </div>
  );
};

// Attach sub-components
Accordion.Item = AccordionItem;
Accordion.Trigger = AccordionTrigger;
Accordion.Content = AccordionContent;

// Usage:
<Accordion allowMultiple>
  <Accordion.Item id="item-1">
    <Accordion.Trigger id="item-1">What is React?</Accordion.Trigger>
    <Accordion.Content id="item-1">
      React is a JavaScript library for building user interfaces.
    </Accordion.Content>
  </Accordion.Item>
  <Accordion.Item id="item-2">
    <Accordion.Trigger id="item-2">Why use React?</Accordion.Trigger>
    <Accordion.Content id="item-2">
      React makes it easy to build interactive UIs.
    </Accordion.Content>
  </Accordion.Item>
</Accordion>
```

### 1.4 Render Props Pattern

```tsx
import { Component, ReactNode } from 'react';

interface MousePosition {
  x: number;
  y: number;
}

interface MouseTrackerProps {
  render: (position: MousePosition) => ReactNode;
}

interface MouseTrackerState {
  position: MousePosition;
}

class MouseTracker extends Component<MouseTrackerProps, MouseTrackerState> {
  state: MouseTrackerState = {
    position: { x: 0, y: 0 }
  };

  handleMouseMove = (event: MouseEvent) => {
    this.setState({
      position: {
        x: event.clientX,
        y: event.clientY
      }
    });
  };

  componentDidMount() {
    window.addEventListener('mousemove', this.handleMouseMove);
  }

  componentWillUnmount() {
    window.removeEventListener('mousemove', this.handleMouseMove);
  }

  render() {
    return this.props.render(this.state.position);
  }
}

// Usage:
<MouseTracker
  render={({ x, y }) => (
    <div>
      Mouse position: ({x}, {y})
    </div>
  )}
/>

// Modern hook alternative:
function useMousePosition() {
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      setPosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return position;
}

// Usage:
const MyComponent = () => {
  const { x, y } = useMousePosition();
  return <div>Mouse: ({x}, {y})</div>;
};
```

### 1.5 Error Boundaries

```tsx
import { Component, ReactNode, ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    this.props.onError?.(error, errorInfo);

    // Log to error reporting service
    // logErrorToService(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div role="alert" className="error-boundary">
          <h2>Something went wrong</h2>
          <details>
            <summary>Error details</summary>
            <pre>{this.state.error?.toString()}</pre>
          </details>
          <button onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Usage:
<ErrorBoundary
  fallback={<ErrorFallback />}
  onError={(error, info) => logToSentry(error, info)}
>
  <App />
</ErrorBoundary>
```

---

## 2. Hooks & Effects

### 2.1 useState Deep Dive

#### Functional Updates

```tsx
// When new state depends on previous state
const [count, setCount] = useState(0);

// ❌ Bad: Race condition possible
setCount(count + 1);

// ✅ Good: Functional update
setCount(prevCount => prevCount + 1);

// Multiple updates in same render
const handleClick = () => {
  setCount(c => c + 1); // 0 -> 1
  setCount(c => c + 1); // 1 -> 2
  setCount(c => c + 1); // 2 -> 3
  // Final value: 3
};
```

#### Lazy Initialization

```tsx
// Expensive computation only runs once
const [data, setData] = useState(() => {
  const stored = localStorage.getItem('data');
  return stored ? JSON.parse(stored) : initialData;
});

// ❌ Bad: Runs on every render
const [data, setData] = useState(
  JSON.parse(localStorage.getItem('data') || '{}')
);
```

#### Object State Updates

```tsx
interface FormState {
  email: string;
  password: string;
  rememberMe: boolean;
}

const [form, setForm] = useState<FormState>({
  email: '',
  password: '',
  rememberMe: false
});

// Update single field
const handleEmailChange = (email: string) => {
  setForm(prev => ({ ...prev, email }));
};

// Reset form
const resetForm = () => {
  setForm({ email: '', password: '', rememberMe: false });
};
```

### 2.2 useEffect Deep Dive

#### Dependency Management

```tsx
const [userId, setUserId] = useState(1);
const [user, setUser] = useState<User | null>(null);

// ✅ Good: All dependencies listed
useEffect(() => {
  const fetchUser = async () => {
    const response = await fetch(`/api/users/${userId}`);
    const data = await response.json();
    setUser(data);
  };

  fetchUser();
}, [userId]); // Runs when userId changes

// ❌ Bad: Missing dependency
useEffect(() => {
  fetch(`/api/users/${userId}`); // userId not in deps!
}, []);
```

#### Cleanup Functions

```tsx
// Subscription cleanup
useEffect(() => {
  const subscription = api.subscribe(data => {
    console.log(data);
  });

  return () => {
    subscription.unsubscribe(); // Cleanup on unmount
  };
}, []);

// Event listener cleanup
useEffect(() => {
  const handleResize = () => {
    setWindowWidth(window.innerWidth);
  };

  window.addEventListener('resize', handleResize);

  return () => {
    window.removeEventListener('resize', handleResize);
  };
}, []);

// Abort fetch on unmount
useEffect(() => {
  const abortController = new AbortController();

  fetch('/api/data', { signal: abortController.signal })
    .then(res => res.json())
    .then(setData)
    .catch(err => {
      if (err.name !== 'AbortError') {
        setError(err);
      }
    });

  return () => {
    abortController.abort(); // Cancel pending request
  };
}, []);
```

#### Conditional Effects

```tsx
// Skip effect conditionally
useEffect(() => {
  if (!userId) return; // Early return

  fetchUser(userId);
}, [userId]);

// Effect with multiple conditions
useEffect(() => {
  if (isAuthenticated && hasPermission) {
    loadUserData();
  }
}, [isAuthenticated, hasPermission]);
```

### 2.3 useContext Deep Dive

#### Context with TypeScript

```tsx
import { createContext, useContext, useState, FC, ReactNode } from 'react';

// Define context type
interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

// Create context with undefined default
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Provider component
export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) throw new Error('Login failed');

      const data = await response.json();
      setUser(data.user);
      localStorage.setItem('token', data.token);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setUser(null);
    localStorage.removeItem('token');
    await fetch('/api/auth/logout', { method: 'POST' });
  };

  const value = { user, login, logout, isLoading };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Custom hook with error handling
export const useAuth = () => {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
};

// Usage in component
const LoginButton = () => {
  const { login, isLoading } = useAuth();

  const handleLogin = async () => {
    await login('user@example.com', 'password');
  };

  return (
    <button onClick={handleLogin} disabled={isLoading}>
      {isLoading ? 'Logging in...' : 'Login'}
    </button>
  );
};
```

### 2.4 useReducer Deep Dive

#### Complex State Management

```tsx
interface State {
  data: Item[];
  loading: boolean;
  error: string | null;
  filter: string;
  sort: 'asc' | 'desc';
}

type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: Item[] }
  | { type: 'FETCH_ERROR'; payload: string }
  | { type: 'SET_FILTER'; payload: string }
  | { type: 'SET_SORT'; payload: 'asc' | 'desc' }
  | { type: 'RESET' };

const initialState: State = {
  data: [],
  loading: false,
  error: null,
  filter: '',
  sort: 'asc'
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };

    case 'FETCH_SUCCESS':
      return { ...state, loading: false, data: action.payload };

    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.payload };

    case 'SET_FILTER':
      return { ...state, filter: action.payload };

    case 'SET_SORT':
      return { ...state, sort: action.payload };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
};

// Usage
const DataTable = () => {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    dispatch({ type: 'FETCH_START' });

    fetch('/api/items')
      .then(res => res.json())
      .then(data => dispatch({ type: 'FETCH_SUCCESS', payload: data }))
      .catch(err => dispatch({ type: 'FETCH_ERROR', payload: err.message }));
  }, []);

  const filteredAndSortedData = useMemo(() => {
    return state.data
      .filter(item => item.name.includes(state.filter))
      .sort((a, b) => {
        return state.sort === 'asc'
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      });
  }, [state.data, state.filter, state.sort]);

  return (
    <div>
      <input
        value={state.filter}
        onChange={e => dispatch({ type: 'SET_FILTER', payload: e.target.value })}
      />
      <button onClick={() => dispatch({ type: 'SET_SORT', payload: state.sort === 'asc' ? 'desc' : 'asc' })}>
        Sort {state.sort}
      </button>
      {state.loading && <div>Loading...</div>}
      {state.error && <div>Error: {state.error}</div>}
      <ul>
        {filteredAndSortedData.map(item => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </div>
  );
};
```

### 2.5 useMemo & useCallback

#### useMemo for Expensive Computations

```tsx
const ExpensiveList = ({ items, filter }: Props) => {
  // Without useMemo: Recalculates on every render
  // const filtered = items.filter(item => item.includes(filter));

  // With useMemo: Only recalculates when dependencies change
  const filtered = useMemo(() => {
    console.log('Filtering items...');
    return items.filter(item => item.name.includes(filter));
  }, [items, filter]);

  return (
    <ul>
      {filtered.map(item => <li key={item.id}>{item.name}</li>)}
    </ul>
  );
};
```

#### useCallback for Stable Function References

```tsx
const Parent = () => {
  const [count, setCount] = useState(0);
  const [other, setOther] = useState(0);

  // Without useCallback: New function on every render
  // const handleClick = () => setCount(c => c + 1);

  // With useCallback: Same function reference
  const handleClick = useCallback(() => {
    setCount(c => c + 1);
  }, []); // No dependencies = never changes

  // useCallback with dependencies
  const handleClickWithOther = useCallback(() => {
    setCount(c => c + other);
  }, [other]); // New function only when 'other' changes

  return (
    <>
      <p>Count: {count}</p>
      <p>Other: {other}</p>
      <MemoizedChild onClick={handleClick} />
      <button onClick={() => setOther(o => o + 1)}>Increment Other</button>
    </>
  );
};

const MemoizedChild = memo(({ onClick }: { onClick: () => void }) => {
  console.log('Child rendered');
  return <button onClick={onClick}>Increment Count</button>;
});
```

### 2.6 Custom Hooks

#### useFetch Hook

```tsx
interface UseFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

function useFetch<T>(url: string, options?: RequestInit): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refetchIndex, setRefetchIndex] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(url, {
          ...options,
          signal: abortController.signal
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();
        setData(json);
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    return () => abortController.abort();
  }, [url, refetchIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useCallback(() => {
    setRefetchIndex(prev => prev + 1);
  }, []);

  return { data, loading, error, refetch };
}

// Usage
const UserProfile = ({ userId }: { userId: number }) => {
  const { data: user, loading, error, refetch } = useFetch<User>(
    `/api/users/${userId}`
  );

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!user) return <div>No user found</div>;

  return (
    <div>
      <h1>{user.name}</h1>
      <button onClick={refetch}>Refresh</button>
    </div>
  );
};
```

#### useLocalStorage Hook

```tsx
function useLocalStorage<T>(key: string, initialValue: T) {
  // State to store our value
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  // Return a wrapped version of useState's setter function
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      // Allow value to be a function
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;

      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue] as const;
}

// Usage
const Settings = () => {
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('theme', 'light');

  return (
    <div>
      <p>Current theme: {theme}</p>
      <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
        Toggle theme
      </button>
    </div>
  );
};
```

---

## 3. State Management

### 3.1 Local Component State

#### When to Use Local State

- UI state (open/closed, selected, hovered)
- Form input values
- Temporary data not shared with other components
- Data that doesn't need to persist

#### useState vs useReducer

```tsx
// useState: Simple state updates
const [count, setCount] = useState(0);
setCount(count + 1);

// useReducer: Complex state logic with multiple sub-values
const [state, dispatch] = useReducer(reducer, initialState);
dispatch({ type: 'INCREMENT' });
```

### 3.2 Context API for Global State

#### Multi-Level Context

```tsx
// Theme Context
const ThemeContext = createContext<'light' | 'dark'>('light');

// Auth Context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Combined Provider
export const AppProviders: FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [user, setUser] = useState<User | null>(null);

  return (
    <ThemeContext.Provider value={theme}>
      <AuthContext.Provider value={{ user, setUser }}>
        {children}
      </AuthContext.Provider>
    </ThemeContext.Provider>
  );
};
```

#### Context Performance Optimization

```tsx
// Split contexts by update frequency
const UserContext = createContext<User | null>(null); // Rarely changes
const UserActionsContext = createContext<UserActions | null>(null); // Never changes

export const UserProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);

  // Memoize actions to prevent unnecessary re-renders
  const actions = useMemo(() => ({
    login: async (email: string, password: string) => {
      const user = await api.login(email, password);
      setUser(user);
    },
    logout: () => setUser(null)
  }), []);

  return (
    <UserContext.Provider value={user}>
      <UserActionsContext.Provider value={actions}>
        {children}
      </UserActionsContext.Provider>
    </UserContext.Provider>
  );
};

// Components only re-render when user changes, not on every render
const UserName = () => {
  const user = useContext(UserContext);
  return <div>{user?.name}</div>;
};

// This component never re-renders because actions is memoized
const LoginButton = () => {
  const actions = useContext(UserActionsContext);
  return <button onClick={() => actions?.login('email', 'pass')}>Login</button>;
};
```

### 3.3 Third-Party State Management

#### Zustand Example

```tsx
import create from 'zustand';

interface StoreState {
  count: number;
  user: User | null;
  increment: () => void;
  setUser: (user: User) => void;
}

const useStore = create<StoreState>((set) => ({
  count: 0,
  user: null,
  increment: () => set((state) => ({ count: state.count + 1 })),
  setUser: (user) => set({ user })
}));

// Usage
const Counter = () => {
  const count = useStore((state) => state.count);
  const increment = useStore((state) => state.increment);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={increment}>Increment</button>
    </div>
  );
};
```

#### Redux Toolkit Example

```tsx
import { configureStore, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';

interface CounterState {
  value: number;
}

const counterSlice = createSlice({
  name: 'counter',
  initialState: { value: 0 } as CounterState,
  reducers: {
    increment: (state) => {
      state.value += 1; // Immer allows direct mutation
    },
    decrement: (state) => {
      state.value -= 1;
    },
    incrementByAmount: (state, action: PayloadAction<number>) => {
      state.value += action.payload;
    }
  }
});

export const { increment, decrement, incrementByAmount } = counterSlice.actions;

const store = configureStore({
  reducer: {
    counter: counterSlice.reducer
  }
});

type RootState = ReturnType<typeof store.getState>;
type AppDispatch = typeof store.dispatch;

// Typed hooks
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

// Usage
const Counter = () => {
  const count = useAppSelector((state) => state.counter.value);
  const dispatch = useAppDispatch();

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => dispatch(increment())}>Increment</button>
      <button onClick={() => dispatch(decrement())}>Decrement</button>
    </div>
  );
};
```

### 3.4 Form State Management

#### React Hook Form

```tsx
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  age: z.number().min(18, 'Must be at least 18')
});

type FormData = z.infer<typeof schema>;

const RegistrationForm = () => {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: '',
      password: '',
      age: 18
    }
  });

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    await api.register(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          {...register('email')}
          aria-invalid={errors.email ? 'true' : 'false'}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        {errors.email && (
          <span id="email-error" role="alert">{errors.email.message}</span>
        )}
      </div>

      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          {...register('password')}
          aria-invalid={errors.password ? 'true' : 'false'}
          aria-describedby={errors.password ? 'password-error' : undefined}
        />
        {errors.password && (
          <span id="password-error" role="alert">{errors.password.message}</span>
        )}
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Submitting...' : 'Register'}
      </button>
    </form>
  );
};
```

---

## 4. Accessibility (WCAG 2.1 AA)

### 4.1 Semantic HTML

```tsx
// ✅ Good: Semantic elements
<nav>
  <ul>
    <li><a href="/home">Home</a></li>
    <li><a href="/about">About</a></li>
  </ul>
</nav>

<main>
  <article>
    <header>
      <h1>Article Title</h1>
      <time dateTime="2025-10-22">October 22, 2025</time>
    </header>
    <p>Article content...</p>
    <footer>
      <p>Author: John Doe</p>
    </footer>
  </article>
</main>

<aside>
  <h2>Related Articles</h2>
  <ul>...</ul>
</aside>

// ❌ Bad: Divs for everything
<div className="nav">
  <div className="nav-item" onClick={handleClick}>Home</div>
</div>
```

### 4.2 ARIA Attributes

#### Common ARIA Patterns

```tsx
// Button with accessible label
<button aria-label="Close dialog">×</button>

// Input with description
<input
  type="email"
  aria-describedby="email-hint"
  aria-required="true"
/>
<span id="email-hint">We'll never share your email</span>

// Live region for dynamic content
<div aria-live="polite" aria-atomic="true">
  {statusMessage}
</div>

// Hidden from screen readers
<span aria-hidden="true">🎉</span>

// Landmark roles
<div role="banner">Header</div>
<div role="navigation">Nav</div>
<div role="main">Main content</div>
<div role="complementary">Sidebar</div>
<div role="contentinfo">Footer</div>
```

### 4.3 Keyboard Navigation

```tsx
const Menu = () => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Escape':
        setIsOpen(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        // Move focus to next item
        break;
      case 'ArrowUp':
        e.preventDefault();
        // Move focus to previous item
        break;
    }
  };

  return (
    <div>
      <button
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
          onKeyDown={handleKeyDown}
          tabIndex={-1}
        >
          <button role="menuitem" onClick={() => {}}>Item 1</button>
          <button role="menuitem" onClick={() => {}}>Item 2</button>
        </div>
      )}
    </div>
  );
};
```

### 4.4 Focus Management

```tsx
const Modal = ({ isOpen, onClose, children }: ModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Save currently focused element
      previousFocusRef.current = document.activeElement as HTMLElement;

      // Focus modal
      modalRef.current?.focus();

      // Trap focus within modal
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Tab') {
          const focusableElements = modalRef.current?.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );

          if (!focusableElements || focusableElements.length === 0) return;

          const firstElement = focusableElements[0] as HTMLElement;
          const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

          if (e.shiftKey) {
            if (document.activeElement === firstElement) {
              e.preventDefault();
              lastElement.focus();
            }
          } else {
            if (document.activeElement === lastElement) {
              e.preventDefault();
              firstElement.focus();
            }
          }
        }
      };

      document.addEventListener('keydown', handleKeyDown);

      return () => {
        document.removeEventListener('keydown', handleKeyDown);

        // Restore focus
        previousFocusRef.current?.focus();
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
};
```

### 4.5 Screen Reader Support

```tsx
// Visually hidden but available to screen readers
const srOnly = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  borderWidth: 0
} as const;

<span style={srOnly}>Loading...</span>

// Announce page navigation
const useAnnouncement = () => {
  const [announcement, setAnnouncement] = useState('');

  const announce = (message: string) => {
    setAnnouncement('');
    setTimeout(() => setAnnouncement(message), 100);
  };

  return { announcement, announce };
};

const App = () => {
  const { announcement, announce } = useAnnouncement();

  useEffect(() => {
    const handleRouteChange = () => {
      announce(`Navigated to ${document.title}`);
    };

    window.addEventListener('popstate', handleRouteChange);
    return () => window.removeEventListener('popstate', handleRouteChange);
  }, [announce]);

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={srOnly}
      >
        {announcement}
      </div>
      {/* App content */}
    </>
  );
};
```

---

## 5. Performance Optimization

### 5.1 React.memo

```tsx
// Memoize component
const ExpensiveComponent = memo<Props>(({ data }) => {
  console.log('Rendering ExpensiveComponent');
  return <div>{/* expensive rendering */}</div>;
});

// Custom comparison
const UserCard = memo<UserCardProps>(
  ({ user }) => {
    return <div>{user.name}</div>;
  },
  (prevProps, nextProps) => {
    // Return true if props are equal (skip re-render)
    return prevProps.user.id === nextProps.user.id;
  }
);
```

### 5.2 Code Splitting

```tsx
import { lazy, Suspense } from 'react';

// Component-level splitting
const Dashboard = lazy(() => import('./Dashboard'));
const Settings = lazy(() => import('./Settings'));

const App = () => {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
};

// Named exports
const Admin = lazy(() =>
  import('./AdminPanel').then(module => ({ default: module.AdminPanel }))
);

// Preloading
const Dashboard = lazy(() => import('./Dashboard'));
const preloadDashboard = () => {
  const component = import('./Dashboard');
  // Component is now cached
};

// Trigger preload on hover
<Link to="/dashboard" onMouseEnter={preloadDashboard}>
  Dashboard
</Link>
```

### 5.3 Virtual Scrolling

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

const VirtualList = ({ items }: { items: Item[] }) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50, // Estimated row height
    overscan: 5 // Number of items to render outside viewport
  });

  return (
    <div ref={parentRef} style={{ height: '400px', overflow: 'auto' }}>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative'
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`
            }}
          >
            {items[virtualRow.index].name}
          </div>
        ))}
      </div>
    </div>
  );
};
```

### 5.4 Image Optimization

```tsx
// Lazy load images
const LazyImage = ({ src, alt }: { src: string; alt: string }) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setImageSrc(src);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.01 }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, [src]);

  return (
    <img
      ref={imgRef}
      src={imageSrc || 'placeholder.jpg'}
      alt={alt}
      loading="lazy"
    />
  );
};

// Responsive images
<picture>
  <source srcSet="image-small.jpg" media="(max-width: 600px)" />
  <source srcSet="image-medium.jpg" media="(max-width: 1200px)" />
  <img src="image-large.jpg" alt="Description" />
</picture>
```

---

## 6. Testing Strategies

### 6.1 React Testing Library

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

describe('LoginForm', () => {
  it('renders login form', () => {
    render(<LoginForm />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('handles form submission', async () => {
    const handleSubmit = jest.fn();
    render(<LoginForm onSubmit={handleSubmit} />);

    await userEvent.type(screen.getByLabelText(/email/i), 'test@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123'
      });
    });
  });

  it('displays validation errors', async () => {
    render(<LoginForm />);

    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<LoginForm />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

### 6.2 Testing Hooks

```tsx
import { renderHook, act } from '@testing-library/react';

describe('useCounter', () => {
  it('initializes with default value', () => {
    const { result } = renderHook(() => useCounter());
    expect(result.current.count).toBe(0);
  });

  it('increments counter', () => {
    const { result } = renderHook(() => useCounter());

    act(() => {
      result.current.increment();
    });

    expect(result.current.count).toBe(1);
  });

  it('decrements counter', () => {
    const { result } = renderHook(() => useCounter(5));

    act(() => {
      result.current.decrement();
    });

    expect(result.current.count).toBe(4);
  });
});
```

### 6.3 Testing Context

```tsx
import { render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

const TestComponent = () => {
  const { user, login } = useAuth();
  return (
    <div>
      <p>{user ? user.name : 'Not logged in'}</p>
      <button onClick={() => login('email', 'password')}>Login</button>
    </div>
  );
};

describe('AuthContext', () => {
  it('provides auth state', () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    expect(screen.getByText(/not logged in/i)).toBeInTheDocument();
  });

  it('throws error when used outside provider', () => {
    // Suppress console.error for this test
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useAuth must be used within AuthProvider');

    jest.restoreAllMocks();
  });
});
```

---

## 7. TypeScript Integration

### 7.1 Component Props

```tsx
// Basic props
interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

// Extending HTML attributes
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

// Generic components
interface SelectProps<T> {
  options: T[];
  value: T;
  onChange: (value: T) => void;
  getLabel: (option: T) => string;
}

function Select<T>({ options, value, onChange, getLabel }: SelectProps<T>) {
  return (
    <select
      value={getLabel(value)}
      onChange={(e) => {
        const option = options.find((o) => getLabel(o) === e.target.value);
        if (option) onChange(option);
      }}
    >
      {options.map((option, index) => (
        <option key={index} value={getLabel(option)}>
          {getLabel(option)}
        </option>
      ))}
    </select>
  );
}
```

### 7.2 Event Handlers

```tsx
// Click events
const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
  console.log(e.currentTarget);
};

// Input events
const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
  console.log(e.target.value);
};

// Form events
const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const formData = new FormData(e.currentTarget);
};

// Keyboard events
const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') {
    e.preventDefault();
  }
};
```

### 7.3 Refs

```tsx
// DOM element refs
const inputRef = useRef<HTMLInputElement>(null);

useEffect(() => {
  inputRef.current?.focus();
}, []);

// Forwarding refs
interface InputProps {
  label: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label }, ref) => {
    return (
      <div>
        <label>{label}</label>
        <input ref={ref} />
      </div>
    );
  }
);

// Usage
const ParentComponent = () => {
  const inputRef = useRef<HTMLInputElement>(null);

  return <Input ref={inputRef} label="Email" />;
};
```

---

## 8. Styling Approaches

### 8.1 CSS Modules

```tsx
// Button.module.css
.button {
  padding: 10px 20px;
  border-radius: 4px;
}

.primary {
  background: blue;
  color: white;
}

.secondary {
  background: gray;
  color: black;
}

// Button.tsx
import styles from './Button.module.css';
import clsx from 'clsx';

interface ButtonProps {
  variant: 'primary' | 'secondary';
  children: ReactNode;
}

export const Button: FC<ButtonProps> = ({ variant, children }) => {
  return (
    <button className={clsx(styles.button, styles[variant])}>
      {children}
    </button>
  );
};
```

### 8.2 Styled Components

```tsx
import styled from 'styled-components';

const Button = styled.button<{ variant: 'primary' | 'secondary' }>`
  padding: 10px 20px;
  border-radius: 4px;
  background: ${props => props.variant === 'primary' ? 'blue' : 'gray'};
  color: ${props => props.variant === 'primary' ? 'white' : 'black'};

  &:hover {
    opacity: 0.8;
  }
`;

// Usage
<Button variant="primary">Click me</Button>
```

### 8.3 Tailwind CSS

```tsx
interface ButtonProps {
  variant: 'primary' | 'secondary';
  children: ReactNode;
}

export const Button: FC<ButtonProps> = ({ variant, children }) => {
  const baseStyles = 'px-4 py-2 rounded';
  const variantStyles = {
    primary: 'bg-blue-500 text-white hover:bg-blue-600',
    secondary: 'bg-gray-500 text-black hover:bg-gray-600'
  };

  return (
    <button className={`${baseStyles} ${variantStyles[variant]}`}>
      {children}
    </button>
  );
};
```

---

## 9. Advanced Patterns

### 9.1 Higher-Order Components (HOCs)

```tsx
function withAuth<P extends object>(
  Component: ComponentType<P>
): FC<P> {
  return (props: P) => {
    const { user } = useAuth();

    if (!user) {
      return <Navigate to="/login" />;
    }

    return <Component {...props} />;
  };
}

// Usage
const Dashboard = () => <div>Dashboard</div>;
export const ProtectedDashboard = withAuth(Dashboard);
```

### 9.2 Portals

```tsx
import { createPortal } from 'react-dom';

const Modal: FC<{ children: ReactNode; isOpen: boolean }> = ({
  children,
  isOpen
}) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay">
      <div className="modal">{children}</div>
    </div>,
    document.body
  );
};
```

### 9.3 Suspense for Data Fetching

```tsx
import { Suspense } from 'react';

const UserProfile = ({ userId }: { userId: number }) => {
  // This component "suspends" while data is loading
  const user = use(fetchUser(userId));

  return <div>{user.name}</div>;
};

const App = () => {
  return (
    <Suspense fallback={<div>Loading user...</div>}>
      <UserProfile userId={1} />
    </Suspense>
  );
};
```

---

## 10. Best Practices

### 10.1 Component Organization

```tsx
// ✅ Good structure
import { FC, useState, useEffect } from 'react'; // React imports
import { useNavigate } from 'react-router-dom'; // Third-party hooks
import { useAuth } from '@/hooks/useAuth'; // Custom hooks
import { Button } from '@/components/Button'; // Components
import { fetchUsers } from '@/api/users'; // API functions
import type { User } from '@/types'; // Types
import styles from './UserList.module.css'; // Styles

export const UserList: FC = () => {
  // 1. Hooks
  const navigate = useNavigate();
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);

  // 2. Effects
  useEffect(() => {
    fetchUsers().then(setUsers);
  }, []);

  // 3. Event handlers
  const handleUserClick = (userId: number) => {
    navigate(`/users/${userId}`);
  };

  // 4. Render helpers
  const renderUser = (user: User) => (
    <li key={user.id} onClick={() => handleUserClick(user.id)}>
      {user.name}
    </li>
  );

  // 5. Early returns
  if (!user) return <Navigate to="/login" />;

  // 6. Main render
  return (
    <div className={styles.container}>
      <h1>Users</h1>
      <ul>{users.map(renderUser)}</ul>
    </div>
  );
};
```

### 10.2 Performance Checklist

- [ ] Use React.memo for expensive pure components
- [ ] Use useMemo for expensive computations
- [ ] Use useCallback for functions passed to memoized children
- [ ] Implement code splitting for routes
- [ ] Lazy load images
- [ ] Use virtual scrolling for long lists (>100 items)
- [ ] Debounce user input
- [ ] Avoid inline function definitions in JSX
- [ ] Split large contexts by update frequency

### 10.3 Accessibility Checklist

- [ ] Use semantic HTML elements
- [ ] Add ARIA attributes where needed
- [ ] Ensure keyboard navigation works
- [ ] Implement focus management for modals
- [ ] Test with screen reader
- [ ] Meet WCAG 2.1 AA color contrast ratios (4.5:1)
- [ ] Add aria-live regions for dynamic content
- [ ] Include skip links for keyboard users

### 10.4 Security Best Practices

```tsx
// ✅ Good: Sanitize user input
import DOMPurify from 'dompurify';

const SafeHTML = ({ html }: { html: string }) => {
  const sanitized = DOMPurify.sanitize(html);
  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
};

// ❌ Bad: Direct XSS vulnerability
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// ✅ Good: Validate environment variables
const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) {
  throw new Error('VITE_API_URL is required');
}

// ✅ Good: Use CSP headers
// vite.config.ts
export default defineConfig({
  server: {
    headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self'"
    }
  }
});
```

---

## See Also

- **[SKILL.md](SKILL.md)** - Quick reference for common patterns
- **[templates/](templates/)** - Code generation templates
- **[examples/](examples/)** - Real-world implementation examples
- **[Official React Docs](https://react.dev)** - React documentation
- **[React TypeScript Cheatsheet](https://react-typescript-cheatsheet.netlify.app/)** - TypeScript patterns

---

**Version**: 1.0.0 | **Last Updated**: 2025-10-22 | **Status**: Production Ready
