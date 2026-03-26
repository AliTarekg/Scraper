const { DataTypes } = require('sequelize');
const sequelize = require('../database/connection');

const Page = sequelize.define('Page', {
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
  url: {
    type: DataTypes.STRING(2048),
    allowNull: false,
  },
  statusCode: {
    type: DataTypes.SMALLINT,
    allowNull: true,
    field: 'status_code',
  },
  isProductPage: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_product_page',
  },
  productScore: {
    type: DataTypes.TINYINT,
    defaultValue: 0,
    field: 'product_score',
  },
  depth: {
    type: DataTypes.TINYINT,
    defaultValue: 0,
  },
}, {
  tableName: 'pages',
  indexes: [
    { fields: ['job_id'] },
    { fields: ['job_id', 'is_product_page'] },
  ],
});

module.exports = Page;
