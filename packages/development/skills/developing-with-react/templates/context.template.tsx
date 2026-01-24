import { createContext, useContext, useState, useCallback, useMemo, FC, ReactNode } from 'react';

/**
 * {{ContextName}} context type
 */
interface {{ContextName}}ContextType {
  /**
   * Current state value
   */
  state: {{StateType}};

  /**
   * Update the state
   */
  setState: (state: {{StateType}}) => void;

  /**
   * Reset state to initial value
   */
  reset: () => void;

  /**
   * Additional action methods
   */
  actions: {
    increment: () => void;
    decrement: () => void;
    // Add more actions as needed
  };
}

// Replace with your actual state type
interface {{StateType}} {
  count: number;
  data: any;
  // Add your state properties
}

/**
 * Initial state for {{ContextName}}
 */
const initialState: {{StateType}} = {
  count: 0,
  data: null
};

/**
 * {{ContextName}} context
 * @private Use use{{ContextName}} hook instead
 */
const {{ContextName}}Context = createContext<{{ContextName}}ContextType | undefined>(undefined);

/**
 * Props for {{ContextName}}Provider
 */
interface {{ContextName}}ProviderProps {
  /**
   * Child components
   */
  children: ReactNode;

  /**
   * Optional initial state override
   */
  initialState?: Partial<{{StateType}}>;
}

/**
 * {{ContextName}}Provider component
 *
 * Provides {{context-name}} state and actions to child components
 *
 * @example
 * ```tsx
 * <{{ContextName}}Provider>
 *   <App />
 * </{{ContextName}}Provider>
 * ```
 */
export const {{ContextName}}Provider: FC<{{ContextName}}ProviderProps> = ({
  children,
  initialState: customInitialState
}) => {
  // Merge custom initial state with defaults
  const mergedInitialState = {
    ...initialState,
    ...customInitialState
  };

  // State
  const [state, setState] = useState<{{StateType}}>(mergedInitialState);

  // Actions - Memoized to prevent unnecessary re-renders
  const actions = useMemo(
    () => ({
      increment: () => {
        setState(prev => ({ ...prev, count: prev.count + 1 }));
      },
      decrement: () => {
        setState(prev => ({ ...prev, count: prev.count - 1 }));
      }
      // Add more actions as needed
    }),
    []
  );

  // Reset function
  const reset = useCallback(() => {
    setState(mergedInitialState);
  }, [mergedInitialState]);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(
    () => ({
      state,
      setState,
      reset,
      actions
    }),
    [state, reset, actions]
  );

  return (
    <{{ContextName}}Context.Provider value={value}>
      {children}
    </{{ContextName}}Context.Provider>
  );
};

/**
 * Hook to use {{ContextName}} context
 *
 * @throws {Error} If used outside of {{ContextName}}Provider
 *
 * @example
 * ```tsx
 * const { state, actions } = use{{ContextName}}();
 *
 * return (
 *   <div>
 *     <p>Count: {state.count}</p>
 *     <button onClick={actions.increment}>Increment</button>
 *   </div>
 * );
 * ```
 */
export function use{{ContextName}}(): {{ContextName}}ContextType {
  const context = useContext({{ContextName}}Context);

  if (context === undefined) {
    throw new Error('use{{ContextName}} must be used within {{ContextName}}Provider');
  }

  return context;
}

/**
 * Hook to use only the state (optimized for components that don't need actions)
 *
 * @example
 * ```tsx
 * const state = use{{ContextName}}State();
 * return <div>Count: {state.count}</div>;
 * ```
 */
export function use{{ContextName}}State(): {{StateType}} {
  const { state } = use{{ContextName}}();
  return state;
}

/**
 * Hook to use only the actions (optimized for components that don't need state)
 *
 * @example
 * ```tsx
 * const actions = use{{ContextName}}Actions();
 * return <button onClick={actions.increment}>Increment</button>;
 * ```
 */
export function use{{ContextName}}Actions() {
  const { actions } = use{{ContextName}}();
  return actions;
}

// Export types for consumers
export type { {{ContextName}}ContextType, {{StateType}} };
