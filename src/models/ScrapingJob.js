const { DataTypes } = require('sequelize');
const sequelize = require('../database/connection');

const ScrapingJob = sequelize.define('ScrapingJob', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  url: {
    type: DataTypes.STRING(2048),
    allowNull: false,
  },
  domain: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  siteType: {
    type: DataTypes.ENUM('shopify', 'woocommerce', 'wordpress', 'generic'),
    allowNull: true,
    field: 'site_type',
  },
  status: {
    type: DataTypes.ENUM('pending', 'detecting', 'scraping', 'completed', 'failed', 'cancelled'),
    defaultValue: 'pending',
  },
  strategyUsed: {
    type: DataTypes.ENUM('api', 'dom', 'headless'),
    allowNull: true,
    field: 'strategy_used',
  },
  config: {
    type: DataTypes.JSON,
    defaultValue: {},
  },
  stats: {
    type: DataTypes.JSON,
    defaultValue: { pagesCrawled: 0, productsFound: 0, errors: 0 },
  },
  progress: {
    type: DataTypes.TINYINT,
    defaultValue: 0,
  },
  scheduledCron: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'scheduled_cron',
  },
  parentJobId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'parent_job_id',
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'error_message',
  },
  startedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'started_at',
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'completed_at',
  },
}, {
  tableName: 'scraping_jobs',
  indexes: [
    { fields: ['status'] },
    { fields: ['domain'] },
    { fields: ['created_at'] },
  ],
});

module.exports = ScrapingJob;
