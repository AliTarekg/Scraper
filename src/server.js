// Resolve the .env file from the executable's directory (not the pkg snapshot)
const path = require('path');
const appDir = process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(appDir, '.env') });

const express = require('express');
const http = require('http');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const config = require('./config');
const sequelize = require('./database/connection');
const { initSocketIO } = require('./realtime/socketio');

// Import models to register associations
require('./models');

const app = express();
const server = http.createServer(app);

// Security & middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "ws://localhost:*", "wss://localhost:*"],
    },
  },
}));
app.use(compression());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files — served from snapshot in .exe, from src/public in dev
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/exports', require('./routes/exports'));
app.use('/', require('./routes/views'));

// Initialize Socket.IO
const io = initSocketIO(server);

// Start
async function start() {
  try {
    // Connect to database
    await sequelize.authenticate();
    console.log('[DB] Connected to MySQL');

    // Sync schema
    await sequelize.sync({ alter: false });
    console.log('[DB] Schema synced');

    console.log('[Worker] In-memory job processor ready');

    // Start server
    server.listen(config.port, () => {
      console.log(`\n🚀 Scraper Dashboard running at http://localhost:${config.port}\n`);
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

start();
