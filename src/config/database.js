const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'srv1781.hstgr.io',
  user: process.env.DB_USER || 'u883675686_tstdev44',
  password: process.env.DB_PASS || 'tstdev44',
  database: process.env.DB_NAME || 'u883675686_tstdev44',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool; 