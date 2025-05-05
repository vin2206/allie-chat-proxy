// Fully corrected `allie_proxy_server.cjs` file for CommonJS environment (Railway compatible)

const express = require('express');
const fetch = require('node-fetch');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const resend = new Resend(process.env.RESEND_API_KEY);

// Error notification function
async function sendErrorEmail(error) {
  try {
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: process.env.SEND_TO_EMAIL,
      subject: 'Allie Proxy Server Error',
      html: `<strong>Proxy Error:</strong><br><pre>${error.stack || error}</pre>`
    });
  } catch (emailErr) {
    console.error('Error sending error email:', emailErr);
  }
}

// Proxy endpoint
app.use(express.json());
app.post('/chat', async (req, res) => {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://yourdomain.com/',
        'X-Title': 'Allie Chat'
      },
      body: JSON.stringify({
        model: 'mistral-nemo-12b-instruct:free',
        messages: req.body.messages
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Proxy failed:', err);
    await sendErrorEmail(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('Allie Proxy Server Running.');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
