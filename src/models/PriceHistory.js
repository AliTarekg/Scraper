const { DataTypes } = require('sequelize');
const sequelize = require('../database/connection');

const PriceHistory = sequelize.define('PriceHistory', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  productId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'product_id',
  },
  oldPrice: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    field: 'old_price',
  },
  newPrice: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    field: 'new_price',
  },
  detectedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'detected_at',
  },
}, {
  tableName: 'price_history',
  timestamps: false,
  indexes: [
    { fields: ['product_id'] },
  ],
});

module.exports = PriceHistory;
