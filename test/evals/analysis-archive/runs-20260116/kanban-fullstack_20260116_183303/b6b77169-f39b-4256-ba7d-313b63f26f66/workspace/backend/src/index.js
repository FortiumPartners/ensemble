/**
 * Express application entry point.
 * Configures and starts the Kanban Task Board API server.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const boardsRouter = require('./routes/boards');
const columnsRouter = require('./routes/columns');
const cardsRouter = require('./routes/cards');
const reportsRouter = require('./routes/reports');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes - mounted at /api prefix
app.use('/api/boards', boardsRouter);
app.use('/api', columnsRouter);       // Handles /api/boards/:boardId/columns and /api/columns/:id
app.use('/api', cardsRouter);         // Handles /api/columns/:columnId/cards and /api/cards/:id
app.use('/api/reports', reportsRouter);

// 404 handler for unknown routes
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server only if not in test mode
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Kanban API server running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`API base URL: http://localhost:${PORT}/api`);
  });
}

// Export app for testing
module.exports = app;
