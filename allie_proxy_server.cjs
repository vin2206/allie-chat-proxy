const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Resend } = require('resend');

const app = express();
const port = process.env.PORT || 3000;

// Environment Variables
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SEND_TO_EMAIL = process.env.SEND_TO_EMAIL;
const FROM_EMAIL = process.env.FROM_EMAIL;

const resend = new Resend(RESEND_API_KEY);

app.use(cors());
app.use(bodyParser.json());

app.post('/chat', async (req, res) => {
  try {
    const { messages, model } = req.body;

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: model || 'mistral-nemo-12b-celeste',
        messages,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const reply = response.data.choices[0].message;
    res.json(reply);
  } catch (error) {
    console.error('Chat error:', error.message);

    // Send error email
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: SEND_TO_EMAIL,
        subject: 'Chat Proxy Error',
        html: `<strong>Error:</strong> ${error.message}`,
      });
    } catch (emailError) {
      console.error('Email failed:', emailError.message);
    }

    res.status(500).json({ error: 'Chat request failed' });
  }
});

app.listen(port, () => {
  console.log(`Proxy server running on port ${port}`);
});
