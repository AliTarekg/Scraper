const express = require('express');
const path = require('path');
const router = express.Router();
const exportService = require('../services/ExportService');

// POST /api/exports/:jobId — Generate export
router.post('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { format, search, minPrice, maxPrice } = req.body;

    if (!format || !['csv', 'excel', 'json'].includes(format)) {
      return res.status(400).json({ error: 'Format must be csv, excel, or json' });
    }

    const exportRecord = await exportService.exportProducts(jobId, format, {
      search, minPrice, maxPrice,
    });

    res.status(201).json(exportRecord);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/exports/:jobId — List exports for a job
router.get('/:jobId', async (req, res) => {
  try {
    const exports = await exportService.getExportsByJob(req.params.jobId);
    res.json(exports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/exports/download/:exportId — Download export file
router.get('/download/:exportId', async (req, res) => {
  try {
    const { Export: ExportModel } = require('../models');
    const exportRecord = await ExportModel.findByPk(req.params.exportId);
    if (!exportRecord) return res.status(404).json({ error: 'Export not found' });

    const filePath = exportService.getFilePath(exportRecord.filepath);
    if (!filePath) return res.status(404).json({ error: 'File not found' });

    // Ensure the resolved path is within the exports directory
    const resolvedPath = path.resolve(filePath);
    const exportsBase = path.resolve(exportService.exportDir);
    if (!resolvedPath.startsWith(exportsBase)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const contentTypes = {
      csv: 'text/csv',
      excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      json: 'application/json',
    };

    res.setHeader('Content-Type', contentTypes[exportRecord.format] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${exportRecord.filename}"`);
    res.sendFile(resolvedPath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
