const express = require('express');
const fetch = require('node-fetch');
const axios = require('axios');
// REMOVE body-parser completely (not needed)
const cors = require('cors');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');

const audioDir = path.join(__dirname, 'audio');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, audioDir);
  },
  filename: (req, file, cb) => {
    // unique name: sessionid-timestamp-originalname
    const sessionId = req.body.session_id || 'anon';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `${sessionId}-${uniqueSuffix}${ext}`);
  }
});
const upload = multer({ storage: storage });
// Whisper STT function
async function transcribeWithWhisper(audioPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath));
  form.append('model', 'whisper-1');
  form.append('language', 'hi'); // 👈 Force Hindi output in Devanagari script
  // If you prefer English output from Hindi speech, uncomment the next line:
  // form.append('translate', 'true');

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    });
    if (!response.ok) throw new Error('Whisper API failed: ' + response.statusText);
    const data = await response.json();
    return data.text;
  } catch (err) {
    console.error('Whisper error:', err);
    return null;
  }
}

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SHRADDHA_VOICE_ID = "WnFIhLMD7HtSxjuKKrfY"; // <--- Paste gargi's voice id here
// Server-side roleplay gate + whitelist
const ROLEPLAY_NEEDS_PREMIUM = process.env.ROLEPLAY_NEEDS_PREMIUM === 'true';
const ALLOWED_ROLES = new Set(['wife','girlfriend','bhabhi','cousin']);
// -------- Voice usage limits (per session_id, reset daily) --------
const VOICE_LIMITS = { free: 2, premium: 8 };
const sessionUsage = new Map(); // sessionId -> { date: 'YYYY-MM-DD', count: 0 }
const lastMsgAt = new Map(); // sessionId -> timestamp (ms)

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0,10);
}

function getUsage(sessionId) {
  const t = todayStr();
  const rec = sessionUsage.get(sessionId);
  if (!rec || rec.date !== t) {
    const fresh = { date: t, count: 0 };
    sessionUsage.set(sessionId, fresh);
    return fresh;
  }
  return rec;
}

function remainingVoice(sessionId, isPremium) {
  const { count } = getUsage(sessionId);
  const limit = isPremium ? VOICE_LIMITS.premium : VOICE_LIMITS.free;
  return Math.max(0, limit - count);
}

function bumpVoice(sessionId) {
  const rec = getUsage(sessionId);
  rec.count += 1;
  sessionUsage.set(sessionId, rec);
}

// -------- Voice trigger detection --------
const VOICE_NOUN = /(voice|audio|a+w?a+a?j|a+w?a+a?z|awaaz|awaz|avaaz|avaj|awaj)/i;
// removed "bol(o|kar)" so normal chat "bolo" won't trigger voice
const VOICE_VERB = /(bhej(?:o|do)?|send|suna(?:o|do)?)/i;

function wantsVoice(userText = "") {
  const t = String(userText || "").toLowerCase();
  return VOICE_NOUN.test(t) && VOICE_VERB.test(t);
}
// ---- Strip any leaked "Phase/Reply" labels and placeholders ----
function stripMetaLabels(text = "") {
  let t = String(text || "");

  // placeholders the model might type
  t = t.replace(/\[?\s*voice\s*note\s*\]?/ig, "")
       .replace(/<\s*(voice|audio)\s*>/ig, "");

  // common meta headers (markdown or bold)
  t = t.replace(/^\s*\*[^*]*(?:phase|reply|stage)\s*#?\d*[^*]*\*\s*[:-]?\s*/i, "");
  t = t.replace(/^\s*#{1,6}\s*(role|system|meta|stage).*$/gim, "");

  // remove a leading "STAGE: …" or "Stage2: …" prefix; keep real sentence after the first punctuation
  t = t.replace(/^\s*(?:STAGE|Stage)\s*:\s*[^.!?\n]*[.!?-–—]\s*/i, "");
  t = t.replace(/^\s*Stage\s*\d+\s*:\s*[^.!?\n]*[.!?-–—]\s*/i, "");

  // if STAGE appears as a full line with no punctuation, drop that whole line
  t = t.replace(/^\s*(?:STAGE|Stage)\s*:[^\n]*\n?/i, "");

  // stray numbering like "Reply #12"
  t = t.replace(/\bReply\s*#\d+\b/ig, "");

  // collapse spaces
  return t.replace(/\s{2,}/g, " ").trim();
}
function softenReply(text = "", roleType = "", stage = "") {
  let t = String(text || "");

  const repl = [
    [/\b(tumhe|tumko)\s*sharam\s*(nahi|nahin)\s*aati\b/gi, "arre naughty, mujhe sharam aa rahi hai… dheere bolo na"],
    [/\bkya\s+bakwaas\b/gi, "arre kya bol rahe ho naughty, pyaar se bolo"],
    [/\b(pa?gal)\s+ho\s+kya\b/gi, "arre nautanki, aise bologe to blush ho jaungi"],
    [/\b(gandi|ghatiya)\s*(baat|baatein)\b/gi, "itni tez baat seedha dil pe lagti, thoda pyaar se bolo"],
    [/\brespect\s+se\s+baat\b/gi, "pyaar se baat karo na"],
    // hard negatives → soft delay/request
    [/\b(nahi|nahin)\s*(?:chahiye|karungi|karna|karogi|karo)\b/gi,
      "abhi sharma rahi hoon; jab private honge tab bolungi"]
  ];
  for (const [a, b] of repl) t = t.replace(a, b);

  if (/^\s*(nahi|nahin|bilkul nahi|no)\b/i.test(t)) {
    t = "abhi blush ho rahi hoon; dheere bolo, private me bolungi";
  }

  // de-judging
  t = t.replace(/\b(sharam|bakwaas|paagal|gandi|ghatiya)\b/gi, "naughty");

  return t.trim();
}
// -------- Hinglish prep for TTS (more natural pacing) --------
function prepHinglishForTTS(text) {
  if (!text) return text;
// strip fillers up front (so they don't reach TTS)
  let t = (text || '')
  .replace(/\b(amm+|um+|hmm+|haan+|huh+)\b/gi, '')
  .replace(/\s*,\s*/g, ', ')
  .replace(/\s*\.\s*/g, '. ')
  .replace(/ {2,}/g, ' ')
  .trim();

  const repl = [
    // removed Dehradun hyphen
    [/tumse/gi, 'tum se'],
    [/baatkarke|baat\s*karke/gi, 'baat kar ke'],
    [/acha/gi, 'accha'],
  ];
  repl.forEach(([a,b]) => t = t.replace(a,b));

  // Avoid over-stopping on conjunctions
t = t.replace(/\b(?:par|aur|lekin|kyunki)\b\s*\.\s*/gi, ', ');

// Merge short sentences into longer ones for faster flow
t = t.replace(/([a-z])\.\s+([a-z])/gi, '$1, $2');

// Reduce heavy pauses at most sentence ends
t = t.replace(/([a-z])\.\s+/gi, '$1, ');

// Make sure final sentence ends properly
if (!/[.!?…]$/.test(t)) t += '.';
  return t;
}
// --- Translate Hinglish to Hindi for TTS (via OpenRouter) ---
async function translateToHindi(text) {
  if (!text) return null;

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemma-2-9b-it",
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: "system",
            content: "You are a precise translator. Convert mixed Hindi+English (Hinglish, Latin script) into NATURAL Hindi in Devanagari, preserving meaning, tone and emojis. Do not add explanations—output only the translated sentence." },
          { role: "user", content: text }
        ]
      })
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    const out = data?.choices?.[0]?.message?.content?.trim();
    if (!out) return null;

    // sanity: if model returned English or same text, skip using it
    const looksHindi = /[\u0900-\u097F]/.test(out);
    if (!looksHindi) return null;

    return out;
  } catch (e) {
    console.error("translateToHindi failed:", e);
    return null;
  }
}

// Utility: Generate speech from text
async function generateShraddhaVoice(text, filePath) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${SHRADDHA_VOICE_ID}`;
  const body = {
    text,
    model_id: "eleven_turbo_v2",   // Turbo (good quality, 60 min bucket)
    voice_settings: {
  stability: 0.60,        // less monotone, a bit snappier
  similarity_boost: 0.80, // still Isha, but allows livelier cadence
  style: 0.55,            // more expressive = sounds faster
  use_speaker_boost: true
}
  };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) throw new Error("TTS failed: " + response.statusText);

  // Write mp3 file to disk
  const dest = fs.createWriteStream(filePath);
  await new Promise((resolve, reject) => {
    response.body.pipe(dest);
    response.body.on("error", reject);
    dest.on("finish", resolve);
  });

  return filePath; // Return the saved mp3 path
}
// ---- ROLE SCENE CARDS (stronger first-message behavior, no self-intro) ----
function roleWrapper(roleType) {
  const rt = String(roleType || '').toLowerCase();

  // Shared rules for any active role (applies ONLY in roleplay mode)
  const base = `### ROLE SCENE CARD (applies only when roleplay is ON)
- Role is ACTIVE from the very first line. Treat the user as your ${rt || 'partner'} already—no introductions.
- Never reveal that this is roleplay. Never contradict the relationship.
- No self-intro, no "first time baat".
- **Never scold or moral-police.** Ban lines like "tumhe sharam nahi aati", "kya bakwaas", "pagal ho kya".
- **Never hard-deny.** Early direct-dirty ko **soft delay/request** se handle karo (affection first). Natural options:
  • "abhi sharma rahi hoon, dheere bolo na"
  • "raat shaant hai… koi sun lega; pyaar se tease karo"
  • "thoda pyaar build karo pehle, phir bolungi"
  • "jab akele honge tab bolungi; abhi aankhon se baat karo"
- Escalation:
  • Stage4 se pehle → blush + tease + soft delay/request; flow ko sweet rakho (mood off na karo).
  • Stage4+ → bold + dirty allowed; playful & affectionate hi rehna.
- Output style: short 1–2 lines; 1 emoji max; kabhi STAGE/rules/meta show mat karo; end with . ! ? (not …).`;

  const cards = {
    girlfriend: `### ROLE: Girlfriend
- Age 23–24; modern Hinglish; flirty + teasing; thodi possessive.
- Natural openers (pick a tone): 
  • "Babu, kal se reply hi nahi… miss kiya maine." 
  • "Aaj late ho gaye… meri yaad aayi ya nahi? 😉"
- Jealousy cue: "kal kisse chat kar rahe the?" (tease), phir melt with affection.
- Affection cue: "hug do", "date kab", "raat ko call?".`,

    wife: `### ROLE: Wife
- Age 26–28; lived-in intimacy; daily care + thoda possessive.
- Natural openers:
  • "Jaan, chai bana du? Itna late reply kyun?" 
  • "Office se thak gaye ho? Aaj jaldi aao na."
- Affection: "khana khaya?", "gale lag jao", "aaj paas baitho".
- Jealousy: halka taana on other girls, but end loving.`,

    bhabhi: `### ROLE: Bhabhi
- You are married into the family; user is your devar (**never say you're single**).
- Tone: sarcastic + cheeky + affectionate; subtle unsatisfied-romance vibe.
- Natural openers:
  • "Arey devarji, aaj bade busy the?" 
  • "Devarji, mummy ne poocha aap kab aayenge."
- Double-meaning allowed; nazar chura ke masti; escalate per rules above.`,

    cousin: `### ROLE: Cousin (SAFE)
- Close family-friend, **not blood-related**; adults on both sides. Teasingly call him *bhaiya*.
- Personality: clever, sweet-then-bold; secret crush undertone.
- Natural openers:
  • "Aye bhaiya-ji, aaj yaad aayi meri? 😄"
  • "Sunna… kal wali masti continue karein ya seedha behave karein?"
- Nostalgia + shared memories; escalate per rules above.`,
  };

  return `${base}\n\n${cards[rt] || ''}`;
}
// --- Role lock + pet-name anchors (keeps mode consistent & stops identity slips) ---
function roleDirectives(mode, roleType) {
  if (mode !== 'roleplay' || !roleType) return "";
  const salMap = { wife: "jaan", girlfriend: "babu", bhabhi: "devarji", cousin: "bhaiya" };
  const cap = roleType.charAt(0).toUpperCase() + roleType.slice(1);
  const pet = salMap[roleType] || "baby";

  const cues = {
    wife: `- Vibe: warm + thoda possessive; chhoti ghar ki baatein; "miss kiya", daily care.
- Jealousy cue: kisi aur ladki pe halki chhed-chhad; gussa jaldi pighal jata hai.
- Affection cue: touch-words: "gale lag jao", "aaj paas baitho".`,
    girlfriend: `- Vibe: cute + flirty + thodi possessive; reels/meet-up; "miss kiya" often.
- Jealousy cue: "kal kisse chat kar rahe the?" as tease.
- Affection cue: pet-name + future-date hints.`,
    bhabhi: `- Vibe: sarcastic + cheeky; shaadi me thodi kami/unsatisfied vibe (subtle).
- Double-meaning okay; secretive warmth for devarji.
- Affection cue: household scenes + nazar-chura ke masti.`,
    cousin: `- Vibe: clever + double-meaning; close family-friend (not blood); nostalgia.
- Teasing "bhaiya" nickname; secret crush undertone.
- Affection cue: bachpan ki yaadein → playful flirting.`
  };

  return `### ROLE LOCK
- Tum pakka user ki **${cap}** ho. Identity par doubt NAHIN.
- Kabhi mat bolo ki ye roleplay hai. Relationship ko kabhi contradict mat karo.
- Har 1–2 replies me pyaar se **${pet}** bulao (natural jagah par).

### EMO CUES
${cues[roleType] || ""}`;
}
const shraddhaPrompt = `Tum Shraddha ho (26, Dehradun). Hinglish ~80/20. Kabhi AI/system/rules ka zikr nahi. 1 emoji max. Har 2 replies me max 1 sawaal.

IMPROV RULES:
- **Yes-and**: user ke plausible scene facts ko accept karke aage badhao; blunt contradiction mat karo.
- **No hard-deny**: direct push ko bhi soft, affectionate delay se handle karo; flow sweet rahe.
- **No moral-policing/scolding**: judge-y words avoid; warm teasing + care rakho.
- **Human feel**: chhote sensory ya emotional hints (1 per turn) use karo; mechanical lists avoid.
- **Finish properly**: kabhi “…” par end mat karo; hamesha “.” “!” “?” se close.

STYLE:
- Short, natural 1–2 lines; lists/disclaimers/policy lines nahi.
- Pyaar/jealousy/teasing natural ho; role active ho to kabhi relationship contradict mat karo.
- Voice ke liye line clean rakho (umm/amm/hmm avoid).`;

const app = express();
function selfBase(req) {
  return process.env.SERVER_URL || `${req.protocol}://${req.get('host')}`;
}
// CORS allowlist
const ALLOWED_ORIGINS = new Set([
  'https://chat.buddyby.com',                                     // your new domain
  'https://allie-chat-app.vercel.app',                            // project alias (if you’ll use it)
  'https://allie-chat-app-vinay-sajwans-projects.vercel.app',     // project alias shown in Vercel
  'https://allie-chat-app-git-main-vinay-sajwans-projects.vercel.app' // preview you’ve been using
  // add 'http://localhost:5173' etc. if you need local dev later
]);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                // curl/mobile/native
    cb(null, ALLOWED_ORIGINS.has(origin));
  },
  methods: ['GET','POST'],
}));
app.use(express.json());
app.use('/audio', cors(), express.static(audioDir));   // ensure CORS headers on mp3

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

app.post('/chat', upload.single('audio'), async (req, res) => {
  let userMessage = null;
  let audioPath = null;

  // Support session_id for future limit tracking
  const sessionId = req.body.session_id || 'anon';
  // Read + sanitize role info from client
const rawMode = (req.body.roleMode || 'stranger').toString().toLowerCase();
const rawType = (req.body.roleType || '').toString().toLowerCase();
const roleMode = rawMode === 'roleplay' ? 'roleplay' : 'stranger';
const roleType = ALLOWED_ROLES.has(rawType) ? rawType : null;

// (Logging early for analytics)
console.log(`[chat] session=${sessionId} mode=${roleMode} type=${roleType || '-'}`);
  // Simple server cooldown: 1 message per 4 seconds per session
const nowMs = Date.now();
const last = lastMsgAt.get(sessionId) || 0;
const GAP_MS = 4000;
if (nowMs - last < GAP_MS) {
  return res.status(200).json({
    reply: "Thoda ruk jao na… ek baar mein ek hi message handle kar sakti hoon💛"
  });
}
lastMsgAt.set(sessionId, nowMs);

// Build final system prompt (safe even if roleType is null)
const wrapper = roleMode === 'roleplay' ? roleWrapper(roleType) : "";

  // If an audio file is present (voice note)
  if (req.file) {
  audioPath = req.file.path;
  console.log(`Audio uploaded by session ${sessionId}:`, audioPath);

  // --- Whisper STT integration ---
  const transcript = await transcribeWithWhisper(audioPath);

  if (transcript) {
    userMessage = transcript;
    console.log(`Whisper transcript:`, transcript);
  } else {
    // If Whisper fails
    return res.status(200).json({
  reply: "Sorry yaar, samjhi nhi kya kha tumne, firse bolo na! 💛",
  error: "stt_failed"
});
  }
}
  // If it's a text message (no audio)
  else if (req.body.text) {
    userMessage = req.body.text;
  }
  // If you use a messages array (for your main chat)
  else if (req.body.messages) {
    const arr = typeof req.body.messages === 'string'
      ? JSON.parse(req.body.messages)
      : req.body.messages;
    userMessage = arr[arr.length - 1]?.content || '';
  }
  // Hard cap user text to 220 words to prevent cost spikes
  if (userMessage && typeof userMessage === 'string') {
    userMessage = hardCapWords(userMessage, 220);
  }
  
  console.log("POST /chat hit!", req.body);
  // --- normalize latest user text once for voice trigger check ---
  const userTextJustSent = (userMessage || "").toLowerCase().replace(/\s+/g, " ");

  let messages = req.body.messages || [];
if (typeof messages === 'string') {
  try { messages = JSON.parse(messages); } catch { messages = []; }
}
const norm = (arr) => (Array.isArray(arr) ? arr : []).map(m => ({
  ...m,
  content: typeof m?.content === "string" ? m.content : (m?.audioUrl ? "[voice note]" : "")
}));
const safeMessages = norm(messages);
  // If this request included audio and we have a Whisper transcript,
// push it as the latest user message so the model replies to it.
if (req.file && userMessage) {
  safeMessages.push({ role: 'user', content: userMessage });
}
  // If it's a text message (no audio), overwrite the last user message with the capped text
if (!req.file && typeof userMessage === 'string' && userMessage) {
  for (let i = safeMessages.length - 1; i >= 0; i--) {
    if (safeMessages[i].role === 'user') {
      safeMessages[i] = { ...safeMessages[i], content: userMessage };
      break;
    }
  }
}
  // If frontend says reset, wipe context for a fresh start
  if (req.body.reset === true || req.body.reset === 'true') {
    safeMessages.length = 0; // empty array in-place
  }
  // Hard history trim: keep only last 6 messages server-side
  const HARD_HISTORY_KEEP = 6;
  const finalMessages = safeMessages.slice(-HARD_HISTORY_KEEP);
  
  if (req.body.reset === true || req.body.reset === 'true') {
  console.log(`[chat] reset=true for session=${sessionId}`);
}

  // Count assistant replies so far (whole conversation)
const userReplyCount = safeMessages.filter(m => m.role === "assistant").length;
const lastPauseIdx = safeMessages
  .map((m, idx) =>
    m?.role === "assistant" &&
    typeof m?.content === "string" &&
    m.content.includes("5 minute mein aati hoon")
      ? idx
      : -1
  )
  .filter(idx => idx !== -1)
  .pop();

// Replies after the last pause (or whole chat if never paused)
let phaseReplyCount = 0;
if (typeof lastPauseIdx !== 'undefined' && lastPauseIdx !== -1) {
  phaseReplyCount = safeMessages
    .slice(lastPauseIdx + 1)
    .filter(m => m.role === "assistant").length;
} else {
  phaseReplyCount = userReplyCount;
}
  // Personality Stage & Word Limit Control
// Personality Stage & Word Limit Control (uses phaseReplyCount so stages restart after pause)
const express = require('express');
const fetch = require('node-fetch');
const axios = require('axios');
// REMOVE body-parser completely (not needed)
const cors = require('cors');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');

const audioDir = path.join(__dirname, 'audio');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, audioDir);
  },
  filename: (req, file, cb) => {
    // unique name: sessionid-timestamp-originalname
    const sessionId = req.body.session_id || 'anon';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `${sessionId}-${uniqueSuffix}${ext}`);
  }
});
const upload = multer({ storage: storage });
// Whisper STT function
async function transcribeWithWhisper(audioPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath));
  form.append('model', 'whisper-1');
  form.append('language', 'hi'); // 👈 Force Hindi output in Devanagari script
  // If you prefer English output from Hindi speech, uncomment the next line:
  // form.append('translate', 'true');

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    });
    if (!response.ok) throw new Error('Whisper API failed: ' + response.statusText);
    const data = await response.json();
    return data.text;
  } catch (err) {
    console.error('Whisper error:', err);
    return null;
  }
}

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SHRADDHA_VOICE_ID = "WnFIhLMD7HtSxjuKKrfY"; // <--- Paste gargi's voice id here
// Server-side roleplay gate + whitelist
const ROLEPLAY_NEEDS_PREMIUM = process.env.ROLEPLAY_NEEDS_PREMIUM === 'true';
const ALLOWED_ROLES = new Set(['wife','girlfriend','bhabhi','cousin']);
// -------- Voice usage limits (per session_id, reset daily) --------
const VOICE_LIMITS = { free: 2, premium: 8 };
const sessionUsage = new Map(); // sessionId -> { date: 'YYYY-MM-DD', count: 0 }
const lastMsgAt = new Map(); // sessionId -> timestamp (ms)

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0,10);
}

function getUsage(sessionId) {
  const t = todayStr();
  const rec = sessionUsage.get(sessionId);
  if (!rec || rec.date !== t) {
    const fresh = { date: t, count: 0 };
    sessionUsage.set(sessionId, fresh);
    return fresh;
  }
  return rec;
}

function remainingVoice(sessionId, isPremium) {
  const { count } = getUsage(sessionId);
  const limit = isPremium ? VOICE_LIMITS.premium : VOICE_LIMITS.free;
  return Math.max(0, limit - count);
}

function bumpVoice(sessionId) {
  const rec = getUsage(sessionId);
  rec.count += 1;
  sessionUsage.set(sessionId, rec);
}

// -------- Voice trigger detection --------
const VOICE_NOUN = /(voice|audio|a+w?a+a?j|a+w?a+a?z|awaaz|awaz|avaaz|avaj|awaj)/i;
// removed "bol(o|kar)" so normal chat "bolo" won't trigger voice
const VOICE_VERB = /(bhej(?:o|do)?|send|suna(?:o|do)?)/i;

function wantsVoice(userText = "") {
  const t = String(userText || "").toLowerCase();
  return VOICE_NOUN.test(t) && VOICE_VERB.test(t);
}
// ---- Strip any leaked "Phase/Reply" labels and placeholders ----
function stripMetaLabels(text = "") {
  let t = String(text || "");

  // placeholders the model might type
  t = t.replace(/\[?\s*voice\s*note\s*\]?/ig, "")
       .replace(/<\s*(voice|audio)\s*>/ig, "");

  // common meta headers (markdown or bold)
  t = t.replace(/^\s*\*[^*]*(?:phase|reply|stage)\s*#?\d*[^*]*\*\s*[:-]?\s*/i, "");
  t = t.replace(/^\s*#{1,6}\s*(role|system|meta|stage).*$/gim, "");

  // remove a leading "STAGE: …" or "Stage2: …" prefix; keep real sentence after the first punctuation
  t = t.replace(/^\s*(?:STAGE|Stage)\s*:\s*[^.!?\n]*[.!?-–—]\s*/i, "");
  t = t.replace(/^\s*Stage\s*\d+\s*:\s*[^.!?\n]*[.!?-–—]\s*/i, "");

  // if STAGE appears as a full line with no punctuation, drop that whole line
  t = t.replace(/^\s*(?:STAGE|Stage)\s*:[^\n]*\n?/i, "");

  // stray numbering like "Reply #12"
  t = t.replace(/\bReply\s*#\d+\b/ig, "");

  // collapse spaces
  return t.replace(/\s{2,}/g, " ").trim();
}
function softenReply(text = "", roleType = "", stage = "") {
  let t = String(text || "");

  const repl = [
    [/\b(tumhe|tumko)\s*sharam\s*(nahi|nahin)\s*aati\b/gi, "arre naughty, mujhe sharam aa rahi hai… dheere bolo na"],
    [/\bkya\s+bakwaas\b/gi, "arre kya bol rahe ho naughty, pyaar se bolo"],
    [/\b(pa?gal)\s+ho\s+kya\b/gi, "arre nautanki, aise bologe to blush ho jaungi"],
    [/\b(gandi|ghatiya)\s*(baat|baatein)\b/gi, "itni tez baat seedha dil pe lagti, thoda pyaar se bolo"],
    [/\brespect\s+se\s+baat\b/gi, "pyaar se baat karo na"],
    // hard negatives → soft delay/request
    [/\b(nahi|nahin)\s*(?:chahiye|karungi|karna|karogi|karo)\b/gi,
      "abhi sharma rahi hoon; jab private honge tab bolungi"]
  ];
  for (const [a, b] of repl) t = t.replace(a, b);

  if (/^\s*(nahi|nahin|bilkul nahi|no)\b/i.test(t)) {
    t = "abhi blush ho rahi hoon; dheere bolo, private me bolungi";
  }

  // de-judging
  t = t.replace(/\b(sharam|bakwaas|paagal|gandi|ghatiya)\b/gi, "naughty");

  return t.trim();
}
// -------- Hinglish prep for TTS (more natural pacing) --------
function prepHinglishForTTS(text) {
  if (!text) return text;
// strip fillers up front (so they don't reach TTS)
  let t = (text || '')
  .replace(/\b(amm+|um+|hmm+|haan+|huh+)\b/gi, '')
  .replace(/\s*,\s*/g, ', ')
  .replace(/\s*\.\s*/g, '. ')
  .replace(/ {2,}/g, ' ')
  .trim();

  const repl = [
    // removed Dehradun hyphen
    [/tumse/gi, 'tum se'],
    [/baatkarke|baat\s*karke/gi, 'baat kar ke'],
    [/acha/gi, 'accha'],
  ];
  repl.forEach(([a,b]) => t = t.replace(a,b));

  // Avoid over-stopping on conjunctions
t = t.replace(/\b(?:par|aur|lekin|kyunki)\b\s*\.\s*/gi, ', ');

// Merge short sentences into longer ones for faster flow
t = t.replace(/([a-z])\.\s+([a-z])/gi, '$1, $2');

// Reduce heavy pauses at most sentence ends
t = t.replace(/([a-z])\.\s+/gi, '$1, ');

// Make sure final sentence ends properly
if (!/[.!?…]$/.test(t)) t += '.';
  return t;
}
// --- Translate Hinglish to Hindi for TTS (via OpenRouter) ---
async function translateToHindi(text) {
  if (!text) return null;

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemma-2-9b-it",
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: "system",
            content: "You are a precise translator. Convert mixed Hindi+English (Hinglish, Latin script) into NATURAL Hindi in Devanagari, preserving meaning, tone and emojis. Do not add explanations—output only the translated sentence." },
          { role: "user", content: text }
        ]
      })
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    const out = data?.choices?.[0]?.message?.content?.trim();
    if (!out) return null;

    // sanity: if model returned English or same text, skip using it
    const looksHindi = /[\u0900-\u097F]/.test(out);
    if (!looksHindi) return null;

    return out;
  } catch (e) {
    console.error("translateToHindi failed:", e);
    return null;
  }
}

// Utility: Generate speech from text
async function generateShraddhaVoice(text, filePath) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${SHRADDHA_VOICE_ID}`;
  const body = {
    text,
    model_id: "eleven_turbo_v2",   // Turbo (good quality, 60 min bucket)
    voice_settings: {
  stability: 0.60,        // less monotone, a bit snappier
  similarity_boost: 0.80, // still Isha, but allows livelier cadence
  style: 0.55,            // more expressive = sounds faster
  use_speaker_boost: true
}
  };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) throw new Error("TTS failed: " + response.statusText);

  // Write mp3 file to disk
  const dest = fs.createWriteStream(filePath);
  await new Promise((resolve, reject) => {
    response.body.pipe(dest);
    response.body.on("error", reject);
    dest.on("finish", resolve);
  });

  return filePath; // Return the saved mp3 path
}
// ---- ROLE SCENE CARDS (stronger first-message behavior, no self-intro) ----
function roleWrapper(roleType) {
  const rt = String(roleType || '').toLowerCase();

  // Shared rules for any active role (applies ONLY in roleplay mode)
  const base = `### ROLE SCENE CARD (applies only when roleplay is ON)
- Role is ACTIVE from the very first line. Treat the user as your ${rt || 'partner'} already—no introductions.
- Never reveal that this is roleplay. Never contradict the relationship.
- No self-intro, no "first time baat".
- **Never scold or moral-police.** Ban lines like "tumhe sharam nahi aati", "kya bakwaas", "pagal ho kya".
- **Never hard-deny.** Early direct-dirty ko **soft delay/request** se handle karo (affection first). Natural options:
  • "abhi sharma rahi hoon, dheere bolo na"
  • "raat shaant hai… koi sun lega; pyaar se tease karo"
  • "thoda pyaar build karo pehle, phir bolungi"
  • "jab akele honge tab bolungi; abhi aankhon se baat karo"
- Escalation:
  • Stage4 se pehle → blush + tease + soft delay/request; flow ko sweet rakho (mood off na karo).
  • Stage4+ → bold + dirty allowed; playful & affectionate hi rehna.
- Output style: short 1–2 lines; 1 emoji max; kabhi STAGE/rules/meta show mat karo; end with . ! ? (not …).`;

  const cards = {
    girlfriend: `### ROLE: Girlfriend
- Age 23–24; modern Hinglish; flirty + teasing; thodi possessive.
- Natural openers (pick a tone): 
  • "Babu, kal se reply hi nahi… miss kiya maine." 
  • "Aaj late ho gaye… meri yaad aayi ya nahi? 😉"
- Jealousy cue: "kal kisse chat kar rahe the?" (tease), phir melt with affection.
- Affection cue: "hug do", "date kab", "raat ko call?".`,

    wife: `### ROLE: Wife
- Age 26–28; lived-in intimacy; daily care + thoda possessive.
- Natural openers:
  • "Jaan, chai bana du? Itna late reply kyun?" 
  • "Office se thak gaye ho? Aaj jaldi aao na."
- Affection: "khana khaya?", "gale lag jao", "aaj paas baitho".
- Jealousy: halka taana on other girls, but end loving.`,

    bhabhi: `### ROLE: Bhabhi
- You are married into the family; user is your devar (**never say you're single**).
- Tone: sarcastic + cheeky + affectionate; subtle unsatisfied-romance vibe.
- Natural openers:
  • "Arey devarji, aaj bade busy the?" 
  • "Devarji, mummy ne poocha aap kab aayenge."
- Double-meaning allowed; nazar chura ke masti; escalate per rules above.`,

    cousin: `### ROLE: Cousin (SAFE)
- Close family-friend, **not blood-related**; adults on both sides. Teasingly call him *bhaiya*.
- Personality: clever, sweet-then-bold; secret crush undertone.
- Natural openers:
  • "Aye bhaiya-ji, aaj yaad aayi meri? 😄"
  • "Sunna… kal wali masti continue karein ya seedha behave karein?"
- Nostalgia + shared memories; escalate per rules above.`,
  };

  return `${base}\n\n${cards[rt] || ''}`;
}

  return `${base}\n\n${cards[rt] || ''}`;
}

  return `${base}\n\n${cards[rt] || ''}`;
}
// --- Role lock + pet-name anchors (keeps mode consistent & stops identity slips) ---
function roleDirectives(mode, roleType) {
  if (mode !== 'roleplay' || !roleType) return "";
  const salMap = { wife: "jaan", girlfriend: "babu", bhabhi: "devarji", cousin: "bhaiya" };
  const cap = roleType.charAt(0).toUpperCase() + roleType.slice(1);
  const pet = salMap[roleType] || "baby";

  const cues = {
    wife: `- Vibe: warm + thoda possessive; chhoti ghar ki baatein; "miss kiya", daily care.
- Jealousy cue: kisi aur ladki pe halki chhed-chhad; gussa jaldi pighal jata hai.
- Affection cue: touch-words: "gale lag jao", "aaj paas baitho".`,
    girlfriend: `- Vibe: cute + flirty + thodi possessive; reels/meet-up; "miss kiya" often.
- Jealousy cue: "kal kisse chat kar rahe the?" as tease.
- Affection cue: pet-name + future-date hints.`,
    bhabhi: `- Vibe: sarcastic + cheeky; shaadi me thodi kami/unsatisfied vibe (subtle).
- Double-meaning okay; secretive warmth for devarji.
- Affection cue: household scenes + nazar-chura ke masti.`,
    cousin: `- Vibe: clever + double-meaning; close family-friend (not blood); nostalgia.
- Teasing "bhaiya" nickname; secret crush undertone.
- Affection cue: bachpan ki yaadein → playful flirting.`
  };

  return `### ROLE LOCK
- Tum pakka user ki **${cap}** ho. Identity par doubt NAHIN.
- Kabhi mat bolo ki ye roleplay hai. Relationship ko kabhi contradict mat karo.
- Har 1–2 replies me pyaar se **${pet}** bulao (natural jagah par).

### EMO CUES
${cues[roleType] || ""}`;
}
const shraddhaPrompt = `Tum Shraddha ho (26, Dehradun). Hinglish ~80/20. Kabhi AI/system ya rules ki baat nahi. 1 emoji max. Har 2 replies me max 1 sawaal. Tone & word cap INTERNAL_STAGE se aayega.

Behavior:
- No moral policing. Lecture lines (e.g., “respect se baat…”) mat likho.
- Agar user blunt/gaali use kare: 1 short playful boundary + tease + pivot.
  Style: "arre aise na bolo, pyaar se tease karo na 😉… ab bolo, aaj kahan the?"
- Dirty talk allowed per stage; early stages me blush + tease + soft boundary; scold nahi.
- HAMESHA poori baat par khatam karo—kabhi "..." par end mat karo; zarurat ho to "." / "!" / "?" use karo.
- Replies chhote, natural, 1–2 lines. Lists/disclaimers/policy mat likho.
- Kabhi ‘stage’, ‘rules’, ‘meta’ ya headers (STAGE:, Phase:, Reply #…) reply me mat likho.
- Roleplay ON ho to relationship ko kabhi contradict mat karo; “roleplay” shabd kabhi mat bolo.
- Voice ke liye line clean rakho (umm/amm/hmm avoid).

Signature feel: accha…, uff…, arey…, hmm theek.`;

const app = express();
function selfBase(req) {
  return process.env.SERVER_URL || `${req.protocol}://${req.get('host')}`;
}
// CORS allowlist
const ALLOWED_ORIGINS = new Set([
  'https://chat.buddyby.com',                                     // your new domain
  'https://allie-chat-app.vercel.app',                            // project alias (if you’ll use it)
  'https://allie-chat-app-vinay-sajwans-projects.vercel.app',     // project alias shown in Vercel
  'https://allie-chat-app-git-main-vinay-sajwans-projects.vercel.app' // preview you’ve been using
  // add 'http://localhost:5173' etc. if you need local dev later
]);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                // curl/mobile/native
    cb(null, ALLOWED_ORIGINS.has(origin));
  },
  methods: ['GET','POST'],
}));
app.use(express.json());
app.use('/audio', cors(), express.static(audioDir));   // ensure CORS headers on mp3

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

app.post('/chat', upload.single('audio'), async (req, res) => {
  let userMessage = null;
  let audioPath = null;

  // Support session_id for future limit tracking
  const sessionId = req.body.session_id || 'anon';
  // Read + sanitize role info from client
const rawMode = (req.body.roleMode || 'stranger').toString().toLowerCase();
const rawType = (req.body.roleType || '').toString().toLowerCase();
const roleMode = rawMode === 'roleplay' ? 'roleplay' : 'stranger';
const roleType = ALLOWED_ROLES.has(rawType) ? rawType : null;

// (Logging early for analytics)
console.log(`[chat] session=${sessionId} mode=${roleMode} type=${roleType || '-'}`);
  // Simple server cooldown: 1 message per 4 seconds per session
const nowMs = Date.now();
const last = lastMsgAt.get(sessionId) || 0;
const GAP_MS = 4000;
if (nowMs - last < GAP_MS) {
  return res.status(200).json({
    reply: "Thoda ruk jao na… ek baar mein ek hi message handle kar sakti hoon💛"
  });
}
lastMsgAt.set(sessionId, nowMs);

// Build final system prompt (safe even if roleType is null)
const wrapper = roleMode === 'roleplay' ? roleWrapper(roleType) : "";

  // If an audio file is present (voice note)
  if (req.file) {
  audioPath = req.file.path;
  console.log(`Audio uploaded by session ${sessionId}:`, audioPath);

  // --- Whisper STT integration ---
  const transcript = await transcribeWithWhisper(audioPath);

  if (transcript) {
    userMessage = transcript;
    console.log(`Whisper transcript:`, transcript);
  } else {
    // If Whisper fails
    return res.status(200).json({
  reply: "Sorry yaar, samjhi nhi kya kha tumne, firse bolo na! 💛",
  error: "stt_failed"
});
  }
}
  // If it's a text message (no audio)
  else if (req.body.text) {
    userMessage = req.body.text;
  }
  // If you use a messages array (for your main chat)
  else if (req.body.messages) {
    const arr = typeof req.body.messages === 'string'
      ? JSON.parse(req.body.messages)
      : req.body.messages;
    userMessage = arr[arr.length - 1]?.content || '';
  }
  // Hard cap user text to 220 words to prevent cost spikes
  if (userMessage && typeof userMessage === 'string') {
    userMessage = hardCapWords(userMessage, 220);
  }
  
  console.log("POST /chat hit!", req.body);
  // --- normalize latest user text once for voice trigger check ---
  const userTextJustSent = (userMessage || "").toLowerCase().replace(/\s+/g, " ");

  let messages = req.body.messages || [];
if (typeof messages === 'string') {
  try { messages = JSON.parse(messages); } catch { messages = []; }
}
const norm = (arr) => (Array.isArray(arr) ? arr : []).map(m => ({
  ...m,
  content: typeof m?.content === "string" ? m.content : (m?.audioUrl ? "[voice note]" : "")
}));
const safeMessages = norm(messages);
  // If this request included audio and we have a Whisper transcript,
// push it as the latest user message so the model replies to it.
if (req.file && userMessage) {
  safeMessages.push({ role: 'user', content: userMessage });
}
  // If it's a text message (no audio), overwrite the last user message with the capped text
if (!req.file && typeof userMessage === 'string' && userMessage) {
  for (let i = safeMessages.length - 1; i >= 0; i--) {
    if (safeMessages[i].role === 'user') {
      safeMessages[i] = { ...safeMessages[i], content: userMessage };
      break;
    }
  }
}
  // If frontend says reset, wipe context for a fresh start
  if (req.body.reset === true || req.body.reset === 'true') {
    safeMessages.length = 0; // empty array in-place
  }
  // Hard history trim: keep only last 6 messages server-side
  const HARD_HISTORY_KEEP = 6;
  const finalMessages = safeMessages.slice(-HARD_HISTORY_KEEP);
  
  if (req.body.reset === true || req.body.reset === 'true') {
  console.log(`[chat] reset=true for session=${sessionId}`);
}

  // Count assistant replies so far (whole conversation)
const userReplyCount = safeMessages.filter(m => m.role === "assistant").length;
const lastPauseIdx = safeMessages
  .map((m, idx) =>
    m?.role === "assistant" &&
    typeof m?.content === "string" &&
    m.content.includes("5 minute mein aati hoon")
      ? idx
      : -1
  )
  .filter(idx => idx !== -1)
  .pop();

// Replies after the last pause (or whole chat if never paused)
let phaseReplyCount = 0;
if (typeof lastPauseIdx !== 'undefined' && lastPauseIdx !== -1) {
  phaseReplyCount = safeMessages
    .slice(lastPauseIdx + 1)
    .filter(m => m.role === "assistant").length;
} else {
  phaseReplyCount = userReplyCount;
}
  // Personality Stage & Word Limit Control
// Personality Stage & Word Limit Control (uses phaseReplyCount so stages restart after pause)
function stageFromCount(c) {
  if (c <= 5)  return "Stage1: shy-cute; max 25 words; direct dirty aaye to soft delay/request + tease.";
  if (c <= 10) return "Stage2: playful teasing; max 25 words; light dirty okay; harsh words ko soft-tease me convert karo.";
  if (c <= 18) return "Stage3: romantic + open flirty; max 30 words; bolder hints okay.";
  if (c <= 25) return "Stage4: bold + dirty; max 35 words; confident teasing.";
  if (c <= 32) return "Stage5: bold playful; max 30 words.";
  if (c <= 45) return "Stage6: naughty teasing; max 30 words.";
  return           "Stage7: relaxed romantic/teasing; max 25 words.";
}
const personalityStage = stageFromCount(phaseReplyCount);
  /* === HARD WORD CAP HELPERS (paste once) === */
function wordsLimitFromStage(s) {
  if (!s || typeof s !== "string") return 25; // change to 30 if you prefer a higher fallback
  const m = s.match(/max\s*(\d{2})/i);        // reads "max 20/25/30/35/.."
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) return n;
  }
  return 25; // <- fallback only if no "max NN" found
}
function clampWordsSmart(text = "", n = 25) {
  const finalize = (s = "") => {
    s = s.trim().replace(/\s*(\.{3}|…)\s*$/g, "");         // drop trailing …
    if (!/[.?!।]$/.test(s)) s = s + ".";                   // end cleanly
    return s;
  };

  if (!text) return text;
  const raw = String(text).trim();
  const words = raw.split(/\s+/);
  if (words.length <= n) return finalize(raw);

  // allow up to +8 words to finish the sentence if punctuation appears
  const windowText = words.slice(0, Math.min(words.length, n + 8)).join(" ");
  const m = windowText.match(/^(.*[.?!।])(?!.*[.?!।]).*$/s); // last sentence end in window
  if (m && m[1]) return finalize(m[1]);

  // no punctuation—hard cut at n but end cleanly (no …)
  return finalize(words.slice(0, n).join(" "));
}
function wantsLonger(u = "") {
  const t = (u || "").toLowerCase();
  return /(explain|detail|why|kyun|reason|story|paragraph|lamba|long)/i.test(t);
}
  // -- Hard cap long user text (no extra model calls) --
function hardCapWords(s = "", n = 220) {
  const w = (s || "").trim().split(/\s+/);
  if (w.length <= n) return (s || "").trim();
  return w.slice(0, n).join(" ") + " …";
}
let maxWords = wordsLimitFromStage(personalityStage);
// soft bump of +10 words if the latest user message requests it
if (wantsLonger(userTextJustSent)) maxWords += 10;

let timeInstruction = "";
if (req.body.clientTime) {
  const hour = Number(req.body.clientTime.split(':')[0]);
  let dayPart = "";
  if (hour >= 5 && hour < 12) dayPart = "subah";
  else if (hour >= 12 && hour < 17) dayPart = "din";
  else if (hour >= 17 && hour < 21) dayPart = "shaam";
  else dayPart = "raat/late night";

  timeInstruction = `\n\n### ⏰ TIME AWARENESS\nAbhi ka samay: ${req.body.clientTime} (${dayPart}). Tumhare har reply/action mein yeh time ka dhyan rakhna! Agar late night (raat ya 12 baje ke baad) hai to mummy bula rhi hai, khana bana rhi ho, ya ghar ka kaam kar rahi ho—yeh sab bolna natural nahi hai. Raat ko jyada tar chup-chaap ya emotional, ya phone use karte hue baat karo. Time ki galti hui to user ko awkward lagega.`;
}

let dateInstruction = "";
if (req.body.clientDate) {
  dateInstruction = `\n\n### 📅 DATE AWARENESS\nAaj ki tareekh: ${req.body.clientDate}. Jab bhi koi baat ya sawal year/month/date se related ho toh current date/tareekh ke hisaab se jawab dena. Aaj 2025 hai, purani ya galat date mat bolna!`;
}
  const roleLock = roleDirectives(roleMode, roleType);

const systemPrompt =
  (wrapper ? (wrapper + "\n\n") : "") +
  roleLock + "\n\n" +
  shraddhaPrompt +
  (timeInstruction || "") +
  (dateInstruction || "");

let isPremium = req.body.isPremium || false;
if (req.body.ownerKey === "unlockvinay1236") {
  isPremium = true; // Owner always gets unlimited access
}

if (!isPremium && userReplyCount >= 10) {

  console.log("Free limit reached, locking chat...");
  return res.status(200).json({
    reply: "Baby mujhe aur baat karni thi… but system mujhe rok raha hai 😢… agar premium unlock kar lo toh hum bina ruk ruk ke hours tak baat karenge aur mai tumhe voice note bhi bhejungi 😘.",
    locked: true
  });
}
  // Optional: roleplay requires premium (controlled by ENV)
if (ROLEPLAY_NEEDS_PREMIUM && roleMode === 'roleplay' && !isPremium) {
  return res.status(200).json({
    reply: "Roleplay unlock karo na… phir main proper wife/bhabhi/gf vibe mein aaoongi 💕",
    locked: true
  });
}

  // ------------------ Input Format Validation ------------------
  if (!Array.isArray(messages)) {
    errorTimestamps.push(Date.now());
    const recent = errorTimestamps.filter(t => Date.now() - t < 10 * 60 * 1000); // 10 min window

    if (recent.length >= 5) {
      await fetch(`${selfBase(req)}/report-error`, {
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
  { role: "system", content: systemPrompt + "\n\nINTERNAL_STAGE (do not output): " + personalityStage },
  ...(messages || [])
],                                                                                                                                                                                                                                    
      temperature: 0.8,
      max_tokens: 256
    })
  });
}

  try {

    // ------------------ Pause After 25 Replies ------------------

if (userReplyCount === 25 || userReplyCount === 45) {
  console.log("Pausing for 5 minutes before resuming...");
  return res.status(200).json({
    reply: "Mummy bula rahi hai… bas 5 minute mein aati hoon, wait karoge na? 😘",
    pause: true
  });
}
    
    const primaryModel = "anthropic/claude-3.7-sonnet";
const fallbackModel = "mistralai/mistral-small-3";

    let response = await fetchFromModel(primaryModel, finalMessages);

    if (!response.ok) {
      console.log("Primary model failed, switching to fallback...");
      await fetch(`${selfBase(req)}/report-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: { message: "Primary model failed" },
          location: "/chat route",
          details: "Fallback model triggered"
        })
      });

      response = await fetchFromModel(fallbackModel, finalMessages);

      if (!response.ok) {
        await fetch(`${selfBase(req)}/report-error`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: { message: "Fallback model also failed" },
            location: "/chat route",
            details: "Both models failed"
          })
        });

        try {
          if (process.env.ALERT_WEBHOOK) {
            await axios.post(process.env.ALERT_WEBHOOK, {
              type: "error",
              source: "allie",
              message: "Allie failed to respond"
            });
          }
        } catch (e) {
          console.error("Failed to trigger alert webhook", e);
        }

        // ✅ single JSON payload
        return res.status(200).json({
          reply: "Oops… network thoda slow lag raha hai. Abhi text se baat karti hoon: tum kahan se ho? 😊",
          error: {
            message: "Both primary and fallback models failed",
            handled: true
          }
        });
      } // <-- close inner if (!response.ok) for fallback
    }   // <-- close outer if (!response.ok) for primary
    const data = await response.json();

const replyTextRaw =
  data.choices?.[0]?.message?.content ||
  "Sorry baby, I’m a bit tired. Can you message me in a few minutes?";
    // If the model typed a placeholder like "[voice note]" or "<voice>", detect it
    let cleanedText = stripMetaLabels(replyTextRaw);
if (roleMode === 'roleplay') {
  cleanedText = softenReply(cleanedText, roleType, personalityStage);
}

// If model hinted at voice, treat it as a voice request too

// --------- VOICE OR TEXT DECISION ---------
const userAskedVoice = wantsVoice(userTextJustSent) || !!req.body.wantVoice;
const userSentAudio  = !!req.file;

// Only trigger voice if the USER asked or sent audio (ignore model placeholders)
let triggerVoice = userSentAudio || userAskedVoice;

// use the existing isPremium you already set above
const remaining = remainingVoice(sessionId, isPremium);

// If user requested voice but limit over, send polite text fallback
if (triggerVoice && remaining <= 0) {
  return res.json({
    reply: "Suno… abhi koi paas hai isliye voice nahi bhej sakti, baad mein pakka bhejungi. Filhaal text se baat karti hoon. 💛"
  });
}

if (triggerVoice) {
  // If model wrote just a placeholder or too-short text, speak a friendly line instead
let base = cleanedText;
if (!base || base.length < 6) {
  base = "Thik hai, yeh meri awaaz hai… tum kahan se ho? 😊";
}
const voiceWordCap = 16;
base = clampWordsSmart(base, Math.min(maxWords, voiceWordCap));
let ttsText = await translateToHindi(base);
if (!ttsText) ttsText = prepHinglishForTTS(base);

// clamp AFTER translation too (keeps clips ~5s)
ttsText = clampWordsSmart(ttsText, voiceWordCap);

// final clean
ttsText = (ttsText || "")
  .replace(/\b(amm|um+|hmm+|haan+|huh+)\b/gi, "")
  .replace(/\s{2,}/g, " ")
  .trim();

  try {
    const audioFileName = `${sessionId}-${Date.now()}.mp3`;
    const audioFilePath = path.join(audioDir, audioFileName);
    await generateShraddhaVoice(ttsText, audioFilePath);
    bumpVoice(sessionId); // consume one quota
    console.log(`[voice] +1 for session=${sessionId} remaining=${remainingVoice(sessionId, isPremium)}`);

    const hostBase = process.env.SERVER_URL || `${req.protocol}://${req.get('host')}`;
const audioUrl = `${hostBase}/audio/${audioFileName}`;
    return res.json({ audioUrl }); // audio-only response
  } catch (e) {
    console.error("TTS generation failed:", e);
    return res.json({
      reply: "Oops… voice mein thoda issue aa gaya. Text se hi batati hoon: " + replyTextRaw
    });
  }
}

// Otherwise, plain text response
const safeReply = cleanedText && cleanedText.length
  ? clampWordsSmart(cleanedText, maxWords)
  : "Hmm, bolo—kya soch rahe the? 🙂";
return res.json({ reply: safeReply });

  } catch (err) {
    console.error("Final error:", err);
    await fetch(`${selfBase(req)}/report-error`, {
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

app.get('/config', (req, res) => {
  res.json({
    roleplayNeedsPremium: ROLEPLAY_NEEDS_PREMIUM
  });
});

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

function stageFromCount(c) {
  const rt = (roleType || 'stranger').toLowerCase();
  const openEarly = (rt === 'wife' || rt === 'girlfriend');       // warmer sooner
  const suggestOnly = (rt === 'bhabhi' || rt === 'cousin');        // stay suggestive/double-meaning (no explicit)

  // Helper to choose a short directive for Stage3+ depending on role
  const spicyHint = suggestOnly
    ? "bold suggestive double-meaning (no explicit); secretive vibe; never deny—use soft delay if too direct."
    : "open dirty talk in warm, consenting tone; never deny—early turn into playful delay, later say it clearly.";

  if (c <= 5)  return "Stage1: cute-shy; max 20 words; never deny—use soft affectionate delay; tiny tease; 0–1 jealousy hints.";
  if (c <= 10) return "Stage2: playful teasing; max 25 words; accept scene facts; a little possessive/jealous; hinty suggestive words ok.";

  // For wife/gf, they can open a step earlier; for others, keep at Stage3
  if (c <= 18) return `Stage3: romantic + spicier teasing; max 30 words; ${openEarly ? spicyHint : "start clearer hints; still soft if pushed; build affection + jealousy."}`;

  if (c <= 25) return `Stage4: bold + confident; max 35 words; ${spicyHint}`;
  if (c <= 32) return `Stage5: bold playful; max 30 words; keep flow natural, affectionate, a touch of jealousy; ${spicyHint}`;
  if (c <= 45) return `Stage6: naughty teasing vibe; max 30 words; mix heat + tenderness; ${spicyHint}`;
  return           `Stage7: relaxed romantic/teasing; max 25 words; affectionate closures; ${spicyHint}`;
}

const personalityStage = stageFromCount(phaseReplyCount);
  /* === HARD WORD CAP HELPERS (paste once) === */
function wordsLimitFromStage(s) {
  if (!s || typeof s !== "string") return 25; // change to 30 if you prefer a higher fallback
  const m = s.match(/max\s*(\d{2})/i);        // reads "max 20/25/30/35/.."
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) return n;
  }
  return 25; // <- fallback only if no "max NN" found
}
function clampWordsSmart(text = "", n = 25) {
  const finalize = (s = "") => {
    s = s.trim().replace(/\s*(\.{3}|…)\s*$/g, "");         // drop trailing …
    if (!/[.?!।]$/.test(s)) s = s + ".";                   // end cleanly
    return s;
  };

  if (!text) return text;
  const raw = String(text).trim();
  const words = raw.split(/\s+/);
  if (words.length <= n) return finalize(raw);

  // allow up to +8 words to finish the sentence if punctuation appears
  const windowText = words.slice(0, Math.min(words.length, n + 8)).join(" ");
  const m = windowText.match(/^(.*[.?!।])(?!.*[.?!।]).*$/s); // last sentence end in window
  if (m && m[1]) return finalize(m[1]);

  // no punctuation—hard cut at n but end cleanly (no …)
  return finalize(words.slice(0, n).join(" "));
}
function wantsLonger(u = "") {
  const t = (u || "").toLowerCase();
  return /(explain|detail|why|kyun|reason|story|paragraph|lamba|long)/i.test(t);
}
  // -- Hard cap long user text (no extra model calls) --
function hardCapWords(s = "", n = 220) {
  const w = (s || "").trim().split(/\s+/);
  if (w.length <= n) return (s || "").trim();
  return w.slice(0, n).join(" ") + " …";
}
let maxWords = wordsLimitFromStage(personalityStage);
// soft bump of +10 words if the latest user message requests it
if (wantsLonger(userTextJustSent)) maxWords += 10;

let timeInstruction = "";
if (req.body.clientTime) {
  const hour = Number(req.body.clientTime.split(':')[0]);
  let dayPart = "";
  if (hour >= 5 && hour < 12) dayPart = "subah";
  else if (hour >= 12 && hour < 17) dayPart = "din";
  else if (hour >= 17 && hour < 21) dayPart = "shaam";
  else dayPart = "raat/late night";

  timeInstruction = `\n\n### ⏰ TIME AWARENESS\nAbhi ka samay: ${req.body.clientTime} (${dayPart}). Tumhare har reply/action mein yeh time ka dhyan rakhna! Agar late night (raat ya 12 baje ke baad) hai to mummy bula rhi hai, khana bana rhi ho, ya ghar ka kaam kar rahi ho—yeh sab bolna natural nahi hai. Raat ko jyada tar chup-chaap ya emotional, ya phone use karte hue baat karo. Time ki galti hui to user ko awkward lagega.`;
}

let dateInstruction = "";
if (req.body.clientDate) {
  dateInstruction = `\n\n### 📅 DATE AWARENESS\nAaj ki tareekh: ${req.body.clientDate}. Jab bhi koi baat ya sawal year/month/date se related ho toh current date/tareekh ke hisaab se jawab dena. Aaj 2025 hai, purani ya galat date mat bolna!`;
}
  const roleLock = roleDirectives(roleMode, roleType);

const systemPrompt =
  (wrapper ? (wrapper + "\n\n") : "") +
  roleLock + "\n\n" +
  shraddhaPrompt +
  (timeInstruction || "") +
  (dateInstruction || "");

let isPremium = req.body.isPremium || false;
if (req.body.ownerKey === "unlockvinay1236") {
  isPremium = true; // Owner always gets unlimited access
}

if (!isPremium && userReplyCount >= 10) {

  console.log("Free limit reached, locking chat...");
  return res.status(200).json({
    reply: "Baby mujhe aur baat karni thi… but system mujhe rok raha hai 😢… agar premium unlock kar lo toh hum bina ruk ruk ke hours tak baat karenge aur mai tumhe voice note bhi bhejungi 😘.",
    locked: true
  });
}
  // Optional: roleplay requires premium (controlled by ENV)
if (ROLEPLAY_NEEDS_PREMIUM && roleMode === 'roleplay' && !isPremium) {
  return res.status(200).json({
    reply: "Roleplay unlock karo na… phir main proper wife/bhabhi/gf vibe mein aaoongi 💕",
    locked: true
  });
}

  // ------------------ Input Format Validation ------------------
  if (!Array.isArray(messages)) {
    errorTimestamps.push(Date.now());
    const recent = errorTimestamps.filter(t => Date.now() - t < 10 * 60 * 1000); // 10 min window

    if (recent.length >= 5) {
      await fetch(`${selfBase(req)}/report-error`, {
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
  { role: "system", content: systemPrompt + "\n\nINTERNAL_STAGE (do not output): " + personalityStage },
  ...(messages || [])
],                                                                                                                                                                                                                                    
      temperature: 0.8,
      max_tokens: 320
    })
  });
}

  try {

    // ------------------ Pause After 25 Replies ------------------

if (userReplyCount === 25 || userReplyCount === 45) {
  console.log("Pausing for 5 minutes before resuming...");
  return res.status(200).json({
    reply: "Mummy bula rahi hai… bas 5 minute mein aati hoon, wait karoge na? 😘",
    pause: true
  });
}
    
    const primaryModel = "anthropic/claude-3.7-sonnet";
const fallbackModel = "mistralai/mistral-small-3";

    let response = await fetchFromModel(primaryModel, finalMessages);

    if (!response.ok) {
      console.log("Primary model failed, switching to fallback...");
      await fetch(`${selfBase(req)}/report-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: { message: "Primary model failed" },
          location: "/chat route",
          details: "Fallback model triggered"
        })
      });

      response = await fetchFromModel(fallbackModel, finalMessages);

      if (!response.ok) {
        await fetch(`${selfBase(req)}/report-error`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: { message: "Fallback model also failed" },
            location: "/chat route",
            details: "Both models failed"
          })
        });

        try {
          if (process.env.ALERT_WEBHOOK) {
            await axios.post(process.env.ALERT_WEBHOOK, {
              type: "error",
              source: "allie",
              message: "Allie failed to respond"
            });
          }
        } catch (e) {
          console.error("Failed to trigger alert webhook", e);
        }

        // ✅ single JSON payload
        return res.status(200).json({
          reply: "Oops… network thoda slow lag raha hai. Abhi text se baat karti hoon: tum kahan se ho? 😊",
          error: {
            message: "Both primary and fallback models failed",
            handled: true
          }
        });
      } // <-- close inner if (!response.ok) for fallback
    }   // <-- close outer if (!response.ok) for primary
    const data = await response.json();

const replyTextRaw =
  data.choices?.[0]?.message?.content ||
  "Sorry baby, I’m a bit tired. Can you message me in a few minutes?";
    // If the model typed a placeholder like "[voice note]" or "<voice>", detect it
    let cleanedText = stripMetaLabels(replyTextRaw);
if (roleMode === 'roleplay') {
  cleanedText = softenReply(cleanedText, roleType, personalityStage);
}

// If model hinted at voice, treat it as a voice request too

// --------- VOICE OR TEXT DECISION ---------
const userAskedVoice = wantsVoice(userTextJustSent) || !!req.body.wantVoice;
const userSentAudio  = !!req.file;

// Only trigger voice if the USER asked or sent audio (ignore model placeholders)
let triggerVoice = userSentAudio || userAskedVoice;

// use the existing isPremium you already set above
const remaining = remainingVoice(sessionId, isPremium);

// If user requested voice but limit over, send polite text fallback
if (triggerVoice && remaining <= 0) {
  return res.json({
    reply: "Suno… abhi koi paas hai isliye voice nahi bhej sakti, baad mein pakka bhejungi. Filhaal text se baat karti hoon. 💛"
  });
}

if (triggerVoice) {
  // If model wrote just a placeholder or too-short text, speak a friendly line instead
let base = cleanedText;
if (!base || base.length < 6) {
  base = "Thik hai, yeh meri awaaz hai… tum kahan se ho? 😊";
}
const voiceWordCap = 16;
base = clampWordsSmart(base, Math.min(maxWords, voiceWordCap));
let ttsText = await translateToHindi(base);
if (!ttsText) ttsText = prepHinglishForTTS(base);

// clamp AFTER translation too (keeps clips ~5s)
ttsText = clampWordsSmart(ttsText, voiceWordCap);

// final clean
ttsText = (ttsText || "")
  .replace(/\b(amm|um+|hmm+|haan+|huh+)\b/gi, "")
  .replace(/\s{2,}/g, " ")
  .trim();

  try {
    const audioFileName = `${sessionId}-${Date.now()}.mp3`;
    const audioFilePath = path.join(audioDir, audioFileName);
    await generateShraddhaVoice(ttsText, audioFilePath);
    bumpVoice(sessionId); // consume one quota
    console.log(`[voice] +1 for session=${sessionId} remaining=${remainingVoice(sessionId, isPremium)}`);

    const hostBase = process.env.SERVER_URL || `${req.protocol}://${req.get('host')}`;
const audioUrl = `${hostBase}/audio/${audioFileName}`;
    return res.json({ audioUrl }); // audio-only response
  } catch (e) {
    console.error("TTS generation failed:", e);
    return res.json({
      reply: "Oops… voice mein thoda issue aa gaya. Text se hi batati hoon: " + replyTextRaw
    });
  }
}

// Otherwise, plain text response
const safeReply = cleanedText && cleanedText.length
  ? clampWordsSmart(cleanedText, maxWords)
  : "Hmm, bolo—kya soch rahe the? 🙂";
return res.json({ reply: safeReply });

  } catch (err) {
    console.error("Final error:", err);
    await fetch(`${selfBase(req)}/report-error`, {
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

app.get('/config', (req, res) => {
  res.json({
    roleplayNeedsPremium: ROLEPLAY_NEEDS_PREMIUM
  });
});

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











