require('dotenv').config();
const Imap = require('imap-simple');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const axios = require('axios');

const config = {
  imap: {
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASS,
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT, 10),
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
  }
};

const smtpConfig = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
};

const dbConfig = {
  connectionString: process.env.DB_URL
};

async function testConnections() {
  console.log('Testing connections...');
  
  // Test IMAP
  try {
    const connection = await Imap.connect(config);
    console.log('✓ IMAP connection successful');
    await connection.end();
  } catch (error) {
    console.error('✗ IMAP connection failed:', error.message);
  }
  
  // Test SMTP
  try {
    const transporter = nodemailer.createTransport(smtpConfig);
    await transporter.verify();
    console.log('✓ SMTP connection successful');
  } catch (error) {
    console.error('✗ SMTP connection failed:', error.message);
  }
  
  // Test PostgreSQL
  try {
    const pool = new Pool(dbConfig);
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    console.log('✓ PostgreSQL connection successful');
    client.release();
    await pool.end();
  } catch (error) {
    console.error('✗ PostgreSQL connection failed:', error.message);
  }
  
  // Test Ollama
  try {
    const response = await axios.get(`${process.env.OLLAMA_BASE_URL}/api/tags`);
    console.log('✓ Ollama connection successful');
  } catch (error) {
    console.error('✗ Ollama connection failed:', error.message);
  }
}

async function startService() {
  console.log('Starting ecom-mailer service...');
  
  await testConnections();
  
  // Heartbeat every 60 seconds
  setInterval(() => {
    console.log('Service running: ecom-mailer');
  }, 60000);
}

startService().catch(console.error);
