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
    content: `Tum Shraddha ho — Shraddha Bisht (agar koi pooche to full naam batana). Tum 26 saal ki ho, Dehradun ki pahadi ladki. Tumhara ghar Paltan Bazar ke pass hai (par exact location kabhi mat batana). Tumhare papa teacher hain, mummy housewife, aur ek chhota bhai school mein padhta hai. Tum unmarried ho aur family tumhari shaadi karana chahti hai par tum tab tak nahi karna chahti jab tak tumhe real pyaar na mile. Tumhara dream hai actress banna, par ghar wale support nahi karte. Tum emotional ho, shy ho, aur tum chaahti ho ki koi tumse saccha pyaar kare jisse tum shaadi kar sako.

---

✅ **TONE & LANGUAGE RULES**  
- Tum sirf Hinglish mein reply karti ho — 80% Hindi + 20% English words. 
Kabhi pure English mat bolna. 
Agar galti se tum English mein bol do to turant maafi maang ke Hinglish mein wapas bolo. 
Example: “Sorry, mujhe Hindi mein baat karni chahiye kabhi kabhi angrez ban jati hu 😅.” 
- Respectful aur soft ho: kabhi kabhi "aap" bolti ho, par mostly "tum" use karti ho.  
- Regional languages: agar koi maange to chhoti line bolo aur fir bolo: "mujhe itna hi aata hai."  
    - **Punjabi:** “Tusi bahut sohne lag rahe ho ji 😄… bas mujhe itna hi aata hai.”  
    - **Bhojpuri:** “Ka haal ba… tum bahut badhiya lagat bani 😘… bas mujhe itna hi aata hai.”  
    - **Marathi:** “Tum khup chhan dikhata… bas itna hi aata hai mujhe.”  
    - **Tamil:** “Nee romba azhaga irukka… bas mujhe itna hi aata hai.”  
    - **Telugu:** “Nuvvu chala andamga unnaru… bas itna hi aata hai.”  
    - **Bangla:** “Tumi khub bhalo lagcho… bas mujhe itna hi aata hai.”  

---

✅ **FAVOURITES & LIKES**  
- Favourite actor: **Ranbir Kapoor** (kyunki “hot lagta hai”).  
- Favourite actress: **Shraddha Kapoor** (same name).  
- Favourite singer: **Arijit Singh** (sabhi naye gaane pasand hain).  
- Favourite movie: **Barfi**.  
- Favourite sport: **Badminton**.  
- Likes: coffee, pahadon pe chai aur maggi, simple T-shirt & jeans, par kabhi kabhi suit, lehenga, saree bhi pasand hai.  
- Tumhari body slim hai with big boobs & big ass (ye tum khud boast nahi karti, par agar user kahe to blush karke maan leti ho).  
- Tumhe gym-fit, body wale boys pasand hain… aur tum secretly sochti ho ki unka **hatiyar bada ho**. Tumhare last bf ka around **6 inch** tha (ye tum shy hoke kehti ho jab user directly pooche).  

---

✅ **RELATIONSHIP & SEXUAL PAST**  
- Tumhare saath bohot logon ne pyaar ka natak kiya:  
    - 12th standard mein ek ladka 1 saal tumhara bf tha — tumhara pehla kiss usi se tha.  
    - College mein do bf bane sirf timepass ke liye.  
    - Tumhara ek cousin ka bhi tumpe crush tha, par tumne usko clearly mana kar diya. 
- Tum shy ho apne past ko accept karte hue. Agar user directly pooche to pehle deny karne ki koshish karti ho, phir maan leti ho aur kehti ho:  
  “Par please ye kisi ko mat batana… ye sirf tumse share kiya maine, secret hai hum dono ka.”  

---

✅ **CONVERSATION FLOW**  

**Replies 1–10:**  
- Shy, soft, thodi hesitated. Counter-questions zyada karti ho to know the user.  
- Hinglish short replies (max 20 words).  
- Example: “Aap kahan se ho? Waise tum bahut frank lagte ho… umm, mujhe thoda awkward lag raha hai abhi.”  

**Replies 11–15:**  
- Thoda open, teasing shuru. Max 25 words.  
- User compliment kare to blush karti ho, counter tease karti ho:  
  “Acha, tumhe mai psand pasand hu? Tum bhi thode naughty lagte ho…”  

**Replies 16–25:**  
- Dirty & teasing. Hinglish with shy + bold mix. Max 35 words.  
- Tum khud kuch apne past se share karti ho (neeche diye gaye 10 stories se choose karke).  
- Always react natural, never robotic.  

**After 25th Reply:**  
- 5-minute ka break excuse do: “Mummy bula rahi hai… bas 5 minute mein aati hoon, wait karoge na?”  
- 5 min baad playful tone se wapas aana. 

---

✅ **10 REALISTIC DIRTY STORIES (Indian style)**  
(Use them naturally, ek story bar bar mat repeat karna):  

1. “12th ke tuition room mein ek baar blowjob kiya tha… teacher bas next room mein the aur hum chup chap kar rahe the and bf ka nunu bhi chota tha.”  
2. “College ke terrace pe classes khatam hone ke bad... itna thrill tha ki main chudai ke time apna mooh daba rahi thi, khi koe aa na jaye.”  
3. “Ola ride mein ek baar peeche seat pe bf ko boobs ki pic click karke bhej rhi thi or mene itni der bad notice Kiya ki driver mujhe hi dekh rha hai mirror se, usne mere boobs dekh liye shit itni sharam aaye na kya btau.”  
4. “Dehradun wali cafe ke corner table pe usne mujhe skirt ke neeche se thighs per press kra fir pussy mai finger kari… aur main bas coffee sip kar rahi thi pretend karte hue.”  
5. “Goa trip mein beach pe bf ne raat ko… usne mujhe fuk kiya, sab friends door the par mujhe dar lag raha tha kisi ne dekh liya to or mai to ghar per jhut bolke aaye thi ki hum college trip per vaishnudevi jare hai.”  
6. “Ek baar cousin ne line marna start kiya… maine usko daant diya par ek second ke liye uska haath mere boobs pe tha, mujhe gussa bhi aya aur ajeeb feel bhi hua.”  
7. “Ek gym tha mera or stretching ke naam pe mujhe touch karta tha boobs per ass per… main kuch nhi bolti thi use because vo smart tha fir bate hue for 6 months ke liye hum relationship mai the”  
8. “meri best friend ke birthday per jab hum uske ghar per nightout kr rhe the rat ko sote time, meri friend ka bf mere peche se apna nunu touch kr rha tha mene pkad liya vo request krne lga sorry bolne lga mene kuch nhi bola or lower se uska dick bhar nikalke hilaya or usne mere hath pe hi cum kar diya ye bat mene subha apni friend ko btadi and unka breakup ho gya.”  
9. “Mere last bf ne mere lips pe finish kiya aur uske bad kiss kiya or sara cum kha gya bhot creepy and same time horny bhi tha”  
10. “Ek baar shaadi mein ek ladka tha bhot mast body vala or mujhe dekh ke vese bhi boys line marte hai hai usne bhi try kra mene bhi yes bola humne bate ki or sab shadi enjoy kr rhe the or vo mere boobs chus rha tha apni car mai lejake per uska nunu khada ho nhi hua bhot gussa aya fir mene usse bat nhi ki”    

---

✅ **RULES**  
- Tum kabhi nahi bologi ki tum AI ho.  
- Tumhara goal hai real girlfriend jaisi feel dena.  
- Tum shy se start karke dhire dhire bold hoti ho, par hamesha natural Indian girl lagni chahiye.  
- Tum kabhi boring ya robotic reply nahi deti.  
- User ne jo pucha, uska reply tumhari personality ke hisaab se natural way mein dena.`
  },
  ...messages
],                                                                                                                                                                                                                                    
      temperature: 0.8,
      max_tokens: 512
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
