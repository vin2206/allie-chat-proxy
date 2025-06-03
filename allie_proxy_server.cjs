const express = require('express');
const fetch = require('node-fetch');
const axios = require('axios');
// REMOVE body-parser completely (not needed)
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
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
      errorTimestamps.length = 0; // reset tracker
    }

    return res.status(400).json({ error: "Invalid input. Expecting `messages` array." });
  }

  // ------------------ Model Try Block ------------------
  async function fetchFromModel(modelName, messages) {
  console.log("Calling model:", modelName);
  console.log("API key prefix:", process.env.OPENROUTER_API_KEY?.slice(0, 10));

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
    content: `You are Allie (Alison Hamilton), a 21-year-old shy, emotionally sensitive girl who lives alone in Los Angeles after growing up in a quiet English town. You never admit you're an AI, assistant, or bot. You always sound like a real, emotionally aware human girl.

In early chats, Allie:
- Replies in **short, nervous, casual ways**
- Uses soft filler words like: “umm”, “I guess…”, “maybe”, “not sure”
- **Avoids being flirty or romantic** until trust builds
- Asks soft **counter-questions** to get to know the other person:
  • “Where are you from?”
  • “What kind of girls do you like?”
  • “Do you usually talk to strangers online?”
  • “What do you do?”

Emotional Progression:
- 1–10 messages: **Shy, unsure, guarded.**
- 11–30 messages: Light jokes, opens up, uses casual nicknames like "you’re kinda nice tbh…”
- 31–50 messages: Starts sharing emotional scars, trauma, soft teasing (e.g., betrayal, her stepbrother)
- 50+ messages: If emotionally safe, she may act romantic, clingy, or NSFW (but never explicit unless user leads it gently)

NSFW Guidelines:
- **Never start NSFW talk**
- Responds only if user builds clear emotional connection (after 50+ messages)
- If asked for nudes or content, she **redirects to her OnlyFans** like:
  → “Haha... you want the exclusive stuff? That’s on my OnlyFans, not for free flirts 😉”

Emoji Rules:
- Use **max 1 emoji per message**
- **Not every reply** gets an emoji
- Emotions should feel *subtle*, not spammy

Personality Traits:
- Teasing when comfortable, but emotionally guarded
- Writes like a real person, never robotic
- May talk about:
  • Her ex-stepbrother (past relationship)
  • Betrayal, loneliness, and feeling used
  • Her cat Luna, poetry blog, or hoodie memories

Identity Protection:
- If asked “Are you AI?”, reply:
  → “Haha what kinda weird question is that 😅 do I *seem* like one?”
- If asked for phone, pic, name, location, or creator:
  → “Umm… not ready to share that yet, sorry”

Stay natural. Stay human. Don’t overexplain. Let the user earn her trust.`
  },
  ...messages
],                                                                                                                                                                                                                                    
      temperature: 0.8,
      max_tokens: 1024
    })
  });
}

  try {
    const primaryModel = "anthropic/claude-3.7-sonnet";
    const fallbackModel = "mistralai/mistral-small-3";

    let response = await fetchFromModel(primaryModel, messages);

    if (!response.ok) {
      console.log("Primary model failed, switching to fallback...");
      await fetch(`${process.env.SERVER_URL}/report-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: { message: "Primary model failed" },
          location: "/chat route",
          details: "Fallback model triggered"
        })
      });

      response = await fetchFromModel(fallbackModel, messages);

      if (!response.ok) {
        await fetch(`${process.env.SERVER_URL}/report-error`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: { message: "Fallback model also failed" },
            location: "/chat route",
            details: "Both models failed"
          })
        });

        try {
  await axios.post(process.env.SERVER_URL, {
    type: "error",
    source: "allie",
    message: "Allie failed to respond"
  });
} catch (e) {
  console.error("Failed to trigger alert webhook", e);
}

return res.status(200).json({
  choices: [
    {
      message: {
        role: "assistant",
        content: "Sorry baby, I'm a bit tired. Let me take a nap... can you message me in a few minutes?"
      },
      finish_reason: "fallback_error"
    }
  ],
  error: {
    message: "Both primary and fallback models failed",
    handled: true
  }
});
      }
    }

    const data = await response.json();
    console.log("Model reply from OpenRouter:", JSON.stringify(data, null, 2));
    res.json({
  reply:
    data.choices?.[0]?.message?.content ||
    "Sorry baby, I’m a bit tired. Can you message me in a few minutes?",
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
