const path = require('path');
const fs = require('fs');
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const config = require('../config');
const { Product, Export: ExportModel } = require('../models');
const { Op } = require('sequelize');

class ExportService {
  constructor() {
    this.exportDir = path.resolve(config.export.dir);
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
    }
  }

  async exportProducts(jobId, format, filters = {}) {
    // Fetch products
    const where = { jobId };
    if (filters.search) where.name = { [Op.like]: `%${filters.search}%` };
    if (filters.minPrice) where.price = { ...where.price, [Op.gte]: parseFloat(filters.minPrice) };
    if (filters.maxPrice) where.price = { ...where.price, [Op.lte]: parseFloat(filters.maxPrice) };

    const products = await Product.findAll({ where, order: [['id', 'ASC']] });

    if (products.length === 0) {
      throw new Error('No products to export');
    }

    const rows = products.map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      regularPrice: p.metadata?.regularPrice ?? null,
      salePrice: p.metadata?.salePrice ?? null,
      currency: p.priceCurrency,
      onSale: p.metadata?.onSale ? 'Yes' : 'No',
      variants: p.metadata?.attributes
        ? p.metadata.attributes.map(a => `${a.name}: ${a.options.join(', ')}`).join(' | ')
        : '',
      sku: p.metadata?.sku || '',
      stockStatus: p.metadata?.stockStatus || '',
      description: (p.description || '').substring(0, 500),
      images: (p.images || []).join(' | '),
      sourceUrl: p.sourceUrl,
    }));

    const timestamp = Date.now();
    const jobDir = path.join(this.exportDir, String(jobId));
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }

    let filename, filepath, fileSize;

    switch (format) {
      case 'csv':
        ({ filename, filepath, fileSize } = await this._exportCsv(rows, jobDir, timestamp));
        break;
      case 'excel':
        ({ filename, filepath, fileSize } = await this._exportExcel(rows, jobDir, timestamp));
        break;
      case 'json':
        ({ filename, filepath, fileSize } = await this._exportJson(rows, jobDir, timestamp));
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    // Save export record
    const exportRecord = await ExportModel.create({
      jobId,
      format,
      filename,
      filepath,
      filters: Object.keys(filters).length ? filters : null,
      recordCount: rows.length,
      fileSize,
    });

    return exportRecord;
  }

  async _exportCsv(rows, dir, timestamp) {
    const filename = `products_${timestamp}.csv`;
    const filepath = path.join(dir, filename);

    const parser = new Parser({
      fields: ['id', 'name', 'price', 'regularPrice', 'salePrice', 'currency', 'onSale', 'variants', 'sku', 'stockStatus', 'description', 'images', 'sourceUrl'],
    });
    const csv = '\uFEFF' + parser.parse(rows); // BOM for Excel compatibility
    fs.writeFileSync(filepath, csv, 'utf8');

    return { filename, filepath, fileSize: Buffer.byteLength(csv) };
  }

  async _exportExcel(rows, dir, timestamp) {
    const filename = `products_${timestamp}.xlsx`;
    const filepath = path.join(dir, filename);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Scraper Dashboard';
    const sheet = workbook.addWorksheet('Products');

    sheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Name', key: 'name', width: 40 },
      { header: 'Price', key: 'price', width: 12 },
      { header: 'Regular Price', key: 'regularPrice', width: 14 },
      { header: 'Sale Price', key: 'salePrice', width: 12 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'On Sale', key: 'onSale', width: 10 },
      { header: 'Variants / Options', key: 'variants', width: 40 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Stock Status', key: 'stockStatus', width: 14 },
      { header: 'Description', key: 'description', width: 60 },
      { header: 'Images', key: 'images', width: 50 },
      { header: 'Source URL', key: 'sourceUrl', width: 50 },
    ];

    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    rows.forEach(row => sheet.addRow(row));

    await workbook.xlsx.writeFile(filepath);
    const stat = fs.statSync(filepath);

    return { filename, filepath, fileSize: stat.size };
  }

  async _exportJson(rows, dir, timestamp) {
    const filename = `products_${timestamp}.json`;
    const filepath = path.join(dir, filename);

    const json = JSON.stringify(rows, null, 2);
    fs.writeFileSync(filepath, json, 'utf8');

    return { filename, filepath, fileSize: Buffer.byteLength(json) };
  }

  async getExportsByJob(jobId) {
    return ExportModel.findAll({ where: { jobId }, order: [['created_at', 'DESC']] });
  }

  getFilePath(filepath) {
    if (!fs.existsSync(filepath)) return null;
    return filepath;
  }
}

module.exports = new ExportService();
