require('dotenv').config();

const path = require('path');
const appDir = process.pkg ? path.dirname(process.execPath) : process.cwd();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  env: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    name: process.env.DB_NAME || 'scraper_dashboard',
    user: process.env.DB_USER || 'root',
    pass: process.env.DB_PASS || '',
  },

  scraper: {
    maxDepth: parseInt(process.env.SCRAPER_MAX_DEPTH, 10) || 3,
    maxPages: parseInt(process.env.SCRAPER_MAX_PAGES, 10) || 200,
    delayMs: parseInt(process.env.SCRAPER_DELAY_MS, 10) || 1000,
    concurrency: parseInt(process.env.SCRAPER_CONCURRENCY, 10) || 3,
    timeoutMs: parseInt(process.env.SCRAPER_TIMEOUT_MS, 10) || 30000,
  },

  export: {
    dir: process.env.EXPORT_DIR || path.join(appDir, 'exports'),
    maxAgeDays: parseInt(process.env.EXPORT_MAX_AGE_DAYS, 10) || 7,
  },
};
