const { DataTypes } = require('sequelize');
const sequelize = require('../database/connection');

const Export = sequelize.define('Export', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  jobId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'job_id',
  },
  format: {
    type: DataTypes.ENUM('csv', 'excel', 'json'),
    allowNull: false,
  },
  filename: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  filepath: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  filters: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  recordCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'record_count',
  },
  fileSize: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'file_size',
  },
}, {
  tableName: 'exports',
  updatedAt: false,
  indexes: [
    { fields: ['job_id'] },
  ],
});

module.exports = Export;
