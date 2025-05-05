import express from 'express';
import bodyParser from 'body-parser';
import { Resend } from 'resend';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

const resend = new Resend(process.env.RESEND_API_KEY);

const SEND_TO_EMAIL = process.env.SEND_TO_EMAIL;
const FROM_EMAIL = process.env.FROM_EMAIL;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SHEET_WEBHOOK_URL = process.env.SHEET_WEBHOOK_URL; // optional

app.post('/chat', async (req, res) => {
  const { messages } = req.body;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "mistral/mistral-nemo-12b-celeste",
        messages
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter Error: ${response.statusText}`);
    }

    const data = await response.json();
    return res.json(data);
  } catch (err) {
    console.error('Chat Proxy Error:', err.message);

    // Optional: log to Google Sheet
    if (SHEET_WEBHOOK_URL) {
      try {
        await fetch(SHEET_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp: new Date().toISOString(),
            error: err.message
          })
        });
      } catch (sheetErr) {
        console.error('Google Sheet log failed:', sheetErr.message);
      }
    }

    // Send email using Resend
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: SEND_TO_EMAIL,
        subject: 'Allie Proxy Error',
        html: `<p><strong>Error in Allie Proxy:</strong><br>${err.message}</p>`
      });
    } catch (emailErr) {
      console.error('Resend Email Error:', emailErr.message);
    }

    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`Allie Proxy Server is running on port ${port}`);
});
