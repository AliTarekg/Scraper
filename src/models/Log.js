const { DataTypes } = require('sequelize');
const sequelize = require('../database/connection');

const Log = sequelize.define('Log', {
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
  level: {
    type: DataTypes.ENUM('info', 'warn', 'error', 'debug'),
    defaultValue: 'info',
  },
  message: {
    type: DataTypes.STRING(1000),
    allowNull: false,
  },
  context: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'logs',
  updatedAt: false,
  indexes: [
    { fields: ['job_id', 'level'] },
    { fields: ['created_at'] },
  ],
});

module.exports = Log;
