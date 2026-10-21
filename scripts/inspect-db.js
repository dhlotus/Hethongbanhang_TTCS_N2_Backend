require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();

  const rows = await client.query(`SELECT * FROM users WHERE username IN ('dealer', 'daily') OR email LIKE '%bahung%'`);
  console.log('Customer users in DB:');
  console.table(rows.rows);

  await client.end();
}

main().catch(console.error);
