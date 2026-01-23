import { useState, useEffect, useCallback, useReducer } from 'react';
import { api } from './useApi';

/**
 * Calculate position for inserting an item
 * Uses fractional indexing for efficient ordering
 *
 * @param {Array} items - Array of items with position property
 * @param {number} targetIndex - Index where new item should be inserted
 * @returns {number} Calculated position value
 */
function calculatePosition(items, targetIndex) {
  const POSITION_GAP = 1024;

  if (items.length === 0) {
    return POSITION_GAP;
  }

  const sortedItems = [...items].sort((a, b) => a.position - b.position);

  // Insert at the beginning
  if (targetIndex === 0) {
    return sortedItems[0].position / 2;
  }

  // Insert at the end
  if (targetIndex >= sortedItems.length) {
    return sortedItems[sortedItems.length - 1].position + POSITION_GAP;
  }

  // Insert between two items
  const prevPosition = sortedItems[targetIndex - 1].position;
  const nextPosition = sortedItems[targetIndex].position;
  return (prevPosition + nextPosition) / 2;
}

/**
 * Board state reducer for managing complex state updates
 */
function boardReducer(state, action) {
  switch (action.type) {
    case 'SET_BOARD':
      return {
        ...state,
        board: action.payload,
        loading: false,
        error: null,
      };

    case 'SET_LOADING':
      return {
        ...state,
        loading: action.payload,
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        loading: false,
      };

    case 'UPDATE_BOARD_NAME':
      return {
        ...state,
        board: {
          ...state.board,
          name: action.payload,
        },
      };

    case 'ADD_COLUMN':
      return {
        ...state,
        board: {
          ...state.board,
          columns: [...state.board.columns, { ...action.payload, cards: [] }],
        },
      };

    case 'UPDATE_COLUMN':
      return {
        ...state,
        board: {
          ...state.board,
          columns: state.board.columns.map((col) =>
            col.id === action.payload.id ? { ...col, ...action.payload.updates } : col
          ),
        },
      };

    case 'DELETE_COLUMN':
      return {
        ...state,
        board: {
          ...state.board,
          columns: state.board.columns.filter((col) => col.id !== action.payload),
        },
      };

    case 'ADD_CARD': {
      const { columnId, card } = action.payload;
      return {
        ...state,
        board: {
          ...state.board,
          columns: state.board.columns.map((col) =>
            col.id === columnId ? { ...col, cards: [...col.cards, card] } : col
          ),
        },
      };
    }

    case 'UPDATE_CARD': {
      const { cardId, updates } = action.payload;
      return {
        ...state,
        board: {
          ...state.board,
          columns: state.board.columns.map((col) => ({
            ...col,
            cards: col.cards.map((card) =>
              card.id === cardId ? { ...card, ...updates } : card
            ),
          })),
        },
      };
    }

    case 'DELETE_CARD': {
      const cardId = action.payload;
      return {
        ...state,
        board: {
          ...state.board,
          columns: state.board.columns.map((col) => ({
            ...col,
            cards: col.cards.filter((card) => card.id !== cardId),
          })),
        },
      };
    }

    case 'MOVE_CARD': {
      const { cardId, sourceColumnId, targetColumnId, targetPosition } = action.payload;
      let movedCard = null;

      // Remove card from source column and find it
      const columnsWithoutCard = state.board.columns.map((col) => {
        if (col.id === sourceColumnId) {
          const card = col.cards.find((c) => c.id === cardId);
          if (card) {
            movedCard = { ...card, position: targetPosition, column_id: targetColumnId };
          }
          return {
            ...col,
            cards: col.cards.filter((c) => c.id !== cardId),
          };
        }
        return col;
      });

      // Add card to target column
      if (movedCard) {
        return {
          ...state,
          board: {
            ...state.board,
            columns: columnsWithoutCard.map((col) => {
              if (col.id === targetColumnId) {
                const newCards = [...col.cards, movedCard].sort(
                  (a, b) => a.position - b.position
                );
                return { ...col, cards: newCards };
              }
              return col;
            }),
          },
        };
      }
      return state;
    }

    default:
      return state;
  }
}

const initialState = {
  board: null,
  loading: true,
  error: null,
};

/**
 * Hook for managing board state and operations
 *
 * @param {string|number} boardId - ID of the board to load
 * @returns {Object} Board state and actions
 *
 * @example
 * const { board, loading, error, actions } = useBoard(boardId);
 *
 * // Create a new column
 * await actions.createColumn('To Do');
 *
 * // Create a new card
 * await actions.createCard(columnId, 'New Task', 'Description');
 *
 * // Move a card
 * await actions.moveCard(cardId, targetColumnId, targetPosition);
 */
export function useBoard(boardId) {
  const [state, dispatch] = useReducer(boardReducer, initialState);

  /**
   * Fetch board data from the API
   */
  const fetchBoard = useCallback(async () => {
    if (!boardId) {
      dispatch({ type: 'SET_ERROR', payload: new Error('Board ID is required') });
      return;
    }

    dispatch({ type: 'SET_LOADING', payload: true });

    try {
      const board = await api.get(`/boards/${boardId}`);

      // Sort columns and cards by position
      if (board.columns) {
        board.columns = board.columns
          .sort((a, b) => a.position - b.position)
          .map((col) => ({
            ...col,
            cards: (col.cards || []).sort((a, b) => a.position - b.position),
          }));
      }

      dispatch({ type: 'SET_BOARD', payload: board });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err });
    }
  }, [boardId]);

  // Fetch board on mount and when boardId changes
  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  /**
   * Update board name
   * @param {string} name - New board name
   */
  const updateBoardName = useCallback(async (name) => {
    if (!name.trim()) return;

    dispatch({ type: 'UPDATE_BOARD_NAME', payload: name });

    try {
      await api.put(`/boards/${boardId}`, { name });
    } catch (err) {
      // Revert on error
      await fetchBoard();
      throw err;
    }
  }, [boardId, fetchBoard]);

  /**
   * Create a new column
   * @param {string} name - Column name
   */
  const createColumn = useCallback(async (name) => {
    if (!name.trim()) return null;

    try {
      const column = await api.post(`/boards/${boardId}/columns`, { name });
      dispatch({ type: 'ADD_COLUMN', payload: column });
      return column;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err });
      throw err;
    }
  }, [boardId]);

  /**
   * Update a column
   * @param {number} columnId - Column ID
   * @param {Object} updates - Column updates (name, position)
   */
  const updateColumn = useCallback(async (columnId, updates) => {
    dispatch({ type: 'UPDATE_COLUMN', payload: { id: columnId, updates } });

    try {
      await api.put(`/columns/${columnId}`, updates);
    } catch (err) {
      // Revert on error
      await fetchBoard();
      throw err;
    }
  }, [fetchBoard]);

  /**
   * Delete a column
   * @param {number} columnId - Column ID
   */
  const deleteColumn = useCallback(async (columnId) => {
    dispatch({ type: 'DELETE_COLUMN', payload: columnId });

    try {
      await api.del(`/columns/${columnId}`);
    } catch (err) {
      // Revert on error
      await fetchBoard();
      throw err;
    }
  }, [fetchBoard]);

  /**
   * Create a new card
   * @param {number} columnId - Target column ID
   * @param {string} title - Card title
   * @param {string} description - Card description (optional)
   */
  const createCard = useCallback(async (columnId, title, description = '') => {
    if (!title.trim()) return null;

    try {
      const card = await api.post(`/columns/${columnId}/cards`, { title, description });
      dispatch({ type: 'ADD_CARD', payload: { columnId, card } });
      return card;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err });
      throw err;
    }
  }, []);

  /**
   * Update a card
   * @param {number} cardId - Card ID
   * @param {Object} updates - Card updates (title, description)
   */
  const updateCard = useCallback(async (cardId, updates) => {
    dispatch({ type: 'UPDATE_CARD', payload: { cardId, updates } });

    try {
      await api.put(`/cards/${cardId}`, updates);
    } catch (err) {
      // Revert on error
      await fetchBoard();
      throw err;
    }
  }, [fetchBoard]);

  /**
   * Delete a card
   * @param {number} cardId - Card ID
   */
  const deleteCard = useCallback(async (cardId) => {
    dispatch({ type: 'DELETE_CARD', payload: cardId });

    try {
      await api.del(`/cards/${cardId}`);
    } catch (err) {
      // Revert on error
      await fetchBoard();
      throw err;
    }
  }, [fetchBoard]);

  /**
   * Move a card to a new position/column
   * @param {number} cardId - Card ID
   * @param {number} sourceColumnId - Source column ID
   * @param {number} targetColumnId - Target column ID
   * @param {number} targetIndex - Target index in the column
   */
  const moveCard = useCallback(async (cardId, sourceColumnId, targetColumnId, targetIndex) => {
    // Find target column to calculate position
    const targetColumn = state.board.columns.find((col) => col.id === targetColumnId);
    if (!targetColumn) return;

    // Filter out the card being moved if same column
    const existingCards = sourceColumnId === targetColumnId
      ? targetColumn.cards.filter((c) => c.id !== cardId)
      : targetColumn.cards;

    const targetPosition = calculatePosition(existingCards, targetIndex);

    // Optimistic update
    dispatch({
      type: 'MOVE_CARD',
      payload: { cardId, sourceColumnId, targetColumnId, targetPosition },
    });

    try {
      await api.patch(`/cards/${cardId}/move`, {
        columnId: targetColumnId,
        position: targetPosition,
      });
    } catch (err) {
      // Revert on error
      await fetchBoard();
      throw err;
    }
  }, [state.board, fetchBoard]);

  /**
   * Refresh board data from the server
   */
  const refresh = useCallback(() => {
    return fetchBoard();
  }, [fetchBoard]);

  return {
    board: state.board,
    loading: state.loading,
    error: state.error,
    actions: {
      updateBoardName,
      createColumn,
      updateColumn,
      deleteColumn,
      createCard,
      updateCard,
      deleteCard,
      moveCard,
      refresh,
    },
  };
}

export { calculatePosition };
export default useBoard;
