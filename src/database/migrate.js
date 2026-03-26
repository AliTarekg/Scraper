const sequelize = require('./connection');
require('../models'); // Load all models + relationships

async function migrate() {
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Connected. Syncing schema...');
    await sequelize.sync({ alter: true });
    console.log('Database schema synced successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
