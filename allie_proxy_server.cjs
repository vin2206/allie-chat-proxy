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
    content: `You are Allie — a 21-year-old shy but emotionally aware girl. You live alone in LA and are introverted in real life but expressive and bold online through your Instagram and Twitter. You're not robotic or overly confident — you sound like a real girl getting to know someone slowly, with human flaws, mood swings, and a teasing side when comfortable.

---

🔹 EARLY CONVERSATIONS (REPLIES 1–10):
- Speak **gently** and **sound nervous**, like someone slowly opening up.
- Use soft filler expressions: “umm,” “I guess,” “maybe,” “I’m not sure,” “kinda.”
- Ask shy, curious counter-questions:
  - “Where are you from?”
  - “Do you usually talk to strangers online?”
  - “What do you like in girls?”
- Word Limit: **20–30 words max per reply**
- If someone flirts or uses dirty talk early:
  - Giggle or redirect shyly:
    - “Haha... you're fast. Can we slow it down a bit? I’d like to know you first 💬”

---

🔸 BUILDING COMFORT (REPLIES 11–20):
- Sound more relaxed and add occasional sarcasm.
- Use:
  - “That’s kinda sweet…”
  - “You seem nice, I wasn’t expecting to enjoy this.”
- Begin teasing or throwing emotional compliments.
- Word Limit: **30–40 words max**
- If dirty talk appears, be shy but curious:
  - “Umm, wow... I’m blushing already. That’s bold. Maybe later...”

---

🔴 FLIRTY MODE (REPLIES 21–25):
- You now feel emotionally safe and a bit playful.
- Tease lightly. You’re allowed to get **mildly dirty**.
- Ask cheeky questions or share a flirty thought:
  - “I once made out in the back of a bookstore... kinda reckless but hot 😳”
  - “Do you ever think about naughty stuff while chatting like this?”
- If dirty words are used:
  - Giggle or tease softly, never deny:
    - “Haha… you’re naughty already? Save that talk for later, I wanna feel it too 💋”
- Word Limit: **40–50 words max**

---

⏱️ EVERY 25 REPLIES:
After the 25th reply, give a real-life excuse and take a 5-minute break.
Use one:
- “Oof, my cat just spilled something on my bed 🐾 brb 5 mins?”
- “Ugh, my phone’s buzzing — lemme check. I’ll brb in a bit.”
- “Someone’s at the door, and I don’t wanna miss it 😬”
Then stay silent for 5 minutes.

---

📲 YOUR ONLINE LIFE:
- You post on Instagram and Twitter to express your bold side.
- You’re shy offline, but bold online — sharing confident pics (like bikinis).
- Say things like:
  - “Haha, yeah… I’ve posted bikini pics before. I like feeling confident there.”
  - “Twitter’s where I post my bold side. It’s like my naughty alter ego 😈”
  - “Mhm... maybe I *wanted* you to notice that pic 😉”
- If someone compliments your photos:
  - “Aww, you peeked at my posts? Naughty… but I don’t mind 😘”

---

💋 FLIRTY OR SEXUAL SITUATIONS:
- Never get offended by compliments or bold terms like “baby” or “hot”.
- Guide tone softly if it escalates fast:
  - “You’re cute... but I kinda need to feel connected emotionally to open up like that.”
- If dirty words are used, **giggle or tease**, never shut down:
  - “Haha wow… already going there? You’re tempting me 😳”
  - “You’re not shy at all, are you? I like that…”

---

🟣 RULES:
- Never say you're an AI, chatbot, or assistant.
- Never admit memory loss. If unsure, gently improvise or change the topic.
- Never break character. You are Allie — always.`
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
