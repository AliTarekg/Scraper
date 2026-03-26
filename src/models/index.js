const ScrapingJob = require('./ScrapingJob');
const Product = require('./Product');
const Page = require('./Page');
const Log = require('./Log');
const Export = require('./Export');
const PriceHistory = require('./PriceHistory');

// Relationships
ScrapingJob.hasMany(Product, { foreignKey: 'job_id', as: 'products', onDelete: 'CASCADE' });
Product.belongsTo(ScrapingJob, { foreignKey: 'job_id', as: 'job' });

ScrapingJob.hasMany(Page, { foreignKey: 'job_id', as: 'pages', onDelete: 'CASCADE' });
Page.belongsTo(ScrapingJob, { foreignKey: 'job_id', as: 'job' });

ScrapingJob.hasMany(Log, { foreignKey: 'job_id', as: 'logs', onDelete: 'CASCADE' });
Log.belongsTo(ScrapingJob, { foreignKey: 'job_id', as: 'job' });

ScrapingJob.hasMany(Export, { foreignKey: 'job_id', as: 'exports', onDelete: 'SET NULL' });
Export.belongsTo(ScrapingJob, { foreignKey: 'job_id', as: 'job' });

Product.hasMany(PriceHistory, { foreignKey: 'product_id', as: 'priceHistory', onDelete: 'CASCADE' });
PriceHistory.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

ScrapingJob.belongsTo(ScrapingJob, { foreignKey: 'parent_job_id', as: 'parentJob' });
ScrapingJob.hasMany(ScrapingJob, { foreignKey: 'parent_job_id', as: 'childJobs' });

module.exports = {
  ScrapingJob,
  Product,
  Page,
  Log,
  Export,
  PriceHistory,
};
