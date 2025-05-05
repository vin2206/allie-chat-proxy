const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

function sendErrorEmail(error) {
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: process.env.ADMIN_EMAIL,
    subject: 'Allie Proxy Server Error',
    text: `An error occurred:\n\n${error.stack || error.message || error}`
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) {
      console.error('Failed to send email:', err);
    } else {
      console.log('Error email sent:', info.response);
    }
  });
}

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post('/chat', async (req, res) => {
  const { messages } = req.body;

  try {
    console.log("DEBUG: API KEY =", process.env.OPENROUTER_API_KEY);
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
  model: "mistral-nemo-12b-celeste",
  messages: messages,
  max_tokens: 1000
}, {
  headers: {
    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json"
  }
});

    res.json(response.data);
  } catch (error) {
    console.error('OpenRouter error:', error);
  //  sendErrorEmail(error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.post('/report-error', async (req, res) => {
  const { error, userMessage, timestamp } = req.body;

  const mailOptions = {
    from: `"Allie Proxy Server" <${process.env.GMAIL_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: 'Error Alert from Allie Proxy Server',
    text: `Error: ${error}\nUser Message: ${userMessage || 'N/A'}\nTime: ${timestamp || new Date().toISOString()}`
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).send({ message: 'Alert sent successfully.' });
  } catch (err) {
    console.error('Mail send failed:', err);
    res.status(500).send({ error: 'Failed to send email.' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
