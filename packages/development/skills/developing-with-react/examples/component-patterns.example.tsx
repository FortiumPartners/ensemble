/**
 * React Component Patterns Example
 *
 * Demonstrates:
 * - Container/Presentational pattern
 * - Compound components
 * - Render props
 * - Children patterns
 * - HOC (Higher-Order Component)
 *
 * Related: SKILL.md (Component Design), REFERENCE.md (Section 1)
 */

import { FC, ReactNode, createContext, useContext, useState, ComponentType } from 'react';

// ============================================================================
// 1. CONTAINER/PRESENTATIONAL PATTERN
// ============================================================================

interface User {
  id: number;
  name: string;
  email: string;
  avatar: string;
}

// Container: Logic and data fetching
export const UserProfileContainer: FC<{ userId: number }> = ({ userId }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetch(`/api/users/${userId}`)
      .then(res => res.json())
      .then(setUser)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error.message} />;
  if (!user) return <NotFound />;

  return <UserProfile user={user} />;
};

// Presentational: Pure UI component
interface UserProfileProps {
  user: User;
}

const UserProfile: FC<UserProfileProps> = ({ user }) => {
  return (
    <article className="user-profile">
      <img src={user.avatar} alt={`${user.name}'s avatar`} />
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </article>
  );
};

// ============================================================================
// 2. COMPOUND COMPONENTS PATTERN
// ============================================================================

interface TabsContextType {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabsContext = createContext<TabsContextType | undefined>(undefined);

const useTabs = () => {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs components must be used within Tabs');
  }
  return context;
};

// Main component
export const Tabs: FC<{ children: ReactNode; defaultTab?: string }> & {
  List: typeof TabsList;
  Tab: typeof TabsTab;
  Panel: typeof TabsPanel;
} = ({ children, defaultTab = '' }) => {
  const [activeTab, setActiveTab] = useState(defaultTab);

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="tabs">{children}</div>
    </TabsContext.Provider>
  );
};

// Sub-components
const TabsList: FC<{ children: ReactNode }> = ({ children }) => {
  return <div role="tablist" className="tabs-list">{children}</div>;
};

const TabsTab: FC<{ id: string; children: ReactNode }> = ({ id, children }) => {
  const { activeTab, setActiveTab } = useTabs();
  const isActive = activeTab === id;

  return (
    <button
      role="tab"
      aria-selected={isActive}
      aria-controls={`panel-${id}`}
      onClick={() => setActiveTab(id)}
      className={isActive ? 'active' : ''}
    >
      {children}
    </button>
  );
};

const TabsPanel: FC<{ id: string; children: ReactNode }> = ({ id, children }) => {
  const { activeTab } = useTabs();

  if (activeTab !== id) return null;

  return (
    <div role="tabpanel" id={`panel-${id}`} className="tabs-panel">
      {children}
    </div>
  );
};

// Attach sub-components
Tabs.List = TabsList;
Tabs.Tab = TabsTab;
Tabs.Panel = TabsPanel;

// Usage:
export const TabsExample = () => (
  <Tabs defaultTab="tab1">
    <Tabs.List>
      <Tabs.Tab id="tab1">Profile</Tabs.Tab>
      <Tabs.Tab id="tab2">Settings</Tabs.Tab>
      <Tabs.Tab id="tab3">Notifications</Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel id="tab1">
      <h2>Profile</h2>
      <p>User profile content...</p>
    </Tabs.Panel>
    <Tabs.Panel id="tab2">
      <h2>Settings</h2>
      <p>Settings content...</p>
    </Tabs.Panel>
    <Tabs.Panel id="tab3">
      <h2>Notifications</h2>
      <p>Notifications content...</p>
    </Tabs.Panel>
  </Tabs>
);

// ============================================================================
// 3. RENDER PROPS PATTERN
// ============================================================================

interface MousePosition {
  x: number;
  y: number;
}

interface MouseTrackerProps {
  render: (position: MousePosition) => ReactNode;
}

export const MouseTracker: FC<MouseTrackerProps> = ({ render }) => {
  const [position, setPosition] = useState<MousePosition>({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      setPosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return <>{render(position)}</>;
};

// Usage:
export const MouseTrackerExample = () => (
  <MouseTracker
    render={({ x, y }) => (
      <div>
        <h2>Mouse Position</h2>
        <p>X: {x}, Y: {y}</p>
      </div>
    )}
  />
);

// Modern alternative with custom hook:
export const useMousePosition = () => {
  const [position, setPosition] = useState<MousePosition>({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      setPosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return position;
};

export const MousePositionExample = () => {
  const { x, y } = useMousePosition();
  return <div>Mouse: ({x}, {y})</div>;
};

// ============================================================================
// 4. CHILDREN PATTERNS
// ============================================================================

// Children as function (render props via children)
interface DataProviderProps<T> {
  data: T[];
  children: (data: T[]) => ReactNode;
}

export function DataProvider<T>({ data, children }: DataProviderProps<T>) {
  return <>{children(data)}</>;
}

// Usage:
export const DataProviderExample = () => (
  <DataProvider data={[1, 2, 3, 4, 5]}>
    {data => (
      <ul>
        {data.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    )}
  </DataProvider>
);

// Conditional children rendering
interface ConditionalWrapperProps {
  condition: boolean;
  wrapper: (children: ReactNode) => ReactNode;
  children: ReactNode;
}

export const ConditionalWrapper: FC<ConditionalWrapperProps> = ({
  condition,
  wrapper,
  children
}) => {
  return <>{condition ? wrapper(children) : children}</>;
};

// Usage:
export const ConditionalWrapperExample = () => {
  const [showBorder, setShowBorder] = useState(false);

  return (
    <div>
      <button onClick={() => setShowBorder(!showBorder)}>
        Toggle Border
      </button>
      <ConditionalWrapper
        condition={showBorder}
        wrapper={children => <div className="border">{children}</div>}
      >
        <p>This content may have a border</p>
      </ConditionalWrapper>
    </div>
  );
};

// ============================================================================
// 5. HIGHER-ORDER COMPONENT (HOC)
// ============================================================================

// HOC for authentication
interface WithAuthProps {
  user: User | null;
}

export function withAuth<P extends object>(
  Component: ComponentType<P & WithAuthProps>
): FC<Omit<P, keyof WithAuthProps>> {
  return (props: Omit<P, keyof WithAuthProps>) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      fetch('/api/auth/me')
        .then(res => res.json())
        .then(setUser)
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
    }, []);

    if (loading) return <LoadingSpinner />;
    if (!user) return <Navigate to="/login" />;

    return <Component {...(props as P)} user={user} />;
  };
}

// Component that requires authentication
interface DashboardProps extends WithAuthProps {
  title: string;
}

const Dashboard: FC<DashboardProps> = ({ user, title }) => {
  return (
    <div>
      <h1>{title}</h1>
      <p>Welcome, {user?.name}!</p>
    </div>
  );
};

// Protected component
export const ProtectedDashboard = withAuth(Dashboard);

// Usage:
export const HOCExample = () => (
  <ProtectedDashboard title="Dashboard" />
);

// ============================================================================
// 6. COMPOSITION PATTERN
// ============================================================================

// Card components that compose together
export const Card: FC<{ children: ReactNode }> & {
  Header: typeof CardHeader;
  Body: typeof CardBody;
  Footer: typeof CardFooter;
} = ({ children }) => {
  return <div className="card">{children}</div>;
};

const CardHeader: FC<{ children: ReactNode }> = ({ children }) => {
  return <div className="card-header">{children}</div>;
};

const CardBody: FC<{ children: ReactNode }> = ({ children }) => {
  return <div className="card-body">{children}</div>;
};

const CardFooter: FC<{ children: ReactNode }> = ({ children }) => {
  return <div className="card-footer">{children}</div>;
};

Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;

// Usage:
export const CardExample = () => (
  <Card>
    <Card.Header>
      <h2>Card Title</h2>
    </Card.Header>
    <Card.Body>
      <p>Card content goes here...</p>
    </Card.Body>
    <Card.Footer>
      <button>Action</button>
    </Card.Footer>
  </Card>
);

// ============================================================================
// HELPER COMPONENTS (referenced above)
// ============================================================================

const LoadingSpinner = () => <div>Loading...</div>;
const ErrorMessage = ({ message }: { message: string }) => <div>Error: {message}</div>;
const NotFound = () => <div>Not found</div>;
const Navigate = ({ to }: { to: string }) => <div>Redirecting to {to}...</div>;

// Missing import for useEffect
import { useEffect } from 'react';
