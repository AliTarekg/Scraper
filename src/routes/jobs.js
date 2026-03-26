const express = require('express');
const router = express.Router();
const jobService = require('../services/JobService');
const jobProcessor = require('../workers/JobProcessor');

// GET /api/jobs — List jobs
router.get('/', async (req, res) => {
  try {
    const { status, search, page, limit } = req.query;
    const result = await jobService.getJobs({
      status,
      search,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/stats — Dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await jobService.getDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs — Create new scraping job
router.post('/', async (req, res) => {
  try {
    const { url, maxDepth, maxPages, delayMs } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL
    try { new URL(url); } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const job = await jobService.createJob({
      url,
      config: {
        maxDepth: Math.min(parseInt(maxDepth) || 3, 5),
        maxPages: Math.min(parseInt(maxPages) || 200, 500),
        delayMs: Math.max(parseInt(delayMs) || 1000, 500),
      },
    });

    // Process in background
    jobProcessor.enqueue(job.id);

    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id — Job details
router.get('/:id', async (req, res) => {
  try {
    const job = await jobService.getJobDetails(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/:id/cancel — Cancel job
router.post('/:id/cancel', async (req, res) => {
  try {
    const job = await jobService.cancelJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    jobProcessor.cancel(parseInt(req.params.id));
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/jobs/:id — Delete job
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await jobService.deleteJob(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Job not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/:id/rerun — Re-run a job
router.post('/:id/rerun', async (req, res) => {
  try {
    const original = await jobService.getJobById(req.params.id);
    if (!original) return res.status(404).json({ error: 'Job not found' });

    const newJob = await jobService.createJob({
      url: original.url,
      config: original.config,
    });

    jobProcessor.enqueue(newJob.id);

    res.status(201).json(newJob);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id/products — Job products
router.get('/:id/products', async (req, res) => {
  try {
    const { search, minPrice, maxPrice, page, limit } = req.query;
    const result = await jobService.getJobProducts(req.params.id, {
      search, minPrice, maxPrice,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id/pages — Job pages
router.get('/:id/pages', async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await jobService.getJobPages(req.params.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id/logs — Job logs
router.get('/:id/logs', async (req, res) => {
  try {
    const { level, page, limit } = req.query;
    const result = await jobService.getJobLogs(req.params.id, {
      level,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 100,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
