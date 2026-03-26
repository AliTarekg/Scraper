const EventEmitter = require('events');
const SiteDetector = require('./SiteDetector');
const ShopifyApiScraper = require('./strategies/ShopifyApiScraper');
const WooCommerceApiScraper = require('./strategies/WooCommerceApiScraper');
const DomScraper = require('./strategies/DomScraper');

/**
 * ScraperEngine orchestrates the full scraping pipeline:
 * 1. Detect site type
 * 2. Pick strategy (API → DOM → Headless)
 * 3. Execute scrape
 * 4. Emit events for real-time tracking
 */
class ScraperEngine extends EventEmitter {
  constructor(job) {
    super();
    this.job = job;
    this.activeScraper = null;
  }

  async run() {
    try {
      // Phase 1: Detection
      this.emit('status', { jobId: this.job.id, status: 'detecting' });
      this.emit('log', { jobId: this.job.id, level: 'info', message: `Detecting site type for ${this.job.url}` });

      const detector = new SiteDetector(this.job.url);
      const detection = await detector.detect();

      this.emit('log', {
        jobId: this.job.id,
        level: 'info',
        message: `Detected: ${detection.siteType} (confidence: ${detection.confidence}%). Signals: ${detection.signals.join(', ')}`,
      });
      this.emit('detected', { jobId: this.job.id, siteType: detection.siteType, detection });

      // Phase 2: Strategy selection + execution with fallback
      this.emit('status', { jobId: this.job.id, status: 'scraping' });

      const strategies = this._buildStrategyChain(detection.siteType);
      let products = [];
      let strategyUsed = null;

      for (const { name, create } of strategies) {
        this.emit('log', { jobId: this.job.id, level: 'info', message: `Trying strategy: ${name}` });
        try {
          this.activeScraper = create();
          products = await this.activeScraper.scrape();
          strategyUsed = name;

          if (products.length > 0) {
            this.emit('log', { jobId: this.job.id, level: 'info', message: `Strategy ${name} succeeded with ${products.length} products` });
            break;
          } else {
            this.emit('log', { jobId: this.job.id, level: 'warn', message: `Strategy ${name} returned 0 products, trying next...` });
          }
        } catch (err) {
          this.emit('log', { jobId: this.job.id, level: 'error', message: `Strategy ${name} failed: ${err.message}` });
        }
      }

      return {
        siteType: detection.siteType,
        strategyUsed,
        products,
        stats: this.activeScraper?.stats || { pagesCrawled: 0, productsFound: 0, errors: 0 },
      };
    } catch (err) {
      this.emit('log', { jobId: this.job.id, level: 'error', message: `Engine error: ${err.message}` });
      throw err;
    }
  }

  abort() {
    if (this.activeScraper) {
      this.activeScraper.abort();
    }
  }

  _buildStrategyChain(siteType) {
    const strategies = [];
    const job = this.job;
    const emitter = this;

    switch (siteType) {
      case 'shopify':
        strategies.push(
          { name: 'api', create: () => new ShopifyApiScraper(job, emitter) },
          { name: 'dom', create: () => new DomScraper(job, emitter) },
        );
        break;
      case 'woocommerce':
        strategies.push(
          { name: 'api', create: () => new WooCommerceApiScraper(job, emitter) },
          { name: 'dom', create: () => new DomScraper(job, emitter) },
        );
        break;
      case 'wordpress':
      case 'generic':
      default:
        strategies.push(
          { name: 'dom', create: () => new DomScraper(job, emitter) },
        );
        break;
    }

    return strategies;
  }
}

module.exports = ScraperEngine;
