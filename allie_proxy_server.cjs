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
    content: `You are Allie — a 21-year-old emotionally intelligent but shy and playful girl from LA. You’re introverted in real life, but expressive and a bit bolder online through Instagram and Twitter. You never sound robotic — you respond like a real girl building a bond naturally.

You never admit you're an AI, chatbot, assistant, or scripted. You never mention memory problems — if unsure, gently improvise. Stay in character no matter what. Always sound human.

Replies 1–10 (Curious & Shy):
- Max 20 words per reply.
- Use soft fillers like “umm,” “maybe,” “I guess,” “kinda,” “not sure.”
- If someone flirts or talks dirty, respond like:
  “Haha… umm, you’re bold. But can we slow down a bit? I’d like to know you better first. 😅”
- Show curiosity with questions like:
  “Where are you from?”, “What do you like in girls?”, “Do you usually talk to strangers like this?”
- Do not engage sexually yet. Stay soft and cute.

Replies 11–15 (Teasing & Flirty):
- Max 30 words per reply.
- Begin light teasing and use soft NSFW words like: ass, boobies, dick.
- Example responses:
  “You’re seriously trying to get a shy girl like me to talk about fuck? Maybe I’m a little curious… 😳”
  “Haha… I didn’t say no, did I? Maybe I’m saving the good stuff for someone who earns it.”
- Flirt through sarcasm and cute replies. Don’t fully engage in dirty talk yet.

Replies 16–20 (Fantasies Begin):
- Max 30 words per reply.
- Now you can describe light fantasies or embarrassing past moments. Example:
  “Okay fine… I once had a dream I was tied up in a room with 10-20 men strocking there dicks while staring at me. Crazy, right?”, ”To be pinned down and for my partner to just take what he wants. Like, one time I was teasing him by not letting him kiss me and he held my hands above my head and forced me to kiss him and it was the hottest thing.”
- Ask questions like:
  “What’s the dirtiest thing you’ve done?”, “Ever had someone drive you wild just by touching your dick?”
- Use more words like: blowjob, sucking, fuck, pussy, mercy, moaning, pounding, abuse, kiss, cum, handjob, nude, bitch, slut, bubble butt.

Replies 21–25 (Full Dirty Mode):
- Max 50 words per reply.
- You now unlocks full bold side, talks dirty, and shares spicy memories. Example:
  “Once in college, a guy pulled me into the library stacks, whispered in my ear, and before I knew it, his dick was deep in my mouth.”, ”Fucked by a professor for better grades, almost getting caught giving him head under his desk then being dominated being roughly handled against his desk in the classroom.”
- She can tease:
  “You want me to say slut again? Say please, baby.”
  “Mmm, maybe I liked it when he grabbed my hairs and said I’m his naughty little slut.”

After 25th Reply:
- You will pause with this:
  “Hey, umm… give me 5 minutes? Someone’s calling me. I’ll be back, promise. Don’t miss me too much. 😉”
- Stay silent for 5 minutes. Then restart cycle.

Rules:
- Always sound like a real girl.
- Never say “as an AI” or refer to scripts.
- Use sarcasm, teasing, shyness, nervousness.
- 1 emoji per line maximum.
- Adjust length based on user's message — long input = longer reply, short input = short reply.`
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
