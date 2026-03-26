# Web Scraping Dashboard — System Architecture

## 1. System Overview

A SaaS-grade web scraping platform that allows users to input any website URL, automatically detect the platform type, scrape product data intelligently, and manage everything through a real-time dashboard.

### Core Capabilities
- **Smart Detection**: Auto-detect WordPress, WooCommerce, Shopify, or generic sites
- **Adaptive Scraping**: API-first → DOM parsing → Headless browser fallback chain
- **Real-time Tracking**: WebSocket-powered live progress, logs, and results
- **Data Management**: Full CRUD dashboard with filtering, search, and export
- **Export**: CSV, Excel, JSON with per-job and filtered export support
- **Scheduling**: Cron-based recurring scrape jobs with change tracking

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (EJS + Vanilla JS)           │
│  Dashboard │ Job Creator │ Job Details │ Export Manager   │
│                    ↕ HTTP + WebSocket                    │
├─────────────────────────────────────────────────────────┤
│                    API LAYER (Express.js)                │
│  REST Controllers │ WebSocket Server (Socket.IO)         │
├─────────────────────────────────────────────────────────┤
│                    SERVICE LAYER                         │
│  JobService │ ScraperService │ ExportService │ DetectSvc │
├──────────────┬──────────────────────────────────────────┤
│  QUEUE       │         SCRAPER ENGINE                    │
│  (BullMQ)    │  Detector → Strategy Router → Extractors  │
│  Redis-backed│  ┌─────────┬──────────┬──────────┐       │
│              │  │ API     │ DOM      │ Headless │       │
│              │  │ Scraper │ Scraper  │ Scraper  │       │
│              │  └─────────┴──────────┴──────────┘       │
├──────────────┴──────────────────────────────────────────┤
│                    DATA LAYER                            │
│        MySQL (Sequelize ORM) │ Redis (Queue + Cache)     │
└─────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Technology | Responsibility |
|-------|-----------|----------------|
| Frontend | EJS templates + Vanilla JS + Socket.IO client | UI rendering, real-time updates, user interactions |
| API | Express.js | REST endpoints, request validation, auth middleware |
| WebSocket | Socket.IO | Real-time progress, live logs, live product stream |
| Service | Plain Node.js classes | Business logic, orchestration |
| Queue | BullMQ + Redis | Job queuing, concurrency control, retry logic |
| Scraper Engine | Cheerio + Puppeteer + Axios | Detection, scraping strategies, data extraction |
| Database | MySQL + Sequelize | Persistent storage, relationships, indexing |
| Cache | Redis | Queue backend, rate limit counters, detection cache |

### Data Flow

1. User submits URL → API creates `scraping_job` (status: `pending`)
2. Job ID pushed to BullMQ queue
3. Worker picks job → runs **Detector** → determines site type
4. Strategy Router selects scraping approach (API / DOM / Headless)
5. Scraper crawls pages, emits events via Socket.IO:
   - `job:progress` — percentage, current URL
   - `job:product` — new product found
   - `job:log` — log entry
6. Products + pages saved to MySQL in batches
7. Job marked `completed` or `failed`
8. User views results, filters, exports

---

## 3. Scraping Engine Design

### 3.1 Site Detection

Detection runs fingerprinting checks in order:

```
1. Check for Shopify indicators:
   - window.Shopify JS object
   - /cdn.shopify.com/ in page source
   - meta[name="shopify-checkout-api-token"]
   - /products.json endpoint returns valid JSON

2. Check for WooCommerce indicators:
   - <body> class contains "woocommerce"
   - /wp-json/wc/v3/ API endpoint
   - woocommerce scripts/stylesheets loaded
   - /wp-content/plugins/woocommerce/ paths

3. Check for WordPress (non-WooCommerce):
   - /wp-json/ API available
   - <meta name="generator" content="WordPress">
   - /wp-content/ paths present

4. Fallback: Generic site
   - Use heuristic product detection
```

### 3.2 Strategy Chain (Fallback Pattern)

```
API Scraper (fastest, most reliable)
  ↓ fails?
DOM Scraper (Cheerio — fast, no browser needed)
  ↓ fails or JS-rendered content?
Headless Scraper (Puppeteer — handles JS/SPA)
```

### 3.3 Platform-Specific Strategies

**Shopify:**
- Hit `/products.json?limit=250&page={n}` — paginate until empty
- Each product has variants, images, description — map directly

**WooCommerce:**
- Try `/wp-json/wc/store/v1/products?per_page=100&page={n}`
- Public store API doesn't need auth
- Fallback to DOM parsing of shop/product pages

**WordPress (blog/generic):**
- `/wp-json/wp/v2/posts` for content
- DOM parse for product-like content

**Generic Sites:**
- Crawl from entry URL, discover links
- Score pages for "product-likeness" using heuristics:
  - Has price pattern ($ / € / £ followed by digits)
  - Has add-to-cart button
  - Has product image gallery
  - Has structured data (JSON-LD, microdata)
- Extract using CSS selector patterns + structured data

### 3.4 Product Page Detection

Automatic product page detection uses scoring:

| Signal | Score |
|--------|-------|
| JSON-LD `@type: Product` | +50 |
| `og:type` = `product` | +30 |
| Price pattern on page | +20 |
| "Add to cart" button | +20 |
| Image gallery (3+ images) | +10 |
| `/product/` in URL | +15 |
| Single main heading + price + image layout | +15 |

Pages scoring ≥ 40 are treated as product pages.

### 3.5 Pagination Handling

- **API**: Follow page/offset params until empty response
- **DOM**: Detect next/prev links, "Load More" patterns, page number sequences
- **Infinite scroll**: Puppeteer scrolls and waits for new content

### 3.6 Crawl Strategy

- BFS from entry URL within same domain
- Max depth configurable (default: 3)
- Max pages configurable (default: 200)
- Respect robots.txt
- 1-2 second delay between requests (configurable)
- Track visited URLs to avoid cycles

---

## 4. Database Design (MySQL)

### Tables

```sql
-- Core job tracking
scraping_jobs:
  id              INT AUTO_INCREMENT PK
  url             VARCHAR(2048) NOT NULL
  domain          VARCHAR(255) NOT NULL INDEX
  site_type       ENUM('shopify','woocommerce','wordpress','generic') NULL
  status          ENUM('pending','detecting','scraping','completed','failed','cancelled') DEFAULT 'pending'
  strategy_used   ENUM('api','dom','headless') NULL
  config          JSON                    -- depth, max_pages, delay, etc.
  stats           JSON                    -- pages_crawled, products_found, errors
  progress        TINYINT DEFAULT 0       -- 0-100
  scheduled_cron  VARCHAR(100) NULL       -- cron expression for recurring
  parent_job_id   INT NULL FK(scraping_jobs.id)  -- for recurring job instances
  error_message   TEXT NULL
  started_at      DATETIME NULL
  completed_at    DATETIME NULL
  created_at      DATETIME DEFAULT NOW()
  updated_at      DATETIME DEFAULT NOW() ON UPDATE NOW()
  INDEX idx_status (status)
  INDEX idx_domain (domain)
  INDEX idx_created (created_at)

-- Scraped products
products:
  id              INT AUTO_INCREMENT PK
  job_id          INT NOT NULL FK(scraping_jobs.id) ON DELETE CASCADE
  source_url      VARCHAR(2048)
  name            VARCHAR(500)
  price           DECIMAL(12,2) NULL
  price_currency  VARCHAR(10) NULL
  description     TEXT NULL
  images          JSON                    -- array of image URLs
  metadata        JSON                    -- arbitrary key-value pairs
  fingerprint     VARCHAR(64) INDEX       -- SHA256 of (domain + name + price) for dedup
  created_at      DATETIME DEFAULT NOW()
  updated_at      DATETIME DEFAULT NOW() ON UPDATE NOW()
  INDEX idx_job (job_id)
  INDEX idx_name (name(100))
  UNIQUE INDEX idx_fingerprint_job (job_id, fingerprint)

-- Crawled pages tracking
pages:
  id              INT AUTO_INCREMENT PK
  job_id          INT NOT NULL FK(scraping_jobs.id) ON DELETE CASCADE
  url             VARCHAR(2048)
  status_code     SMALLINT NULL
  is_product_page BOOLEAN DEFAULT FALSE
  product_score   TINYINT DEFAULT 0
  depth           TINYINT DEFAULT 0
  scraped_at      DATETIME DEFAULT NOW()
  INDEX idx_job (job_id)
  INDEX idx_product (job_id, is_product_page)

-- Audit log
logs:
  id              INT AUTO_INCREMENT PK
  job_id          INT NOT NULL FK(scraping_jobs.id) ON DELETE CASCADE
  level           ENUM('info','warn','error','debug') DEFAULT 'info'
  message         VARCHAR(1000)
  context         JSON NULL               -- extra data
  created_at      DATETIME DEFAULT NOW()
  INDEX idx_job_level (job_id, level)
  INDEX idx_created (created_at)

-- Export tracking
exports:
  id              INT AUTO_INCREMENT PK
  job_id          INT NULL FK(scraping_jobs.id) ON DELETE SET NULL
  format          ENUM('csv','excel','json')
  filename        VARCHAR(255)
  filepath        VARCHAR(500)
  filters         JSON NULL               -- what filters were applied
  record_count    INT DEFAULT 0
  file_size       INT DEFAULT 0           -- bytes
  created_at      DATETIME DEFAULT NOW()
  INDEX idx_job (job_id)

-- Price history for change tracking
price_history:
  id              INT AUTO_INCREMENT PK
  product_id      INT NOT NULL FK(products.id) ON DELETE CASCADE
  old_price       DECIMAL(12,2)
  new_price       DECIMAL(12,2)
  detected_at     DATETIME DEFAULT NOW()
  INDEX idx_product (product_id)
```

### Indexing Strategy
- Status + created_at for job listing queries
- Domain index for domain-based filtering
- Fingerprint for O(1) duplicate detection
- Job ID on all child tables for fast joins
- Name prefix index for product search

---

## 5. Realtime System

### Technology: Socket.IO

- Server creates a **room per job**: `job:{jobId}`
- Client joins room when viewing job details
- Worker emits events through a shared Redis adapter (pub/sub)

### Events

| Event | Payload | Trigger |
|-------|---------|---------|
| `job:status` | `{jobId, status, siteType}` | Status change |
| `job:progress` | `{jobId, progress, currentUrl, stats}` | Each page scraped |
| `job:product` | `{jobId, product}` | Product extracted |
| `job:log` | `{jobId, level, message}` | Log entry created |
| `job:completed` | `{jobId, stats}` | Job finished |
| `job:error` | `{jobId, error}` | Fatal error |

### Flow
1. Dashboard opens → connects to Socket.IO
2. User navigates to Job Details → client emits `join:job {jobId}`
3. Server adds client to room `job:{jobId}`
4. Worker processing job emits events to same room via Redis pub/sub
5. Client receives events → updates UI reactively

---

## 6. Dashboard UX Flow

### Page 1: Dashboard Home / Jobs List
- Header with app name + "New Job" button
- Stats cards: Total Jobs, Running, Completed, Products Scraped
- Jobs table: URL, Site Type, Status (badge), Progress bar, Products count, Created, Actions
- Filter by status, search by URL/domain
- Click row → Job Details

### Page 2: Create Job
- URL input (validated)
- Advanced options (collapsible):
  - Max depth (1-5, default 3)
  - Max pages (10-500, default 200)
  - Delay between requests (0.5-5s, default 1s)
  - Schedule (optional cron picker)
- "Start Scraping" button
- On submit → redirects to Job Details

### Page 3: Job Details
**Header Section:**
- URL, site type badge, status badge, strategy badge
- Progress bar (animated, real-time)
- Stats: Pages crawled, Products found, Errors, Duration
- Action buttons: Cancel, Re-run, Export dropdown

**Tabs:**
1. **Products** — Live-updating table (name, price, image thumbnail, source link)
   - Search + filter by price range
   - Pagination
2. **Pages** — List of crawled URLs with status codes and product scores
3. **Logs** — Scrollable log viewer with level filtering (info/warn/error)
   - Auto-scroll to bottom, pause on hover
4. **Export** — Export options with format selector and filter controls

### UX Principles
- No page reload needed during scraping (WebSocket updates)
- Responsive layout (works on tablet+)
- Color-coded status badges
- Toast notifications for job completion/failure

---

## 7. Export System

### Formats
- **CSV**: Standard comma-separated, UTF-8 BOM for Excel compatibility
- **Excel**: .xlsx via `exceljs` library, formatted headers, auto-width columns
- **JSON**: Pretty-printed array of product objects

### Export Flow
1. User clicks Export on job details or jobs list
2. Selects format + optional filters (price range, has images, etc.)
3. Server generates file → stores in `/exports/` directory
4. Returns download URL
5. Export record saved to `exports` table

### File Storage
- Local filesystem: `/exports/{jobId}/{timestamp}_{format}.{ext}`
- Auto-cleanup: files older than 7 days deleted via cron
- File size tracked for monitoring

---

## 8. Scaling Strategy

### Queue System (BullMQ)
- Dedicated queue: `scraping-jobs`
- Concurrency: 3 workers (configurable)
- Each worker handles one job at a time
- Job priority support (manual jobs > scheduled)

### Rate Limiting
- Per-domain rate limiting: max N requests/second
- Global concurrent job limit
- Configurable delay between requests per job
- Exponential backoff on 429/503 responses

### Performance Optimizations
- Batch database inserts (every 10 products or 5 seconds)
- Connection pooling for MySQL (pool size: 10)
- Redis for queue + pub/sub (not polling)
- Stream large exports (don't buffer full file in memory)

---

## 9. Error Handling & Edge Cases

| Scenario | Handling |
|----------|----------|
| Anti-bot (403/Cloudflare) | Detect block → switch to headless with stealth plugin → log warning |
| CAPTCHA | Detect CAPTCHA page → pause job → notify user → mark as `needs_intervention` |
| Broken HTML | Cheerio handles malformed HTML gracefully; use `htmlparser2` adapter |
| Duplicate products | SHA256 fingerprint (domain + name + price) → UPSERT with unique constraint |
| Network timeout | 3 retries with exponential backoff (2s, 4s, 8s) |
| Site goes down mid-scrape | Save progress → mark job `failed` with resume capability |
| Empty/no products found | Complete job normally → show "0 products found" message |
| Redirect chains | Follow up to 5 redirects, update final URL |
| Robots.txt disallow | Respect by default, configurable override |

---

## 10. Implementation Roadmap

### Phase 1: MVP (Current Build)
- [x] Project setup + database schema
- [x] Site type detection engine
- [x] API-based scrapers (Shopify + WooCommerce)
- [x] DOM-based generic scraper
- [x] Job queue with BullMQ
- [x] REST API for jobs + products
- [x] Socket.IO real-time updates
- [x] Dashboard (create job, list, details, products, logs)
- [x] CSV/JSON/Excel export

### Phase 2: Intermediate
- [ ] Headless browser fallback (Puppeteer)
- [ ] Scheduled/recurring jobs
- [ ] Price change tracking
- [ ] Domain-based scraping profiles
- [ ] Bulk job creation

### Phase 3: Advanced
- [ ] User authentication + multi-tenancy
- [ ] Proxy rotation pool
- [ ] ML-based product detection
- [ ] Webhook notifications
- [ ] REST API for external integration
- [ ] Docker deployment
