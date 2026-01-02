/**
 * React State Management Example
 *
 * Demonstrates:
 * - useState for local state
 * - useReducer for complex state
 * - Context API for global state
 * - Custom hooks for reusable state logic
 * - Form state management
 *
 * Related: SKILL.md (State Management), REFERENCE.md (Section 3)
 */

import {
  FC,
  ReactNode,
  createContext,
  useContext,
  useState,
  useReducer,
  useMemo,
  useCallback,
  ChangeEvent,
  FormEvent
} from 'react';

// ============================================================================
// 1. LOCAL STATE WITH useState
// ============================================================================

export const CounterExample: FC = () => {
  const [count, setCount] = useState(0);

  // Functional update (when new state depends on previous)
  const increment = () => setCount(prev => prev + 1);
  const decrement = () => setCount(prev => prev - 1);
  const reset = () => setCount(0);

  return (
    <div>
      <h2>Counter: {count}</h2>
      <button onClick={increment}>Increment</button>
      <button onClick={decrement}>Decrement</button>
      <button onClick={reset}>Reset</button>
    </div>
  );
};

// Object state management
interface FormData {
  email: string;
  password: string;
  rememberMe: boolean;
}

export const FormExample: FC = () => {
  const [form, setForm] = useState<FormData>({
    email: '',
    password: '',
    rememberMe: false
  });

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    console.log('Form submitted:', form);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        name="email"
        type="email"
        value={form.email}
        onChange={handleChange}
        placeholder="Email"
      />
      <input
        name="password"
        type="password"
        value={form.password}
        onChange={handleChange}
        placeholder="Password"
      />
      <label>
        <input
          name="rememberMe"
          type="checkbox"
          checked={form.rememberMe}
          onChange={handleChange}
        />
        Remember me
      </label>
      <button type="submit">Login</button>
    </form>
  );
};

// ============================================================================
// 2. COMPLEX STATE WITH useReducer
// ============================================================================

interface TodoState {
  todos: Todo[];
  filter: 'all' | 'active' | 'completed';
  loading: boolean;
  error: string | null;
}

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

type TodoAction =
  | { type: 'ADD_TODO'; payload: string }
  | { type: 'TOGGLE_TODO'; payload: number }
  | { type: 'DELETE_TODO'; payload: number }
  | { type: 'SET_FILTER'; payload: 'all' | 'active' | 'completed' }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'FETCH_SUCCESS'; payload: Todo[] };

const todoReducer = (state: TodoState, action: TodoAction): TodoState => {
  switch (action.type) {
    case 'ADD_TODO':
      return {
        ...state,
        todos: [
          ...state.todos,
          {
            id: Date.now(),
            text: action.payload,
            completed: false
          }
        ]
      };

    case 'TOGGLE_TODO':
      return {
        ...state,
        todos: state.todos.map(todo =>
          todo.id === action.payload
            ? { ...todo, completed: !todo.completed }
            : todo
        )
      };

    case 'DELETE_TODO':
      return {
        ...state,
        todos: state.todos.filter(todo => todo.id !== action.payload)
      };

    case 'SET_FILTER':
      return {
        ...state,
        filter: action.payload
      };

    case 'SET_LOADING':
      return {
        ...state,
        loading: action.payload
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        loading: false
      };

    case 'FETCH_SUCCESS':
      return {
        ...state,
        todos: action.payload,
        loading: false,
        error: null
      };

    default:
      return state;
  }
};

const initialTodoState: TodoState = {
  todos: [],
  filter: 'all',
  loading: false,
  error: null
};

export const TodoApp: FC = () => {
  const [state, dispatch] = useReducer(todoReducer, initialTodoState);
  const [inputValue, setInputValue] = useState('');

  const handleAdd = () => {
    if (inputValue.trim()) {
      dispatch({ type: 'ADD_TODO', payload: inputValue });
      setInputValue('');
    }
  };

  const filteredTodos = useMemo(() => {
    switch (state.filter) {
      case 'active':
        return state.todos.filter(todo => !todo.completed);
      case 'completed':
        return state.todos.filter(todo => todo.completed);
      default:
        return state.todos;
    }
  }, [state.todos, state.filter]);

  return (
    <div>
      <h2>Todo List</h2>

      <div>
        <input
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && handleAdd()}
          placeholder="Add todo..."
        />
        <button onClick={handleAdd}>Add</button>
      </div>

      <div>
        <button onClick={() => dispatch({ type: 'SET_FILTER', payload: 'all' })}>
          All ({state.todos.length})
        </button>
        <button onClick={() => dispatch({ type: 'SET_FILTER', payload: 'active' })}>
          Active ({state.todos.filter(t => !t.completed).length})
        </button>
        <button onClick={() => dispatch({ type: 'SET_FILTER', payload: 'completed' })}>
          Completed ({state.todos.filter(t => t.completed).length})
        </button>
      </div>

      {state.loading && <div>Loading...</div>}
      {state.error && <div>Error: {state.error}</div>}

      <ul>
        {filteredTodos.map(todo => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => dispatch({ type: 'TOGGLE_TODO', payload: todo.id })}
            />
            <span style={{ textDecoration: todo.completed ? 'line-through' : 'none' }}>
              {todo.text}
            </span>
            <button onClick={() => dispatch({ type: 'DELETE_TODO', payload: todo.id })}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ============================================================================
// 3. GLOBAL STATE WITH CONTEXT API
// ============================================================================

interface User {
  id: number;
  name: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const login = useCallback(async (email: string, password: string) => {
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
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('token');
  }, []);

  const value = useMemo(
    () => ({ user, login, logout, isLoading }),
    [user, login, logout, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

// Usage example
export const LoginForm: FC = () => {
  const { login, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      await login(email, password);
    } catch (err) {
      setError('Invalid credentials');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="Email"
        disabled={isLoading}
      />
      <input
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder="Password"
        disabled={isLoading}
      />
      {error && <div role="alert">{error}</div>}
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
};

export const UserProfile: FC = () => {
  const { user, logout } = useAuth();

  if (!user) return <div>Please log in</div>;

  return (
    <div>
      <h2>Welcome, {user.name}!</h2>
      <p>Email: {user.email}</p>
      <button onClick={logout}>Logout</button>
    </div>
  );
};

// ============================================================================
// 4. CUSTOM HOOKS FOR REUSABLE STATE LOGIC
// ============================================================================

// Custom hook: useLocalStorage
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error('Error reading from localStorage:', error);
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch (error) {
        console.error('Error saving to localStorage:', error);
      }
    },
    [key, storedValue]
  );

  return [storedValue, setValue] as const;
}

// Usage
export const ThemeToggle: FC = () => {
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('theme', 'light');

  return (
    <div>
      <p>Current theme: {theme}</p>
      <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
        Toggle Theme
      </button>
    </div>
  );
};

// Custom hook: useDebounce
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useState(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// Usage
export const SearchInput: FC = () => {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 500);
  const [results, setResults] = useState<string[]>([]);

  useState(() => {
    if (debouncedSearch) {
      fetch(`/api/search?q=${debouncedSearch}`)
        .then(res => res.json())
        .then(setResults);
    }
  }, [debouncedSearch]);

  return (
    <div>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search..."
      />
      <ul>
        {results.map((result, index) => (
          <li key={index}>{result}</li>
        ))}
      </ul>
    </div>
  );
};

// ============================================================================
// 5. FORM STATE MANAGEMENT WITH VALIDATION
// ============================================================================

interface FormErrors {
  [key: string]: string;
}

interface UseFormOptions<T> {
  initialValues: T;
  validate: (values: T) => FormErrors;
  onSubmit: (values: T) => void | Promise<void>;
}

export function useForm<T extends Record<string, any>>({
  initialValues,
  validate,
  onSubmit
}: UseFormOptions<T>) {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setValues(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  }, []);

  const handleBlur = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const { name } = e.target;
      setTouched(prev => ({ ...prev, [name]: true }));

      const validationErrors = validate(values);
      setErrors(validationErrors);
    },
    [values, validate]
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      // Mark all fields as touched
      const allTouched = Object.keys(values).reduce(
        (acc, key) => ({ ...acc, [key]: true }),
        {}
      );
      setTouched(allTouched);

      // Validate
      const validationErrors = validate(values);
      setErrors(validationErrors);

      // Submit if no errors
      if (Object.keys(validationErrors).length === 0) {
        setIsSubmitting(true);
        try {
          await onSubmit(values);
        } finally {
          setIsSubmitting(false);
        }
      }
    },
    [values, validate, onSubmit]
  );

  return {
    values,
    errors,
    touched,
    isSubmitting,
    handleChange,
    handleBlur,
    handleSubmit
  };
}

// Usage
interface RegistrationForm {
  email: string;
  password: string;
  confirmPassword: string;
}

export const RegistrationForm: FC = () => {
  const form = useForm<RegistrationForm>({
    initialValues: {
      email: '',
      password: '',
      confirmPassword: ''
    },
    validate: values => {
      const errors: FormErrors = {};

      if (!values.email) {
        errors.email = 'Email is required';
      } else if (!/\S+@\S+\.\S+/.test(values.email)) {
        errors.email = 'Invalid email format';
      }

      if (!values.password) {
        errors.password = 'Password is required';
      } else if (values.password.length < 8) {
        errors.password = 'Password must be at least 8 characters';
      }

      if (values.password !== values.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
      }

      return errors;
    },
    onSubmit: async values => {
      await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
    }
  });

  return (
    <form onSubmit={form.handleSubmit}>
      <div>
        <input
          name="email"
          type="email"
          value={form.values.email}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          placeholder="Email"
          aria-invalid={form.touched.email && !!form.errors.email}
        />
        {form.touched.email && form.errors.email && (
          <span role="alert">{form.errors.email}</span>
        )}
      </div>

      <div>
        <input
          name="password"
          type="password"
          value={form.values.password}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          placeholder="Password"
          aria-invalid={form.touched.password && !!form.errors.password}
        />
        {form.touched.password && form.errors.password && (
          <span role="alert">{form.errors.password}</span>
        )}
      </div>

      <div>
        <input
          name="confirmPassword"
          type="password"
          value={form.values.confirmPassword}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          placeholder="Confirm Password"
          aria-invalid={form.touched.confirmPassword && !!form.errors.confirmPassword}
        />
        {form.touched.confirmPassword && form.errors.confirmPassword && (
          <span role="alert">{form.errors.confirmPassword}</span>
        )}
      </div>

      <button type="submit" disabled={form.isSubmitting}>
        {form.isSubmitting ? 'Registering...' : 'Register'}
      </button>
    </form>
  );
};
