const { ScrapingJob, Product, Page, Log } = require('../models');
const ScraperEngine = require('../scraper/ScraperEngine');
const { emitToJob, emitGlobal } = require('../realtime/socketio');
const config = require('../config');

/**
 * In-memory job processor — replaces BullMQ/Redis.
 * Runs scraping jobs in the background using async functions.
 * Limits concurrency via a simple semaphore.
 */
class JobProcessor {
  constructor() {
    this.running = 0;
    this.maxConcurrency = config.scraper.concurrency;
    this.queue = []; // pending job IDs
    this.activeEngines = new Map(); // jobId -> engine (for cancellation)
  }

  /**
   * Enqueue a job for processing.
   */
  enqueue(jobId) {
    this.queue.push(jobId);
    this._processNext();
  }

  /**
   * Cancel a running job's scraper engine.
   */
  cancel(jobId) {
    const engine = this.activeEngines.get(jobId);
    if (engine) engine.abort();
    // Also remove from pending queue
    this.queue = this.queue.filter(id => id !== jobId);
  }

  _processNext() {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const jobId = this.queue.shift();
      this.running++;
      this._runJob(jobId).finally(() => {
        this.running--;
        this.activeEngines.delete(jobId);
        this._processNext();
      });
    }
  }

  async _runJob(jobId) {
    console.log(`[Worker] Processing job ${jobId}`);

    const job = await ScrapingJob.findByPk(jobId);
    if (!job) {
      console.error(`[Worker] Job ${jobId} not found`);
      return;
    }
    if (job.status === 'cancelled') return;

    const engine = new ScraperEngine(job.toJSON());
    this.activeEngines.set(jobId, engine);

    // Wire up real-time events
    engine.on('status', async ({ status }) => {
      await job.update({ status });
      emitToJob(jobId, 'job:status', { jobId, status });
      emitGlobal('jobs:updated', { jobId, status });
    });

    engine.on('detected', async ({ siteType }) => {
      await job.update({ siteType });
      emitToJob(jobId, 'job:detected', { jobId, siteType });
    });

    engine.on('progress', async ({ progress, currentUrl, stats }) => {
      await job.update({ progress, stats });
      emitToJob(jobId, 'job:progress', { jobId, progress, currentUrl, stats });
      emitGlobal('jobs:updated', { jobId, progress });
    });

    engine.on('product', async ({ product }) => {
      try {
        await Product.upsert({
          jobId,
          ...product,
        }, {
          conflictFields: ['job_id', 'fingerprint'],
        });
        emitToJob(jobId, 'job:product', { jobId, product });
      } catch (err) {
        if (!err.message?.includes('Duplicate')) {
          console.error(`[Worker] Product save error: ${err.message}`);
        }
      }
    });

    // When a product is enriched with description/images after initial save
    engine.on('product:enriched', async ({ product }) => {
      try {
        await Product.update(
          { description: product.description, images: product.images },
          { where: { jobId, fingerprint: product.fingerprint } }
        );
      } catch (err) {
        console.error(`[Worker] Product enrich error: ${err.message}`);
      }
    });

    engine.on('page', async ({ url, statusCode, score, depth }) => {
      try {
        await Page.create({
          jobId,
          url,
          statusCode,
          isProductPage: score >= 40,
          productScore: score,
          depth,
        });
      } catch {
        // Non-critical
      }
    });

    engine.on('log', async ({ level, message, context }) => {
      try {
        await Log.create({ jobId, level, message: message?.substring(0, 1000), context });
        emitToJob(jobId, 'job:log', { jobId, level, message, timestamp: new Date() });
      } catch {
        // Non-critical
      }
    });

    try {
      await job.update({ startedAt: new Date(), status: 'detecting' });

      const result = await engine.run();

      await job.update({
        status: 'completed',
        siteType: result.siteType,
        strategyUsed: result.strategyUsed,
        stats: result.stats,
        progress: 100,
        completedAt: new Date(),
      });

      emitToJob(jobId, 'job:completed', { jobId, stats: result.stats });
      emitGlobal('jobs:updated', { jobId, status: 'completed' });

      console.log(`[Worker] Job ${jobId} completed. ${result.products.length} products found.`);
    } catch (err) {
      await job.update({
        status: 'failed',
        errorMessage: err.message,
        completedAt: new Date(),
      });

      emitToJob(jobId, 'job:error', { jobId, error: err.message });
      emitGlobal('jobs:updated', { jobId, status: 'failed' });

      console.error(`[Worker] Job ${jobId} failed: ${err.message}`);
    }
  }
}

// Singleton
const jobProcessor = new JobProcessor();

module.exports = jobProcessor;
