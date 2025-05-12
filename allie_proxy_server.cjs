// ---------------------- Imports & Setup ----------------------
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------- ENV Config ----------------------
const resendAPIKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.FROM_EMAIL;
const toEmail = process.env.SEND_TO_EMAIL;
const errorTimestamps = []; // Track repeated input format issues

// ---------------------- Error Reporter ----------------------
async function sendErrorEmail(error, location, details) {
  const message = JSON.stringify(error, null, 2);
  console.log('Sending email with Resend...');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendAPIKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail,
        subject: 'Allie Chat Proxy Error Alert',
        html: `<p><strong>Location:</strong> ${location}</p><p><strong>Details:</strong> ${details}</p><pre>${message}</pre>`
      })
    });

    const responseBody = await response.json();
    console.log('Resend response body:', responseBody);
  } catch (err) {
    console.error('Failed to send error email:', err.message);
  }
}

// ---------------------- /report-error Endpoint ----------------------
app.post('/report-error', async (req, res) => {
  try {
    const { error } = req.body;
    await sendErrorEmail(error, 'manual report', 'Triggered by /report-error endpoint');
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Final error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------------- /chat Endpoint ----------------------
app.post('/chat', async (req, res) => {
  console.log('POST /chat hit!', req.body);
  const messages = req.body.messages;

  // Input Validation
  if (!Array.isArray(messages)) {
    errorTimestamps.push(Date.now());
    const recent = errorTimestamps.filter(t => Date.now() - t < 10 * 60 * 1000);

    if (recent.length > 5) {
      await sendErrorEmail({ message: 'More than 5 input errors in 10 minutes.' }, '/chat route', 'Too many input format issues');
      errorTimestamps.length = 0;
    }

    return res.status(400).json({ error: 'Invalid input. Expecting "messages" array.' });
  }

  // Model Fallback Logic
  async function fetchFromModel(modelName) {
    return await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: modelName, messages })
    });
  }

  try {
    const primaryModel = 'nothingisreal/nm-celeste-12b';
    const fallbackModel = 'gryphe/mythomax-12-13b';

    let response = await fetchFromModel(primaryModel);
    if (!response.ok) {
      console.log('Primary model failed, switching to fallback...');
      await sendErrorEmail({ message: 'Primary model failed' }, '/chat route', 'Fallback model triggered');

      response = await fetchFromModel(fallbackModel);
      if (!response.ok) {
        await sendErrorEmail({ message: 'Fallback model also failed' }, '/chat route', 'Both models failed');
        return res.status(500).json({ error: 'Both models failed' });
      }
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Final error:', err);
    await sendErrorEmail({ message: err.message, stack: err.stack }, '/chat route', 'Unhandled exception');
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---------------------- Status Endpoints ----------------------
app.get('/', (req, res) => {
  res.send('Allie Chat Proxy is running.');
});

app.get('/test-key', async (req, res) => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
