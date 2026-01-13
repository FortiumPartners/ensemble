---
name: developing-with-react
description: React 18+ development with hooks, state management, component patterns, and Next.js integration
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# React Development Skill

React 18+ development patterns including hooks, state management, component architecture, and Next.js integration.

## Core Patterns

### Functional Components with Hooks

```tsx
import { useState, useEffect, useMemo, useCallback } from 'react';

interface UserProps {
  userId: string;
  onUpdate?: (user: User) => void;
}

export function UserProfile({ userId, onUpdate }: UserProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUser() {
      setLoading(true);
      const data = await api.getUser(userId);
      setUser(data);
      setLoading(false);
    }
    fetchUser();
  }, [userId]);

  const handleUpdate = useCallback((updates: Partial<User>) => {
    if (user) {
      const updated = { ...user, ...updates };
      setUser(updated);
      onUpdate?.(updated);
    }
  }, [user, onUpdate]);

  if (loading) return <Skeleton />;
  if (!user) return <NotFound />;

  return <UserCard user={user} onUpdate={handleUpdate} />;
}
```

### Custom Hooks

```tsx
function useAsync<T>(asyncFn: () => Promise<T>, deps: any[] = []) {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: Error | null;
  }>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));

    asyncFn()
      .then(data => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch(error => {
        if (!cancelled) setState({ data: null, loading: false, error });
      });

    return () => { cancelled = true; };
  }, deps);

  return state;
}
```

## State Management

### React Context

```tsx
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const value = useMemo(() => ({
    theme,
    toggleTheme: () => setTheme(t => t === 'light' ? 'dark' : 'light'),
  }), [theme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
```

## Next.js Patterns

### Server Components (App Router)

```tsx
// app/users/[id]/page.tsx
export default async function UserPage({ params }: { params: { id: string } }) {
  const user = await getUser(params.id);

  return (
    <main>
      <h1>{user.name}</h1>
      <Suspense fallback={<PostsSkeleton />}>
        <UserPosts userId={user.id} />
      </Suspense>
    </main>
  );
}
```

### Client Components

```tsx
'use client';

import { useState, useTransition } from 'react';
import { updateUser } from './actions';

export function EditForm({ user }: { user: User }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateUser(formData);
      if (result.error) setError(result.error);
    });
  }

  return (
    <form action={handleSubmit}>
      <input name="name" defaultValue={user.name} />
      <button disabled={isPending}>
        {isPending ? 'Saving...' : 'Save'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
```

## Testing

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('UserProfile', () => {
  it('loads and displays user data', async () => {
    render(<UserProfile userId="123" />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
  });

  it('handles update correctly', async () => {
    const onUpdate = vi.fn();
    render(<UserProfile userId="123" onUpdate={onUpdate} />);

    await screen.findByText('John Doe');
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    expect(onUpdate).toHaveBeenCalled();
  });
});
```
