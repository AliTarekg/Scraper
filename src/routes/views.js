const express = require('express');
const path = require('path');
const ejs = require('ejs');
const router = express.Router();
const jobService = require('../services/JobService');

const viewsDir = path.join(__dirname, '..', 'views');

function renderPage(res, title, templateName, data = {}) {
  // Render the inner template first
  const innerPath = path.join(viewsDir, `${templateName}.ejs`);
  ejs.renderFile(innerPath, data, (err, body) => {
    if (err) return res.status(500).send(`Template error: ${err.message}`);
    res.render('layout', { title, body });
  });
}

// Dashboard home
router.get('/', async (req, res) => {
  renderPage(res, 'Dashboard', 'dashboard');
});

// Job details page
router.get('/jobs/:id', async (req, res) => {
  const job = await jobService.getJobDetails(req.params.id);
  if (!job) return res.status(404).send('Job not found');
  renderPage(res, `Job #${job.id}`, 'job-details', { job });
});

module.exports = router;
