const { DataTypes } = require('sequelize');
const sequelize = require('../database/connection');

const Product = sequelize.define('Product', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  jobId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'job_id',
  },
  sourceUrl: {
    type: DataTypes.STRING(2048),
    allowNull: true,
    field: 'source_url',
  },
  name: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  price: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
  },
  priceCurrency: {
    type: DataTypes.STRING(10),
    allowNull: true,
    field: 'price_currency',
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  images: {
    type: DataTypes.JSON,
    defaultValue: [],
  },
  metadata: {
    type: DataTypes.JSON,
    defaultValue: {},
  },
  fingerprint: {
    type: DataTypes.STRING(64),
    allowNull: true,
  },
}, {
  tableName: 'products',
  indexes: [
    { fields: ['job_id'] },
    { fields: ['name'], length: { name: 100 } },
    { fields: ['job_id', 'fingerprint'], unique: true },
  ],
});

module.exports = Product;
