const { Op } = require('sequelize');
const { ScrapingJob, Product, Page, Log } = require('../models');

class JobService {
  async createJob({ url, config = {} }) {
    const domain = new URL(url).hostname;
    const defaultConfig = {
      maxDepth: config.maxDepth || 3,
      maxPages: config.maxPages || 200,
      delayMs: config.delayMs || 1000,
      timeoutMs: config.timeoutMs || 30000,
    };

    return ScrapingJob.create({
      url,
      domain,
      config: defaultConfig,
      status: 'pending',
      stats: { pagesCrawled: 0, productsFound: 0, errors: 0 },
      progress: 0,
    });
  }

  async getJobs({ status, search, page = 1, limit = 20 }) {
    const where = {};
    if (status && status !== 'all') where.status = status;
    if (search) {
      where[Op.or] = [
        { url: { [Op.like]: `%${search}%` } },
        { domain: { [Op.like]: `%${search}%` } },
      ];
    }

    const offset = (page - 1) * limit;
    const { rows, count } = await ScrapingJob.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    return {
      jobs: rows,
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
    };
  }

  async getJobById(id) {
    return ScrapingJob.findByPk(id);
  }

  async getJobDetails(id) {
    const job = await ScrapingJob.findByPk(id);
    if (!job) return null;

    const [productCount, pageCount, errorCount] = await Promise.all([
      Product.count({ where: { jobId: id } }),
      Page.count({ where: { jobId: id } }),
      Log.count({ where: { jobId: id, level: 'error' } }),
    ]);

    return {
      ...job.toJSON(),
      productCount,
      pageCount,
      errorCount,
    };
  }

  async updateJob(id, data) {
    const job = await ScrapingJob.findByPk(id);
    if (!job) return null;
    await job.update(data);
    return job;
  }

  async cancelJob(id) {
    const job = await ScrapingJob.findByPk(id);
    if (!job) return null;
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      return job;
    }
    await job.update({ status: 'cancelled' });
    return job;
  }

  async deleteJob(id) {
    const job = await ScrapingJob.findByPk(id);
    if (!job) return false;
    await job.destroy(); // cascades to products, pages, logs
    return true;
  }

  async getJobProducts(jobId, { search, minPrice, maxPrice, page = 1, limit = 50 }) {
    const where = { jobId };
    if (search) {
      where.name = { [Op.like]: `%${search}%` };
    }
    if (minPrice) where.price = { ...where.price, [Op.gte]: parseFloat(minPrice) };
    if (maxPrice) where.price = { ...where.price, [Op.lte]: parseFloat(maxPrice) };

    const offset = (page - 1) * limit;
    const { rows, count } = await Product.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    return { products: rows, total: count, page, totalPages: Math.ceil(count / limit) };
  }

  async getJobPages(jobId, { page = 1, limit = 50 }) {
    const offset = (page - 1) * limit;
    const { rows, count } = await Page.findAndCountAll({
      where: { jobId },
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });
    return { pages: rows, total: count, page, totalPages: Math.ceil(count / limit) };
  }

  async getJobLogs(jobId, { level, page = 1, limit = 100 }) {
    const where = { jobId };
    if (level && level !== 'all') where.level = level;

    const offset = (page - 1) * limit;
    const { rows, count } = await Log.findAndCountAll({
      where,
      order: [['created_at', 'ASC']],
      limit,
      offset,
    });
    return { logs: rows, total: count, page, totalPages: Math.ceil(count / limit) };
  }

  async getDashboardStats() {
    const [total, pending, running, completed, failed, totalProducts] = await Promise.all([
      ScrapingJob.count(),
      ScrapingJob.count({ where: { status: 'pending' } }),
      ScrapingJob.count({ where: { status: ['detecting', 'scraping'] } }),
      ScrapingJob.count({ where: { status: 'completed' } }),
      ScrapingJob.count({ where: { status: 'failed' } }),
      Product.count(),
    ]);

    return { total, pending, running, completed, failed, totalProducts };
  }
}

module.exports = new JobService();
