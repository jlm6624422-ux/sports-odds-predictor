const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { initDatabase } = require('./config/database');
const oddsRoutes = require('./routes/odds');
const predictionsRoutes = require('./routes/predictions');
const betsRoutes = require('./routes/bets');
const dataRoutes = require('./routes/data');

const app = express();
const PORT = process.env.SERVER_PORT || 3001;
const HOST = process.env.SERVER_HOST || '127.0.0.1';

// Middleware
app.use(cors({ origin: 'http://127.0.0.1:5173' }));
app.use(express.json());

// Initialize database
const db = initDatabase();

// Make db available to routes
app.use((req, res, next) => {
  req.db = db;
  next();
});

// Routes
app.use('/api/odds', oddsRoutes);
app.use('/api/predictions', predictionsRoutes);
app.use('/api/bets', betsRoutes);
app.use('/api/data', dataRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
