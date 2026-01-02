import { FC, ReactNode, useState, useEffect } from 'react';
import styles from './{{ComponentName}}.module.css';

/**
 * Props for {{ComponentName}} component
 */
interface {{ComponentName}}Props {
  /**
   * The title to display
   */
  title: string;

  /**
   * Optional child elements
   */
  children?: ReactNode;

  /**
   * Optional CSS class name
   */
  className?: string;

  /**
   * Optional click handler
   */
  onClick?: () => void;

  /**
   * Whether the component is disabled
   * @default false
   */
  disabled?: boolean;
}

/**
 * {{ComponentName}} component
 *
 * @example
 * ```tsx
 * <{{ComponentName}}
 *   title="Hello World"
 *   onClick={() => console.log('clicked')}
 * >
 *   <p>Child content</p>
 * </{{ComponentName}}>
 * ```
 */
export const {{ComponentName}}: FC<{{ComponentName}}Props> = ({
  title,
  children,
  className = '',
  onClick,
  disabled = false
}) => {
  // Local state
  const [isActive, setIsActive] = useState(false);

  // Effects
  useEffect(() => {
    // Setup logic here
    console.log('{{ComponentName}} mounted');

    return () => {
      // Cleanup logic here
      console.log('{{ComponentName}} unmounted');
    };
  }, []);

  // Event handlers
  const handleClick = () => {
    if (disabled) return;
    setIsActive(!isActive);
    onClick?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  // Computed values
  const computedClassName = [
    styles.{{component-name}},
    isActive && styles.active,
    disabled && styles.disabled,
    className
  ]
    .filter(Boolean)
    .join(' ');

  // Render
  return (
    <div
      className={computedClassName}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={title}
    >
      <h2 className={styles.title}>{title}</h2>
      {children && <div className={styles.content}>{children}</div>}
    </div>
  );
};

// Default props (alternative approach)
{{ComponentName}}.defaultProps = {
  disabled: false,
  className: ''
};
