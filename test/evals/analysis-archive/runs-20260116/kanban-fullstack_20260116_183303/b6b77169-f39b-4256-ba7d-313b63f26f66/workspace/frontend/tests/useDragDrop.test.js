import { renderHook, act } from '@testing-library/react';
import { useDragDrop } from '../src/hooks/useDragDrop';

describe('useDragDrop', () => {
  const defaultOptions = {
    onDragStart: jest.fn(),
    onDragEnd: jest.fn(),
    onDrop: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts with isDragging false', () => {
    const { result } = renderHook(() => useDragDrop(defaultOptions));

    expect(result.current.isDragging).toBe(false);
  });

  it('starts with draggedItem null', () => {
    const { result } = renderHook(() => useDragDrop(defaultOptions));

    expect(result.current.draggedItem).toBe(null);
  });

  it('starts with dropTarget null', () => {
    const { result } = renderHook(() => useDragDrop(defaultOptions));

    expect(result.current.dropTarget).toBe(null);
  });

  describe('handleDragStart', () => {
    it('sets isDragging to true', async () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        dataTransfer: {
          effectAllowed: '',
          setData: jest.fn(),
        },
      };
      const card = { id: 1, title: 'Test' };

      await act(async () => {
        result.current.handlers.handleDragStart(mockEvent, card, 1);
        // Wait for requestAnimationFrame
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });

      expect(result.current.isDragging).toBe(true);
    });

    it('sets draggedItem', async () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        dataTransfer: {
          effectAllowed: '',
          setData: jest.fn(),
        },
      };
      const card = { id: 1, title: 'Test' };

      await act(async () => {
        result.current.handlers.handleDragStart(mockEvent, card, 1);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });

      expect(result.current.draggedItem).toEqual({ card, columnId: 1 });
    });

    it('sets dataTransfer data', async () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        dataTransfer: {
          effectAllowed: '',
          setData: jest.fn(),
        },
      };
      const card = { id: 1, title: 'Test' };

      await act(async () => {
        result.current.handlers.handleDragStart(mockEvent, card, 1);
      });

      expect(mockEvent.dataTransfer.setData).toHaveBeenCalledWith(
        'application/json',
        JSON.stringify({ cardId: 1, sourceColumnId: 1 })
      );
    });

    it('calls onDragStart callback', async () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        dataTransfer: {
          effectAllowed: '',
          setData: jest.fn(),
        },
      };
      const card = { id: 1, title: 'Test' };

      await act(async () => {
        result.current.handlers.handleDragStart(mockEvent, card, 1);
      });

      expect(defaultOptions.onDragStart).toHaveBeenCalledWith(card, 1);
    });
  });

  describe('handleDragOver', () => {
    it('prevents default', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockEvent, 1);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('sets dropEffect to move', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockEvent, 1);
      });

      expect(mockEvent.dataTransfer.dropEffect).toBe('move');
    });

    it('sets dropTarget', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockEvent, 1);
      });

      expect(result.current.dropTarget).toEqual({
        columnId: 1,
        dropIndex: 0,
      });
    });
  });

  describe('handleDrop', () => {
    it('calls onDrop with correct parameters', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: {
          getData: jest.fn(() =>
            JSON.stringify({ cardId: 1, sourceColumnId: 1 })
          ),
        },
      };

      act(() => {
        result.current.handlers.handleDrop(mockEvent, 2);
      });

      expect(defaultOptions.onDrop).toHaveBeenCalledWith(1, 1, 2, 0);
    });

    it('resets state after drop', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: {
          getData: jest.fn(() =>
            JSON.stringify({ cardId: 1, sourceColumnId: 1 })
          ),
        },
      };

      act(() => {
        result.current.handlers.handleDrop(mockEvent, 2);
      });

      expect(result.current.isDragging).toBe(false);
      expect(result.current.draggedItem).toBe(null);
      expect(result.current.dropTarget).toBe(null);
    });
  });

  describe('handleDragEnd', () => {
    it('resets all drag state', async () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      // First set some state
      const mockStartEvent = {
        dataTransfer: {
          effectAllowed: '',
          setData: jest.fn(),
        },
      };
      const card = { id: 1, title: 'Test' };

      await act(async () => {
        result.current.handlers.handleDragStart(mockStartEvent, card, 1);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });

      expect(result.current.isDragging).toBe(true);

      act(() => {
        result.current.handlers.handleDragEnd();
      });

      expect(result.current.isDragging).toBe(false);
      expect(result.current.draggedItem).toBe(null);
      expect(result.current.dropTarget).toBe(null);
    });

    it('calls onDragEnd callback', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      act(() => {
        result.current.handlers.handleDragEnd();
      });

      expect(defaultOptions.onDragEnd).toHaveBeenCalled();
    });
  });

  describe('isDropTarget', () => {
    it('returns true when column is drop target', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockEvent, 1);
      });

      expect(result.current.isDropTarget(1)).toBe(true);
    });

    it('returns false when column is not drop target', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      expect(result.current.isDropTarget(1)).toBe(false);
    });
  });

  describe('isCardDragging', () => {
    it('returns true when card is being dragged', async () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        dataTransfer: {
          effectAllowed: '',
          setData: jest.fn(),
        },
      };
      const card = { id: 1, title: 'Test' };

      await act(async () => {
        result.current.handlers.handleDragStart(mockEvent, card, 1);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });

      expect(result.current.isCardDragging(1)).toBe(true);
    });

    it('returns false when different card is being dragged', async () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        dataTransfer: {
          effectAllowed: '',
          setData: jest.fn(),
        },
      };
      const card = { id: 1, title: 'Test' };

      await act(async () => {
        result.current.handlers.handleDragStart(mockEvent, card, 1);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });

      expect(result.current.isCardDragging(2)).toBe(false);
    });

    it('returns false when nothing is dragged', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      expect(result.current.isCardDragging(1)).toBe(false);
    });
  });

  describe('handleDragEnter', () => {
    it('sets dropTarget when entering a new column', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        preventDefault: jest.fn(),
      };

      act(() => {
        result.current.handlers.handleDragEnter(mockEvent, 1);
      });

      expect(result.current.dropTarget).toEqual({ columnId: 1, dropIndex: 0 });
    });

    it('does not update dropTarget when already in same column', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockOverEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockOverEvent, 1);
      });

      const initialDropTarget = result.current.dropTarget;

      const mockEnterEvent = { preventDefault: jest.fn() };

      act(() => {
        result.current.handlers.handleDragEnter(mockEnterEvent, 1);
      });

      expect(result.current.dropTarget.columnId).toBe(initialDropTarget.columnId);
    });

    it('updates dropTarget when entering different column', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockOverEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockOverEvent, 1);
      });

      const mockEnterEvent = { preventDefault: jest.fn() };

      act(() => {
        result.current.handlers.handleDragEnter(mockEnterEvent, 2);
      });

      expect(result.current.dropTarget.columnId).toBe(2);
    });
  });

  describe('handleDragLeave', () => {
    it('clears dropTarget when leaving column', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      // Set up drop target first
      const mockOverEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockOverEvent, 1);
      });

      expect(result.current.dropTarget).not.toBeNull();

      // Create leave event with relatedTarget outside
      const currentTarget = document.createElement('div');
      const relatedTarget = document.createElement('div');
      const mockLeaveEvent = {
        currentTarget,
        relatedTarget,
      };

      act(() => {
        result.current.handlers.handleDragLeave(mockLeaveEvent);
      });

      expect(result.current.dropTarget).toBeNull();
    });

    it('does not clear dropTarget when moving to child element', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      // Set up drop target first
      const mockOverEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockOverEvent, 1);
      });

      const previousTarget = result.current.dropTarget;

      // Create leave event with relatedTarget as child of currentTarget
      const currentTarget = document.createElement('div');
      const childElement = document.createElement('div');
      currentTarget.appendChild(childElement);
      const mockLeaveEvent = {
        currentTarget,
        relatedTarget: childElement,
      };

      act(() => {
        result.current.handlers.handleDragLeave(mockLeaveEvent);
      });

      expect(result.current.dropTarget).toEqual(previousTarget);
    });
  });

  describe('handleDrop error handling', () => {
    it('handles invalid JSON gracefully', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: {
          getData: jest.fn(() => 'invalid json'),
        },
      };

      // Should not throw
      act(() => {
        result.current.handlers.handleDrop(mockEvent, 2);
      });

      // Should still clean up state
      expect(result.current.isDragging).toBe(false);
      expect(defaultOptions.onDrop).not.toHaveBeenCalled();
    });
  });

  describe('isDropIndicator', () => {
    it('returns true when position matches drop target', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockEvent, 1);
      });

      expect(result.current.isDropIndicator(1, 0)).toBe(true);
    });

    it('returns false when column does not match', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockEvent, 1);
      });

      expect(result.current.isDropIndicator(2, 0)).toBe(false);
    });

    it('returns false when index does not match', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockEvent, 1);
      });

      expect(result.current.isDropIndicator(1, 5)).toBe(false);
    });

    it('returns false when no drop target', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      expect(result.current.isDropIndicator(1, 0)).toBe(false);
    });
  });

  describe('calculateDropIndex', () => {
    it('calculates drop index based on card positions', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      // Create a column with cards
      const columnElement = document.createElement('div');
      const card1 = document.createElement('div');
      card1.setAttribute('data-card-id', '1');
      const card2 = document.createElement('div');
      card2.setAttribute('data-card-id', '2');
      columnElement.appendChild(card1);
      columnElement.appendChild(card2);

      // Mock getBoundingClientRect
      card1.getBoundingClientRect = () => ({ top: 0, height: 100 });
      card2.getBoundingClientRect = () => ({ top: 100, height: 100 });

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: columnElement,
        clientY: 150, // Between card1 and card2
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockEvent, 1);
      });

      // At y=150, it's below card1 middle (50) but at card2 middle (150)
      expect(result.current.dropTarget.dropIndex).toBe(2);
    });

    it('returns 0 for empty column', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const emptyColumn = document.createElement('div');

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: emptyColumn,
        clientY: 100,
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockEvent, 1);
      });

      expect(result.current.dropTarget.dropIndex).toBe(0);
    });

    it('returns first position when above all cards', () => {
      const { result } = renderHook(() => useDragDrop(defaultOptions));

      const columnElement = document.createElement('div');
      const card1 = document.createElement('div');
      card1.setAttribute('data-card-id', '1');
      card1.getBoundingClientRect = () => ({ top: 100, height: 100 });
      columnElement.appendChild(card1);

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: columnElement,
        clientY: 50, // Above card1
        dataTransfer: { dropEffect: '' },
      };

      act(() => {
        result.current.handlers.handleDragOver(mockEvent, 1);
      });

      expect(result.current.dropTarget.dropIndex).toBe(0);
    });
  });

  describe('callbacks without options', () => {
    it('handles missing onDragStart callback', async () => {
      const { result } = renderHook(() => useDragDrop({}));

      const mockEvent = {
        dataTransfer: {
          effectAllowed: '',
          setData: jest.fn(),
        },
      };

      // Should not throw
      await act(async () => {
        result.current.handlers.handleDragStart(mockEvent, { id: 1 }, 1);
      });
    });

    it('handles missing onDragEnd callback', () => {
      const { result } = renderHook(() => useDragDrop({}));

      // Should not throw
      act(() => {
        result.current.handlers.handleDragEnd();
      });
    });

    it('handles missing onDrop callback', () => {
      const { result } = renderHook(() => useDragDrop({}));

      const mockEvent = {
        preventDefault: jest.fn(),
        currentTarget: document.createElement('div'),
        clientY: 100,
        dataTransfer: {
          getData: jest.fn(() =>
            JSON.stringify({ cardId: 1, sourceColumnId: 1 })
          ),
        },
      };

      // Should not throw
      act(() => {
        result.current.handlers.handleDrop(mockEvent, 2);
      });
    });
  });
});
