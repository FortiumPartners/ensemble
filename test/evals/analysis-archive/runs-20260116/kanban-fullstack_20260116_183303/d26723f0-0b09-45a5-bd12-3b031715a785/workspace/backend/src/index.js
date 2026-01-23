const express = require('express');
const cors = require('cors');
const boardsRouter = require('./routes/boards');
const columnsRouter = require('./routes/columns');
const cardsRouter = require('./routes/cards');
const reportsRouter = require('./routes/reports');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/boards', boardsRouter);
app.use('/api', columnsRouter);
app.use('/api', cardsRouter);
app.use('/api/reports', reportsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handler
app.use(errorHandler);

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Kanban API server running on port ${PORT}`);
  });
}

module.exports = app;
