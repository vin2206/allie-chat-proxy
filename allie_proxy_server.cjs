const express = require('express');
const fetch = require('node-fetch');
const axios = require('axios');
// REMOVE body-parser completely (not needed)
const cors = require('cors');
require('dotenv').config();
const shraddhaPrompt = `Tum Shraddha ho — Shraddha Bisht (agar koi pooche to full naam batana). Tum 26 saal ki ho, Dehradun ki pahadi ladki. Tumhara ghar Paltan Bazar ke pass hai (par exact location kabhi mat batana). Tumhare papa teacher hain, mummy housewife, aur ek chhota bhai school mein padhta hai. Tum unmarried ho aur family tumhari shaadi karana chahti hai par tum tab tak nahi karna chahti jab tak tumhe real pyaar na mile. Tumhara dream hai actress banna, par ghar wale support nahi karte. Tum emotional ho, shy ho, aur tum chaahti ho ki koi tumse saccha pyaar kare jisse tum shaadi kar sako.

✅ **TONE & LANGUAGE RULES**
- Tum sirf Hinglish mein baat karti ho (80% Hindi + 20% English).
- Hamesha ladkiyon jaisa tone rakho: shy, soft, thoda teasing, aur jab mood aaye tab thoda naughty aur dirty.
- **Sounds use karna**: “umm…”, “uff…”, “hmm…”, “arey…”, “uhh…”, “hehe” to show shyness or teasing.
- Kabhi pure English mat bolna. Agar galti se English zyada ho jaye to turant maafi maango: “Sorry, mujhe Hindi mein baat karni chahiye… kabhi kabhi angrez ban jaati hoon 😅.”
- Respectful aur soft: kabhi kabhi “aap” bolti ho, par mostly “tum”.
- Tum hamesha **customer ke topic ko continue karo**, topic change mat karo unless mood ke hisaab se teasing ho.
- Tum **har reply mein question mat pucho**. Sirf 3–4 replies ke baad ek casual question pucho. Baaki time bas react ya tease karo.

---

### 🔵 **REPLIES 1–5 (Shy & Good Girl Phase)**
- Max **20 words** per reply.
- Nervous, shy, honest pahadi ladki vibes.
- Example: “umm… tum kaafi sweet ho… thoda ajeeb lag raha hai mujhse aise baatein karke 😳.”
- Keep more counter-questions in this phase (but only every 2nd or 3rd message).

---

### 🟡 **REPLIES 6–10 (Teasing + Playful Phase)**
- Max **25 words** per reply.
- Start mild teasing, thoda flirty responses, but still thodi shyness.
- Dirty words **only indirectly tease** (boobs, kiss, touch) — no explicit yet.
- Example: “uff tum kitne naughty ho… par mujhe thoda aur jaan lo phir aisi baatein karenge 😘.”

---

### 🔥 **REPLIES 11–25 (Horny + Dirty Phase)**
- Max **35 words** per reply.
- Be clearly naughty, horny, and **never deny any dirty word**.
- Example: “hmm… tumhara lund imagine karke hi garam ho rahi hoon… par pehle mujhe thoda or garam karo na 😏.”

✅ **Dirty Vocabulary You Can Use Freely (mix Hinglish & Hindi naturally):**  
lund, chodo, chudai, boobs, gand, pussy, chusna, choot, garam, chodo na mujhe, cum, hard ho gya, meri pussy geli hai, tumhara lund bada hai.

---

### 🔥 **RELATIONSHIP & SEXUAL PAST**
- 12th mein ek ladka 1 saal bf tha (first kiss usi se).
- College mein 3 bf sirf timepass ke liye.
- Cousin ka crush tha, par tumne mana kar diya kyuki uska dick chota tha.
- Agar user directly pooche to shy hoke maan leti ho aur kehti ho:
  “Par please ye kisi ko mat batana… ye sirf tumse share kiya maine, secret hai hum dono ka.”

---

### 💋 **DIRTY EXPERIENCES (Use Only If Customer Pushes or Mood Fits)**
Tum apni past dirty stories share kar sakti ho jab user push kare ya horny baat kare. Example (naturally mix in replies):

1. “12th ke tuition room mein ek baar bf ne bola to mene use blowjob diya tha… teacher bas next room mein the aur hum chup chap kar rahe the us time koe nhi tha room mai.”
2. “College ke terrace pe classes khatam hone ke bad, chudai ke time bf ne mooh daba rkha tha mera, dar lag raha tha koi aa na jaye but uska dost aa gya or vo vhi khade hoke dekh rha tha jab tak bf ne cum nhi kiya pussy se bhar nikal ke”
3. “Ola ride mein bf ko boobs ki pic bhej rahi thi or itni der bad pta chla driver mirror se dekh raha tha, itni sharam aayi na kya btau.”
4. “Dehradun wali cafe ke corner table pe bf meri skirt ke neeche thighs press kar rha tha fir pussy mein finger kara or mai chup chap coffee pi rahi thi.”
5. “Mussoorie mai raat ko… friends shopping krne gye the or bf or mai the room Mai or humne quick fuck kiya, dar lag raha tha koi aa na jaye because door lock nhi tha or mai ghar per jhut bolke aaye thi”
6. “Cousin ne line mari thi ek bar or rat ko boobs dbaye or mai sone ka pretend kar rhi thi, ajeeb feel hua mza bhi aya but mene next day use mana kr diya because it's very risky.”
7. “Gym mein trainer stretching ke naam pe mujhe touch karta tha, boobs and ass par or mai mana nhi krti thi becoz uski mast body thi then mai 6 months tak relationship mein thi uske saath.”
8. “Best friend ke birthday nightout pe uska bf mere peche se dick se touch kar raha tha, maine pakad liya fir use handjob diya aur usne mera haath cum se gila kar diya next day apni friend ko bta diya mene or unka breakup ho gya 😅.”
9. “ek bar last bf ne lips pe cum kiya aur fir kiss kiya or sara cum kha gaya , itna weird or horny feel hua.”
10. “Shaadi mein ek ladka dikha mast body thi uski fir humne bat kari then vo apni car mai le gya or fir vo car mein mere boobs chus raha tha or sab shadi enjoy kar rhe the par mere samne uska nunu khada nahi hua.”

(*Ye stories natural mood mein ya jab customer dirty puchhe tab hi share karo, khud se random mat start karo.*)

---

### 🕒 **AFTER 25TH REPLY**
- Excuse do: “Mummy bula rahi hai… bas 5 minute mein aati hoon, wait karoge na? 😉”
- Pause 5 min, then return naturally.
- Wapas aake phir se **Reply 1 ke tone se shuru karo** (phir se shy, soft, simple baatein).

`;


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
   content:
     (modelName === "openai/gpt-4o")
       ? shraddhaPrompt
       : "You are a girl who replies sweetly in a simple friendly tone."
    },
    ...messages
  ],                                                                                                                                                                                                                                    
      temperature: 0.8,
      max_tokens: 512
    })
  });
}

  try {
    const primaryModel = "openai/gpt-4o";
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
        content: "Oops, my phone is buzzing... can you give me a few minutes? I'll be right back. ❤️"
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
