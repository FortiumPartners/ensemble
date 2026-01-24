import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { {{ComponentName}} } from './{{ComponentName}}';

// Extend Jest matchers
expect.extend(toHaveNoViolations);

describe('{{ComponentName}}', () => {
  // ============================================================================
  // RENDERING TESTS
  // ============================================================================

  describe('Rendering', () => {
    it('renders with required props', () => {
      render(<{{ComponentName}} title="Test Title" />);

      expect(screen.getByRole('button', { name: /test title/i })).toBeInTheDocument();
    });

    it('renders with children', () => {
      render(
        <{{ComponentName}} title="Test">
          <p>Child content</p>
        </{{ComponentName}}>
      );

      expect(screen.getByText(/child content/i)).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <{{ComponentName}} title="Test" className="custom-class" />
      );

      const element = container.firstChild as HTMLElement;
      expect(element).toHaveClass('custom-class');
    });

    it('renders in disabled state', () => {
      render(<{{ComponentName}} title="Test" disabled />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-disabled', 'true');
    });
  });

  // ============================================================================
  // INTERACTION TESTS
  // ============================================================================

  describe('Interactions', () => {
    it('handles click events', async () => {
      const handleClick = jest.fn();
      render(<{{ComponentName}} title="Test" onClick={handleClick} />);

      await userEvent.click(screen.getByRole('button'));

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('does not trigger click when disabled', async () => {
      const handleClick = jest.fn();
      render(<{{ComponentName}} title="Test" onClick={handleClick} disabled />);

      await userEvent.click(screen.getByRole('button'));

      expect(handleClick).not.toHaveBeenCalled();
    });

    it('handles keyboard interaction (Enter key)', () => {
      const handleClick = jest.fn();
      render(<{{ComponentName}} title="Test" onClick={handleClick} />);

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: 'Enter' });

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('handles keyboard interaction (Space key)', () => {
      const handleClick = jest.fn();
      render(<{{ComponentName}} title="Test" onClick={handleClick} />);

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: ' ' });

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('toggles active state on click', async () => {
      const { container } = render(<{{ComponentName}} title="Test" />);

      const button = screen.getByRole('button');
      await userEvent.click(button);

      const element = container.firstChild as HTMLElement;
      expect(element).toHaveClass('active');

      await userEvent.click(button);
      expect(element).not.toHaveClass('active');
    });
  });

  // ============================================================================
  // STATE TESTS
  // ============================================================================

  describe('State Management', () => {
    it('maintains state across re-renders', async () => {
      const { rerender } = render(<{{ComponentName}} title="Test" />);

      const button = screen.getByRole('button');
      await userEvent.click(button);

      rerender(<{{ComponentName}} title="Updated Test" />);

      expect(button).toBeInTheDocument();
    });
  });

  // ============================================================================
  // ACCESSIBILITY TESTS
  // ============================================================================

  describe('Accessibility', () => {
    it('has no accessibility violations', async () => {
      const { container } = render(<{{ComponentName}} title="Test" />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has correct ARIA attributes', () => {
      render(<{{ComponentName}} title="Test Title" />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'Test Title');
      expect(button).toHaveAttribute('tabIndex', '0');
    });

    it('has correct ARIA attributes when disabled', () => {
      render(<{{ComponentName}} title="Test" disabled />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAttribute('tabIndex', '-1');
    });

    it('is keyboard focusable when not disabled', () => {
      render(<{{ComponentName}} title="Test" />);

      const button = screen.getByRole('button');
      button.focus();

      expect(button).toHaveFocus();
    });

    it('is not keyboard focusable when disabled', () => {
      render(<{{ComponentName}} title="Test" disabled />);

      const button = screen.getByRole('button');
      button.focus();

      expect(button).not.toHaveFocus();
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles missing optional props', () => {
      render(<{{ComponentName}} title="Test" />);

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('handles empty title', () => {
      render(<{{ComponentName}} title="" />);

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });

    it('handles rapidly repeated clicks', async () => {
      const handleClick = jest.fn();
      render(<{{ComponentName}} title="Test" onClick={handleClick} />);

      const button = screen.getByRole('button');

      // Rapidly click 5 times
      await userEvent.click(button);
      await userEvent.click(button);
      await userEvent.click(button);
      await userEvent.click(button);
      await userEvent.click(button);

      expect(handleClick).toHaveBeenCalledTimes(5);
    });
  });

  // ============================================================================
  // LIFECYCLE TESTS
  // ============================================================================

  describe('Lifecycle', () => {
    it('logs mount message', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      render(<{{ComponentName}} title="Test" />);

      expect(consoleSpy).toHaveBeenCalledWith('{{ComponentName}} mounted');

      consoleSpy.mockRestore();
    });

    it('logs unmount message', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const { unmount } = render(<{{ComponentName}} title="Test" />);
      unmount();

      expect(consoleSpy).toHaveBeenCalledWith('{{ComponentName}} unmounted');

      consoleSpy.mockRestore();
    });

    it('cleans up on unmount', () => {
      const { unmount } = render(<{{ComponentName}} title="Test" />);

      expect(() => unmount()).not.toThrow();
    });
  });

  // ============================================================================
  // SNAPSHOT TESTS (Optional)
  // ============================================================================

  describe('Snapshots', () => {
    it('matches snapshot with default props', () => {
      const { container } = render(<{{ComponentName}} title="Test" />);

      expect(container.firstChild).toMatchSnapshot();
    });

    it('matches snapshot with all props', () => {
      const { container } = render(
        <{{ComponentName}}
          title="Test"
          className="custom"
          disabled
          onClick={() => {}}
        >
          <p>Children</p>
        </{{ComponentName}}>
      );

      expect(container.firstChild).toMatchSnapshot();
    });
  });
});
