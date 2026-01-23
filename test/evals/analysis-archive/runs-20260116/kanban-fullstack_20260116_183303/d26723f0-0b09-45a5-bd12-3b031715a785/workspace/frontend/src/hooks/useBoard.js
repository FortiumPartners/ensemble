import { useState, useEffect, useCallback } from 'react';
import { useApi } from './useApi';

export function useBoard(boardId) {
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { get, post, put, patch, del } = useApi();

  const fetchBoard = useCallback(async () => {
    if (!boardId) {
      setBoard(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await get(`/boards/${boardId}`);
      setBoard(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [boardId, get]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  const createColumn = useCallback(async (name) => {
    const column = await post(`/boards/${boardId}/columns`, { name });
    setBoard(prev => ({
      ...prev,
      columns: [...(prev.columns || []), { ...column, cards: [] }],
    }));
    return column;
  }, [boardId, post]);

  const updateColumn = useCallback(async (columnId, updates) => {
    const column = await put(`/columns/${columnId}`, updates);
    setBoard(prev => ({
      ...prev,
      columns: prev.columns.map(c =>
        c.id === columnId ? { ...c, ...column } : c
      ),
    }));
    return column;
  }, [put]);

  const deleteColumn = useCallback(async (columnId) => {
    await del(`/columns/${columnId}`);
    setBoard(prev => ({
      ...prev,
      columns: prev.columns.filter(c => c.id !== columnId),
    }));
  }, [del]);

  const createCard = useCallback(async (columnId, title, description) => {
    const card = await post(`/columns/${columnId}/cards`, { title, description });
    setBoard(prev => ({
      ...prev,
      columns: prev.columns.map(c =>
        c.id === columnId
          ? { ...c, cards: [...(c.cards || []), card] }
          : c
      ),
    }));
    return card;
  }, [post]);

  const updateCard = useCallback(async (cardId, updates) => {
    const card = await put(`/cards/${cardId}`, updates);
    setBoard(prev => ({
      ...prev,
      columns: prev.columns.map(c => ({
        ...c,
        cards: c.cards.map(card =>
          card.id === cardId ? { ...card, ...updates } : card
        ),
      })),
    }));
    return card;
  }, [put]);

  const deleteCard = useCallback(async (cardId) => {
    await del(`/cards/${cardId}`);
    setBoard(prev => ({
      ...prev,
      columns: prev.columns.map(c => ({
        ...c,
        cards: c.cards.filter(card => card.id !== cardId),
      })),
    }));
  }, [del]);

  const moveCard = useCallback(async (cardId, targetColumnId, targetPosition) => {
    const result = await patch(`/cards/${cardId}/move`, {
      columnId: targetColumnId,
      position: targetPosition,
    });

    // Update local state - find the card and move it
    setBoard(prev => {
      let movedCard = null;

      // Find and remove card from its current column
      const columnsAfterRemove = prev.columns.map(c => {
        const cardIndex = c.cards.findIndex(card => card.id === cardId);
        if (cardIndex !== -1) {
          movedCard = { ...c.cards[cardIndex], position: targetPosition };
          return {
            ...c,
            cards: c.cards.filter(card => card.id !== cardId),
          };
        }
        return c;
      });

      // Add card to target column
      const columnsAfterAdd = columnsAfterRemove.map(c => {
        if (c.id === targetColumnId && movedCard) {
          const cards = [...c.cards, movedCard].sort((a, b) => a.position - b.position);
          return { ...c, cards };
        }
        return c;
      });

      return { ...prev, columns: columnsAfterAdd };
    });

    return result;
  }, [patch]);

  return {
    board,
    loading,
    error,
    refetch: fetchBoard,
    actions: {
      createColumn,
      updateColumn,
      deleteColumn,
      createCard,
      updateCard,
      deleteCard,
      moveCard,
    },
  };
}

export default useBoard;
