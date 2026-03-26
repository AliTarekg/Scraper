# ⚡ Scraper Dashboard

A production-ready web scraping dashboard that detects website types (Shopify, WooCommerce, WordPress, Generic), scrapes product data, and provides real-time tracking with a clean dark-themed UI.

## Features

- **Smart Detection** — Auto-detects Shopify, WooCommerce, WordPress, or generic sites
- **Adaptive Scraping** — API → DOM → Headless browser fallback chain
- **Real-time Tracking** — WebSocket-powered live progress, logs, and product stream
- **Data Management** — Search, filter, paginate scraped products
- **Export** — CSV, Excel (.xlsx), and JSON with filter support
- **Queue System** — BullMQ-based job queue with configurable concurrency

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | EJS + Vanilla JS + Socket.IO |
| Backend | Express.js |
| Database | MySQL + Sequelize ORM |
| Queue | BullMQ + Redis |
| Scraping | Axios + Cheerio + Puppeteer |
| Real-time | Socket.IO |
| Export | ExcelJS + json2csv |

## Prerequisites

- **Node.js** 18+
- **MySQL** 8.0+
- **Redis** 6+ (for job queue)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your MySQL + Redis credentials
```

### 3. Create the database

```sql
CREATE DATABASE scraper_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 4. Run migrations

```bash
npm run migrate
```

### 5. Start the server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

### 6. Open the dashboard

Visit **http://localhost:3000**

## Project Structure

```
src/
├── config/          # Environment config
├── database/        # Connection + migrations
├── models/          # Sequelize models (ScrapingJob, Product, Page, Log, Export)
├── scraper/         # Scraping engine
│   ├── SiteDetector.js       # Platform detection
│   ├── ScraperEngine.js      # Orchestrator with fallback chain
│   └── strategies/           # Scraping strategies
│       ├── BaseScraper.js          # Base class
│       ├── ShopifyApiScraper.js    # Shopify products.json API
│       ├── WooCommerceApiScraper.js # WC Store API
│       └── DomScraper.js          # Generic DOM crawl + extract
├── services/        # Business logic (JobService, ExportService)
├── routes/          # Express routes (API + views)
├── realtime/        # Socket.IO setup
├── workers/         # BullMQ queue + worker
├── views/           # EJS templates
├── public/          # Static assets
└── server.js        # Entry point
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs` | List jobs (with pagination, search, status filter) |
| POST | `/api/jobs` | Create new scraping job |
| GET | `/api/jobs/stats` | Dashboard statistics |
| GET | `/api/jobs/:id` | Job details |
| POST | `/api/jobs/:id/cancel` | Cancel a running job |
| POST | `/api/jobs/:id/rerun` | Re-run a completed/failed job |
| DELETE | `/api/jobs/:id` | Delete job and all data |
| GET | `/api/jobs/:id/products` | Job products (paginated, filterable) |
| GET | `/api/jobs/:id/pages` | Crawled pages |
| GET | `/api/jobs/:id/logs` | Job logs |
| POST | `/api/exports/:jobId` | Generate export (csv/excel/json) |
| GET | `/api/exports/:jobId` | List exports for a job |
| GET | `/api/exports/download/:id` | Download export file |

## How It Works

1. **Submit URL** → Job created with `pending` status, pushed to BullMQ queue
2. **Detection** → Worker fingerprints the site (checks for Shopify CDN, WooCommerce classes, WordPress meta tags)
3. **Strategy Selection** → Based on detected type, picks the most efficient scraping approach
4. **Scraping** → Executes strategy with real-time event emission via Socket.IO
5. **Storage** → Products batch-saved to MySQL with deduplication via SHA256 fingerprint
6. **Export** → On-demand file generation with filter support

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `PORT` | 3000 | Server port |
| `DB_HOST` | localhost | MySQL host |
| `DB_NAME` | scraper_dashboard | Database name |
| `REDIS_HOST` | localhost | Redis host |
| `SCRAPER_MAX_DEPTH` | 3 | Default crawl depth |
| `SCRAPER_MAX_PAGES` | 200 | Default max pages |
| `SCRAPER_DELAY_MS` | 1000 | Delay between requests |
| `SCRAPER_CONCURRENCY` | 3 | Parallel workers |
