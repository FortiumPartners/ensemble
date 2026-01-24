const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

// Get region information
const FLY_REGION = process.env.FLY_REGION || 'unknown';
const FLY_APP_NAME = process.env.FLY_APP_NAME || 'unknown';
const FLY_ALLOC_ID = process.env.FLY_ALLOC_ID || 'unknown';

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    region: FLY_REGION,
    allocation: FLY_ALLOC_ID
  });
});

// Region info endpoint
app.get('/api/region', (req, res) => {
  res.json({
    region: FLY_REGION,
    app: FLY_APP_NAME,
    allocation: FLY_ALLOC_ID,
    nearestRegion: req.get('fly-region') || FLY_REGION,
    clientRegion: req.get('fly-client-region'),
    timestamp: new Date().toISOString()
  });
});

// Example API endpoint
app.get('/api/data', (req, res) => {
  res.json({
    message: `Data served from ${FLY_REGION}`,
    region: FLY_REGION,
    data: {
      id: 1,
      value: 'example'
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Multi-region app listening on port ${PORT} in ${FLY_REGION}`);
});
