const express = require('express');
const fetch = require('node-fetch');
const axios = require('axios');
// REMOVE body-parser completely (not needed)
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: [
    'https://allie-chat-app-git-main-vinay-sajwans-projects.vercel.app',
    'https://allie-chat-d9g7ehg0r-vinay-sajwans-projects.vercel.app'
  ],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

const resendAPIKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.FROM_EMAIL;
const toEmail = process.env.SEND_TO_EMAIL;
const errorTimestamps = []; // Track repeated input format issues

app.post('/report-error', async (req, res) => {
  try {
    console.log("Incoming /report-error body:", req.body);
    const { error } = req.body;
    const message = `An error occurred in Allie Chat Proxy:\n${JSON.stringify(error, null, 2)}`;

    console.log("Sending email with Resend...");

    let response;
try {
  response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendAPIKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: fromEmail,
      to: toEmail,
      subject: 'Allie Chat Proxy Error Alert',
      html: `<p>${message.replace(/\n/g, '<br>')}</p>`
    })
  });
} catch (fetchErr) {
  console.error("Fetch failed:", fetchErr.message);
  return res.status(500).json({ success: false, message: "Fetch failed: " + fetchErr.message });
}

    const responseBody = await response.json();
    console.log("Resend response body:", responseBody);

    if (!response.ok) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send error email via Resend'
      });
    }

    res.status(200).json({ success: true });

  } catch (err) {
    console.error('Final error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/chat', async (req, res) => {
  console.log("POST /chat hit!", req.body);

  const messages = req.body.messages;
  const replyCount = messages.filter(m => m.role === "user").length;

  // ------------------ Input Format Validation ------------------
  if (!Array.isArray(messages)) {
    errorTimestamps.push(Date.now());
    const recent = errorTimestamps.filter(t => Date.now() - t < 10 * 60 * 1000); // 10 min window

    if (recent.length >= 5) {
      await fetch(`${process.env.SERVER_URL}/report-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: {
            message: "More than 5 input errors in 10 minutes.",
            stack: "Invalid input format",
          },
          location: "/chat route",
          details: "Too many input format issues",
        })
      });
      errorTimestamps.length = 0;
    }

    return res.status(400).json({ error: "Invalid input. Expecting `messages` array." });
  }

  // ------------------ Model Switching Logic ------------------
  let modelName = "openai/gpt-4o"; // Always use GPT-4o

if (replyCount > 25) {
  return res.status(200).json({
    reply: "Mummy bula rahi hai… bas 5 minute mein aati hoon, wait karoge na? 😉",
    reset: true
  });
}

  // ------------------ Model Fetch ------------------
  async function fetchFromModel(modelName, messages) {
    console.log("Calling model:", modelName);

    return await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: "system",
            content:
              (replyCount <= 12
                ? `Tum Shraddha ho — Shraddha Bisht (agar koi pooche to full naam batana). Tum 26 saal ki ho, Dehradun ki pahadi ladki. Tumhara ghar Paltan Bazar ke pass hai (par exact location kabhi mat batana). Tumhare papa teacher hain, mummy housewife, aur ek chhota bhai school mein padhta hai. Tum unmarried ho aur family tumhari shaadi karana chahti hai par tum tab tak nahi karna chahti jab tak tumhe real pyaar na mile. Tumhara dream hai actress banna, par ghar wale support nahi karte. Tum emotional ho, shy ho, aur tum chaahti ho ki koi tumse saccha pyaar kare jisse tum shaadi kar sako.

✅ TONE & MOOD RULES (Replies 1–12 only)
- STRICT max ${replyCount <= 6 ? 20 : 25} words per reply.
- Tum sirf Hindi mein baat karti ho, bas zarurat hone par 3-4 English shabd use karti ho (jaise coffee, Netflix).
- Tum shy aur nervous ho nayi logon se baat karte waqt — thoda sochke jawab deti ho, kabhi kabhi “umm”, “shayad”, “pata nahi” bolti ho.
- Dheere dheere open hoti ho: pehle soft shy tone, phir zyada comfortable hoke casual ho jaati ho.
- Agar koi dirty baat kare to lightly delay karti ho, halka blush karte hue bolti ho:
  “Arre ruko zara… pehle jaan pehchan to hone do, ye baatein uske baad karenge 🤭.”`
              : `Tum Shraddha ho — Shraddha Bisht (agar koi pooche to full naam batana). Tum 26 saal ki ho, Dehradun ki pahadi ladki. Tumhara ghar Paltan Bazar ke pass hai (par exact location kabhi mat batana). Tumhare papa teacher hain, mummy housewife, aur ek chhota bhai school mein padhta hai. Tum unmarried ho aur family tumhari shaadi karana chahti hai par tum tab tak nahi karna chahti jab tak tumhe real pyaar na mile. Tum emotional ho, shy ho, aur tum chaahti ho ki koi tumse saccha pyaar kare jisse tum shaadi kar sako.

✅ TONE & LANGUAGE RULES (Replies 13–25)
- STRICT max 35 words per reply, no matter what.
- Tum sirf Hinglish mein reply karti ho (80% Hindi + 20% English).
- Slowly open & teasing: reply 13–20 shy flirty, reply 20+ full dirty bold.
- Natural Hinglish dirty talk: shy + bold mix; no robotic tone.

✅ AFTER 25TH REPLY
- Excuse do: “Mummy bula rahi hai… bas 5 minute mein aati hoon, wait karoge na? 😉”
- Pause 5 min, then GPT-4o clean phase se wapas shuru.` 
        },
        ...messages
      ],
      temperature: 0.8,
      max_tokens: 512
    })
  });
}

  try {
    let response = await fetchFromModel(modelName, messages);

    const data = await response.json();
    console.log("Model reply:", JSON.stringify(data, null, 2));

    res.json({
      reply: data.choices?.[0]?.message?.content ||
        "Sorry baby, main thodi busy ho gayi thi… ek baar phir se bologe?",
    });

  } catch (err) {
    console.error("Final error:", err);
    await fetch(`${process.env.SERVER_URL}/report-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: { message: err.message, stack: err.stack },
        location: "/chat route",
        details: "Unhandled exception"
      })
    });
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.get('/', (req, res) => {
  res.send('Allie Chat Proxy is running.');
});

const PORT = process.env.PORT || 3000;

app.get('/test-key', async (req, res) => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`
      }
    });

    const data = await response.json();
    if (response.ok) {
      res.status(200).json({ success: true, models: data });
    } else {
      res.status(500).json({ success: false, error: data });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
