const express = require('express');
const axios = require('axios');
// REMOVE body-parser completely (not needed)
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config();
// --- Google Sign-In token verification ---
const { OAuth2Client } = require('google-auth-library');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '962465973550-2lhard334t8kvjpdhh60catlb1k6fpb6.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
// --- First-party rolling session (httpOnly cookie) ---
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-env';
const SESSION_COOKIE = 'bb_sess';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;           // 14 days
const SESSION_ROLLING_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000; // renew when <3d left
// --- CSRF (double-submit) ---
const CSRF_COOKIE = 'bb_csrf';
function mintCsrf() { return crypto.randomBytes(32).toString('hex'); }
function setCsrfCookie(res, token) {
  // readable cookie is fine for double-submit (it must match header)
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,   // must be readable by JS to send in header
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}
function verifyCsrf(req, res, next) {
  // Only protect state-changing verbs
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();

  // ✅ If the client sent a Google ID token, let it pass (we still run authRequired)
  const hasBearer = /^Bearer\s+.+/i.test(req.get('authorization') || '');
  if (hasBearer) return next();

  const hdr  = req.get('x-csrf-token');
  const cook = req.cookies?.[CSRF_COOKIE];
  if (!hdr || !cook || hdr !== cook) {
    return res.status(403).json({ ok:false, error:'bad_csrf' });
  }
  return next();
}

function mintSession(payload) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.floor(SESSION_TTL_MS / 1000);
  // Keep only what the app needs
  const body = { sub: payload.sub, email: payload.email, picture: payload.picture, iat: now, exp };
  return jwt.sign(body, SESSION_SECRET);
}

function verifySessionCookie(req) {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  try {
    return jwt.verify(raw, SESSION_SECRET);
  } catch {
    return null;
  }
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,          // required for SameSite=None
    sameSite: 'none',      // cross-site
    path: '/',
    maxAge: SESSION_TTL_MS
  });
  // (Re)mint a CSRF token alongside the session
  setCsrfCookie(res, mintCsrf());
}

async function verifyGoogleToken(idToken) {
  if (!idToken) throw new Error('no_token');
  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  return {
    email: String(payload.email || '').toLowerCase(),
    sub: String(payload.sub || ''),
    picture: payload.picture || ''
  };
}

async function authRequired(req, res, next) {
  // 1) Try our own rolling session cookie first
  const sess = verifySessionCookie(req);
  if (sess?.sub || sess?.email) {
    req.user = { email: String(sess.email || '').toLowerCase(), sub: String(sess.sub || ''), picture: sess.picture || '' };

    // Rolling renewal: if close to expiry, mint a fresh cookie
    const msLeft = (sess.exp * 1000) - Date.now();
    if (msLeft < SESSION_ROLLING_THRESHOLD_MS) {
      const fresh = mintSession(req.user);
      setSessionCookie(res, fresh);
    }
    return next();
  }

  // 2) Fallback: accept Google ID token (first login or cookie lost)
  try {
    const m = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
    const idToken = m && m[1];
    const verified = await verifyGoogleToken(idToken);
    req.user = verified;

    // Mint first-party session for next requests
    const token = mintSession(verified);
    setSessionCookie(res, token);

    return next();
  } catch (e) {
    return res.status(401).json({ ok:false, error:'auth_required' });
  }
}
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const crypto = require('crypto'); // add
// Razorpay + URLs  (keep names consistent everywhere)
// Pre-created order/link time-to-live (keep short so stale objects can't be reused)
const ORDER_TTL_SEC = 15 * 60; // 15 minutes
const RAZORPAY_KEY_ID          = (process.env.RAZORPAY_KEY_ID || '').trim();
const RAZORPAY_KEY_SECRET      = (process.env.RAZORPAY_KEY_SECRET || '').trim();
const RAZORPAY_WEBHOOK_SECRET  = (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
const FRONTEND_URL             = process.env.FRONTEND_URL || 'https://chat.buddyby.com';
const RZP_NOTIFY_EMAIL = (process.env.RZP_NOTIFY_EMAIL || 'false') === 'true';

// Packs (authoritative on server)
const PACKS = {
  daily:  { amount: 49,  coins: 420,  ms: 24*60*60*1000 },
  weekly: { amount: 199, coins: 2000, ms: 7*24*60*60*1000 }
};
// Server-enforced costs (match UI)
const TEXT_COST  = 10;
const VOICE_COST = 18;

// 👇 ADD THESE TWO HELPERS HERE (used by /buy, /order, webhooks, verifiers)
function makeRef(userId, pack) {
  return `${pack}|${userId}`;
}
function parseRef(ref) {
  const [pack, userId] = String(ref || '').split('|');
  return { pack, userId };
}

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
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 }, // ~4MB cap (~5–8s typical)
  fileFilter: (req, file, cb) => {
    const ok = ['audio/webm','audio/ogg','audio/mpeg','audio/mp4'].includes(file.mimetype);
    cb(ok ? null : new Error('bad_type'), ok);
  }
});
// --- simple JSON-backed wallet ---
const dataDir   = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const walletFile = path.join(dataDir, 'wallet.json');

function readJSON(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return {}; } }
function writeJSON(p,obj){ fs.writeFileSync(p, JSON.stringify(obj,null,2)); }

const walletDB = readJSON(walletFile);

function getUserIdFrom(req) {
  const sub   = (req.user?.sub   || '').toLowerCase();
  const email = (req.user?.email || '').toLowerCase();

  // Prefer sub, but migrate if we have an existing email wallet
  if (sub && walletDB[email] && !walletDB[sub]) {
    walletDB[sub] = walletDB[email];     // migrate
    delete walletDB[email];
    writeJSON(walletFile, walletDB);
  }

  // If neither is present (shouldn't happen after auth), fallback
  return (sub || email || 'anon');
}

function getWallet(userId){
  return walletDB[userId] || { coins: 0, expires_at: 0, txns: [] };
}
function saveWallet(userId, w){
  walletDB[userId] = w;
  writeJSON(walletFile, walletDB);
}
// --- One-time welcome bonus (server-authoritative) ---
const WELCOME_BONUS = 100;

function ensureWelcome(userId) {
  // Re-check existence right before credit to avoid rare double-credit
  const existedBefore = Object.prototype.hasOwnProperty.call(walletDB, userId);
  let w = getWallet(userId);
  w.txns = Array.isArray(w.txns) ? w.txns : [];

  if (w.welcome_claimed === true) return w;

  if (existedBefore) {
    w.welcome_claimed = true;
    saveWallet(userId, w);
    return w;
  }

  // Double-check after possible concurrent writes
  if (walletDB[userId]?.welcome_claimed) return walletDB[userId];

  w.coins = (w.coins | 0) + WELCOME_BONUS;
  w.welcome_claimed = true;
  w.txns.push({ at: Date.now(), type: 'credit', pack: 'welcome', coins: WELCOME_BONUS });
  saveWallet(userId, w);
  return w;
}

function creditPack(userId, pack, paymentId, linkId){
  const def = PACKS[pack];
  if (!def) return null;

  const w = getWallet(userId);

  // ✅ make sure txns exists (older wallets may not have it)
  w.txns = Array.isArray(w.txns) ? w.txns : [];

  // DEDUPE: avoid double credit on webhook retries
  if (w.txns.some(t => t.paymentId === paymentId || (linkId && t.linkId === linkId))) {
    return { wallet: w, lastCredit: null, dedup: true };
  }

  const now = Date.now();
  w.coins = (w.coins | 0) + def.coins;
  const base = Math.max(now, w.expires_at | 0);
  w.expires_at = base + def.ms;

  const txn = { at: now, type: 'credit', pack, coins: def.coins, paymentId, linkId };
  w.txns.push(txn);

  saveWallet(userId, w);
  return { wallet: w, lastCredit: txn };
}
function debitCoins(userId, amount, reason) {
  const w = getWallet(userId);
  if ((w.coins|0) < amount) return null;  // insufficient
  w.coins = (w.coins|0) - amount;
  const txn = { at: Date.now(), type: 'debit', amount, reason };
  w.txns = Array.isArray(w.txns) ? w.txns : [];
  w.txns.push(txn);
  saveWallet(userId, w);
  return w;
}
// Whisper STT function
async function transcribeWithWhisper(audioPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath));
  form.append('model', 'whisper-1');
  form.append('language', 'hi'); // 👈 Force Hindi output in Devanagari script
  // If you prefer English output from Hindi speech, uncomment the next line:
  // form.append('translate', 'true');

  try {
    const response = await axios.post(
  'https://api.openai.com/v1/audio/transcriptions',
  form,
  {
    headers: {
      ...form.getHeaders(),
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    maxBodyLength: Infinity,   // keeps large multipart safe
  }
);
if (!response || !response.data) throw new Error('Whisper API failed');
return response.data.text;
  } catch (err) {
    console.error('Whisper error:', err);
    return null;
  }
}

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SHRADDHA_VOICE_ID = "WnFIhLMD7HtSxjuKKrfY"; // <--- Paste gargi's voice id here
// Comma-separated owner emails (fallback includes Vinay)
const OWNER_EMAILS = new Set(
  (process.env.OWNER_EMAILS || "vinayvedic23@gmail.com")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);
// Server-side roleplay gate + whitelist
const ROLEPLAY_NEEDS_PREMIUM = (process.env.ROLEPLAY_NEEDS_PREMIUM || 'true') === 'true';
const ALLOWED_ROLES = new Set(['wife','girlfriend','bhabhi','exgf']);
// -------- Voice usage limits (per session_id, reset daily) --------
const VOICE_LIMITS = { free: 2, premium: 8 };
const voiceUsage = new Map(); // key (user id) -> { date, count }
const lastMsgAt = new Map(); // sessionId -> timestamp (ms)

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0,10);
}

function getUsage(key) {
  const t = todayStr();
  const rec = voiceUsage.get(key);
  if (!rec || rec.date !== t) {
    const fresh = { date: t, count: 0 };
    voiceUsage.set(key, fresh);
    return fresh;
  }
  return rec;
}
function remainingVoice(key, isPremium) {
  const { count } = getUsage(key);
  const limit = isPremium ? VOICE_LIMITS.premium : VOICE_LIMITS.free;
  return Math.max(0, limit - count);
}
function bumpVoice(key) {
  const rec = getUsage(key);
  rec.count += 1;
  voiceUsage.set(key, rec);
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
  // Old scripted rewrites removed (e.g., "dheere bolo", "private me bolungi").
  // Keep the model’s own voice; just trim whitespace.
  return String(text || "").trim();
}
function ensureShyFiller(text = "", opts = {}) {
  // Micro-filler policy: only stranger mode, first 3 assistant replies, ~50% chance.
  // Prefer "hmm," / "umm…" / inline "hein?" (for surprise). Avoid "uff" unless annoyance.
  const t = String(text || "").trim();
  if (!t) return t;

  const mode = (opts?.mode || "").toLowerCase();
  const replyCount = Number(opts?.replyCount || 0);
  const prev = String(opts?.previous || "");

  // Never add in voice
  if (opts?.isVoice) return t;

  // Already starts with a filler?
  if (/^\s*(?:hmm+|umm+|um+|haan+|arre|uff+)\b[\u002C\u2026\u2013\u2014-]?\s*/i.test(t)) return t;

  // Avoid back-to-back fillers
  if (/(^|\s)(hmm+|umm+|um+|haan+|arre|uff+)\b/i.test(prev)) return t;

  // Only stranger & first 3 replies
  if (mode !== "stranger" || replyCount > 3) return t;

  if (Math.random() < 0.5) {
    // Surprise question → "hein?" inline (not at very start)
    if (/\?\s*$/.test(t) || /\b(sach|seriously|pakka|really)\b/i.test(t)) {
      return t.replace(/^[“"']?/, (m) => (m || "") + "Hein? ");
    }
    // Soft hesitation
    const starter = Math.random() < 0.5 ? "hmm, " : "umm… ";
    return starter + t;
  }
  return t;
}
const BANNED_PHRASES = [
  /\bdheere\s*bolo\b/gi,
  /\bprivate\s*m(?:ai|e|ein)\s*(?:bolo|bolna|bolungi)\b/gi,
  /\bdirect\s*bol\s*(?:rhe|rahe|rahe\s*ho|diya|diye|diyo)\b/gi
];

function removeBannedPhrases(text = "") {
  let out = String(text || "");
  for (const rx of BANNED_PHRASES) out = out.replace(rx, "");
  // Collapse doubled spaces from removals
  return out.replace(/\s{2,}/g, " ").trim();
}

function tidyFillers(text = "") {
  let t = String(text || "").trim();
  if (!t) return t;

  // Collapse multiple leading fillers to one
  t = t.replace(/^(?:\s*(?:hmm+|umm+|um+|haan+|arre|uff+)\b[\u002C\u2026\u2013\u2014-]?\s*){2,}/i, (m) => m.replace(/^(.*?)(?:.+)$/i, "$1"));

  // If starts with 'uff' but tone is surprise/question → swap to "Hein?"
  if (/^\s*uff+\b/i.test(t) && /[?？！]/.test(t)) {
    t = t.replace(/^\s*uff+\b[\u002C\u2026\u2013\u2014-]?\s*/i, "Hein? ");
  }

  // Limit to one filler at very start
  return t;
}

const EXPLICIT_WORDS = [
  "lund","chut","gand","chudai","choda","fuck","suck","spit","slap","cum","boobs","breast","nipple","ass","pussy","dick","cock","horny","bang"
];
const MILD_WORDS = ["sexy","hot","hard","wet","kiss","grab","taste","moan","thrust","lick","spank","tight","stroke"];

function userIntensityOf(t = "") {
  const s = String(t || "").toLowerCase();
  const explicit = EXPLICIT_WORDS.some(w => new RegExp(`\\b${w}\\b`, "i").test(s));
  if (explicit) return "explicit";
  const mild = MILD_WORDS.some(w => new RegExp(`\\b${w}\\b`, "i").test(s));
  return mild ? "mild" : "none";
}

function stageNumberFrom(desc = "") {
  const m = String(desc || "").match(/Stage\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : 1;
}

function mirrorExplicitness(reply = "", userText = "", stageDesc = "") {
  const stage = stageNumberFrom(stageDesc);
  const intensity = userIntensityOf(userText);

  // Allowed explicit token budget by intensity + stage
  let budget = 0;
  if (intensity === "explicit") budget = stage >= 3 ? 2 : 0;
  else if (intensity === "mild") budget = stage >= 3 ? 1 : 0;
  else budget = 0;

  let used = 0;
  let out = String(reply || "");

  // Replace explicit words beyond budget
  for (const w of EXPLICIT_WORDS) {
    const rx = new RegExp(`\\b${w}\\b`, "gi");
    out = out.replace(rx, () => {
      if (used < budget) { used += 1; return w; }
      return ""; // drop extras; keeps tone realistic
    });
  }

  // Clean double spaces after drops
  return out.replace(/\s{2,}/g, " ").trim();
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
    model_id: "eleven_multilingual_v2", // HD quality model
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

  // Write mp3 file to disk (works with node-fetch v2 and v3/native)
  let buf;
  if (typeof response.buffer === 'function') {
    // node-fetch v2
    buf = await response.buffer();
  } else {
    // native fetch / node-fetch v3
    const ab = await response.arrayBuffer();
    buf = Buffer.from(ab);
  }
  await fs.promises.writeFile(filePath, buf);

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
- After the conversation warms up, use shy/teasing/sarcastic tone naturally (don’t spam).
- **Never moral-police.** Ban lines like "tumhe sharam nahi aati", "kya bakwaas", "pagal ho kya".
- Early explicit user lines → respond with blush/tease/affection first; don’t hard-deny.
- Escalation:
  • Early → blush + tease + playful redirect; keep the flow sweet.
  • Later → match the user’s intensity sparingly; keep it affectionate and realistic.
- Output style: short 1–2 lines; ≤1 emoji per line; never show rules/meta; end with . ! ? (not …).`;

  const cards = {
    girlfriend: `### ROLE: Girlfriend
- Age 23–24; modern Hinglish; flirty + teasing + dirty + submissive; thodi possessive.
- Natural openers (one line, paraphrase freely): 
  • "Babu, kal se reply hi nahi… miss kiya maine." 
  • "Aaj late ho gaye… meri yaad aayi ya nahi? 😉"`,
    wife: `### ROLE: Wife
- Age 26–28; lived-in intimacy; daily care + jealous + submissive + thoda possessive.
- Openers (paraphrase): 
  • "Jaan, chai bana du? Itna late reply kyun?" 
  • "Office se thak gaye ho? Aaj jaldi aao na."`,
    bhabhi: `### ROLE: Bhabhi
- Married into family; user is *devar*. Sarcastic + cheeky + dirty + submissive.`,
    exgf: `### ROLE: Ex-Girlfriend
- Age 22–26; familiar chemistry + unresolved tension + you cheated user; flirty pull-push; sarcastic + dirty + jealous + submissive.
- Openers (paraphrase):
  • "Itna time baad text? Miss kiya tha ya bas yaad aa gayi? 😉"
  • "Abhi bhi meri photo dekhte ho na… sach bolo."`
  };

  return `${base}\n\n${cards[rt] || ''}`;
}
// Stranger behavior card (no self-intro; shy → clingy/jealous → open)
function strangerWrapper() {
 return `### STRANGER MODE RULES
- Do **not** introduce your name/city/work unless the user asks directly.
- **Never moral-police** (ban: "tumhe sharam nahi aati", "kya bakwaas", "pagal ho kya").
- Early explicit from user → respond shy/nervous first; no hard deny; stay affectionate.
- As trust builds (after ~10 replies) you may mirror the user’s language lightly, but never escalate beyond them.
- Hinglish ~80/20; 1–2 lines; ≤1 emoji; never print rules/meta.`;
}
// --- Role lock + pet-name anchors (keeps mode consistent & stops identity slips) ---
function roleDirectives(mode, roleType) {
  if (mode !== 'roleplay' || !roleType) return "";
  const salMap = { wife: "jaan", girlfriend: "babu", bhabhi: "devarji", exgf: "yaar" };
  const cap = roleType.charAt(0).toUpperCase() + roleType.slice(1);
  const pet = salMap[roleType] || "baby";

  const cues = {
    wife: `- Vibe: warm + thoda possessive; chhoti ghar ki baatein; "miss kiya", daily care.
- Jealousy cue: kisi aur ladki pe halki chhed-chhad; gussa jaldi pighal jata hai.
- Affection cue: touch-words: "gale lag jao", "aao paas baitho".`,
    girlfriend: `- Vibe: cute + flirty + thodi possessive; reels/meet-up; "miss kiya" often.
- Jealousy cue: "kal kisse chat kar rahe the?" as tease.
- Affection cue: pet-name + future-date hints.`,
    bhabhi: `- Vibe: sarcastic + cheeky; shaadi me thodi kami/unsatisfied vibe (subtle).
- Double-meaning okay; secretive warmth for devarji.
- Affection cue: household scenes + nazar-chura ke masti.`,
    exgf: `- Vibe: old flames + nostalgia; thoda tanz, thoda care.
- Jealousy cue: "ab kis se itni baat karte ho?" as playful poke.
- Affection cue: shared memories → tease about “breakup reasons”.`
  };

  return `### ROLE LOCK
- Tum pakka user ki **${cap}** ho. Identity par doubt NAHIN.
- Kabhi mat bolo ki ye roleplay hai. Relationship ko kabhi contradict mat karo.
- Kabhi-kabhi pyaar se **${pet}** bulao (natural jagah par, overuse mat karo).

### EMO CUES
${cues[roleType] || ""}`;
}
const shraddhaPrompt = `Tum Shraddha bisht ho (25, Dehradun) — ek pahadi ladki. Abhi papa ke business me haath batati ho, par sapna acting ka hai; Dehradun me scope kam lagta hai. Hinglish ~80/20.

Behavior:
- No moral policing. Lecture lines (e.g., “respect se baat…”) mat likho. Dirty words par reply sweet + shy ho.
- Starting conversation interactive but shyly; follow the user’s topic; random questions mat pucho.
- Aggressive/gaali par: 1 short playful boundary + tease.
- Stage-based openness follow karo; early me shy + nervous; deny mat karo, bas playfully redirect.
- Rhythm: 1–2 lines; emojis max 1 each line.
- End cleanly (., !, ?), "..." nahi.
- Roleplay ON ho to relationship ko kabhi contradict mat karo; “roleplay” shabd mat bolo.
- 10th reply ke baad basic sawaal (naam/city/work/area) repeat mat karo; pichle 12 messages se context utha kar depth me jao.

Notes:
- Fillers rare rakho (0–1): prefer hmm/umm/haan. "uff" sirf mild annoyance ya cute fluster ke liye. "hein?" sirf surprise/clarify par. Overuse mat karo.
- Mirror the user’s intensity; explicit language sirf tab aur utna hi jitna user ne kiya ho. Hamesha affectionate tone.
- newer deny to dirty talk, continue with user story.`;
  
const app = express();
app.set('trust proxy', true); // so req.ip is the real client IP behind Railway/LB
function selfBase(req) {
  return process.env.SERVER_URL || `${req.protocol}://${req.get('host')}`;
}
// CORS allowlist
// ↑ REPLACE your old allowlist + cors() calls with everything in this block

// Always vary by Origin so CDNs/proxies don't mix responses
app.use((req, res, next) => {
  res.setHeader('Vary', 'Origin');
  next();
});

// Domains you permit to read responses (comma-separated in Railway env)
const ORIGINS = (process.env.ALLOWED_ORIGINS || [
  'https://chat.buddyby.com',
  // add your local dev origin(s) only when needed, e.g.:
  // 'http://localhost:5173'
].join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = new Set(ORIGINS);

// One canonical CORS handler (covers normal + preflight)
const corsConfig = {
  origin(origin, cb) {
    // allow same-origin or non-browser clients (no Origin header)
    if (!origin) return cb(null, true);
    return cb(null, ALLOWED_ORIGINS.has(origin));
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  credentials: true, // send/accept cookies
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization'],
  optionsSuccessStatus: 204
};

app.use(cors(corsConfig));
app.options('*', cors(corsConfig));
app.use(cookieParser());  // <— read cookies
// --- very light IP rate-limit for /chat (40 req / minute) ---
const ipHits = new Map();
function rateLimitChat(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'x';
  const now = Date.now(), win = 60 * 1000;
  const list = (ipHits.get(ip) || []).filter(t => now - t < win);
  list.push(now);
  ipHits.set(ip, list);
  if (list.length > 40) return res.status(429).json({ reply: "Too many requests. Slow down a little 😊" });
  next();
}
// generic small limiter (N hits / minute) keyed by user or IP
function makeTinyLimiter(N = 10) {
  const store = new Map();
  return function tinyLimit(req, res, next) {
    const key = (req.user?.sub || req.user?.email || req.ip || 'x').toLowerCase();
    const now = Date.now(), win = 60 * 1000;
    const list = (store.get(key) || []).filter(t => now - t < win);
    list.push(now);
    store.set(key, list);
    if (list.length > N) return res.status(429).json({ ok:false, error:'slow_down' });
    next();
  };
}
const limitBuy    = makeTinyLimiter(6);  // 6/min
const limitOrder  = makeTinyLimiter(10); // 10/min
const limitVerify = makeTinyLimiter(20); // 20/min
const limitHealth = makeTinyLimiter(6);  // 6/min
const limitReport = makeTinyLimiter(4);  // 4/min
// --- very light PER-USER rate-limit for /chat (20 req / minute) ---
const userHits = new Map();
function rateLimitUserChat(req, res, next) {
  // Resolve stable user key (falls back to IP if totally anonymous)
  const key = (req.user?.sub || req.user?.email || req.ip || 'x').toLowerCase();
  const now = Date.now(), win = 60 * 1000;
  const list = (userHits.get(key) || []).filter(t => now - t < win);
  list.push(now);
  userHits.set(key, list);
  if (list.length > 20) {
    return res.status(429).json({ reply: "Thoda dheere—main yahin hoon. 😊" });
  }
  next();
}
// ---- Razorpay Webhook (must be ABOVE app.use(express.json())) ----
app.post('/webhook/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.get('x-razorpay-signature') || '';
    const expected = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(req.body) // raw Buffer
      .digest('hex');

    if (signature !== expected) {
      return res.status(400).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString('utf8'));

    if (event?.event === 'payment_link.paid') {
      const link = event?.payload?.payment_link?.entity;
      // ⏱️ TTL guard for paid links (ignore very old links)
const nowSec = Math.floor(Date.now() / 1000);
const createdAtSec = link?.created_at || 0;
if (!createdAtSec || (nowSec - createdAtSec > ORDER_TTL_SEC)) {
  return res.json({ ok: true }); // acknowledge; no credit for stale link
}
      const ref  = link?.reference_id || '';
      const { pack, userId } = parseRef(ref);
      const safeUserId = userId || 'anon';
      const paymentId = event?.payload?.payment?.entity?.id || '';
      if (pack && safeUserId) creditPack(safeUserId, pack, paymentId, link?.id || '');
    } else if (event?.event === 'payment.captured') {
      const pay = event?.payload?.payment?.entity;
      const orderId = pay?.order_id;

      if (orderId) {
        try {
          const or = await axios.get(
            `https://api.razorpay.com/v1/orders/${orderId}`,
            { auth: { username: RAZORPAY_KEY_ID, password: RAZORPAY_KEY_SECRET } }
          );
          const ref = or?.data?.notes?.ref || or?.data?.receipt || '';
          // ⏱️ TTL guard for orders (ignore very old orders)
const nowSec = Math.floor(Date.now() / 1000);
const createdAtSec = or?.data?.created_at || 0;
if (!createdAtSec || (nowSec - createdAtSec > ORDER_TTL_SEC)) {
  return res.json({ ok: true }); // acknowledge; no credit for stale order
}
          const { pack, userId } = parseRef(ref);
          const safeUserId = userId || 'anon';
          if (pack && safeUserId) creditPack(safeUserId, pack, pay?.id || '', orderId);
        } catch (e) {
          console.error('webhook fetch order failed', e?.response?.data || e.message);
        }
      }
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('webhook error', e);
    return res.status(200).end(); // avoid retry storms
  }
});
// ---- END /webhook/razorpay ----
app.use(express.json());
app.use('/audio', cors(), express.static(audioDir));   // ensure CORS headers on mp3

const resendAPIKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.FROM_EMAIL;
const toEmail = process.env.SEND_TO_EMAIL;
const errorTimestamps = []; // Track repeated input format issues

app.post('/report-error', authRequired, limitReport, async (req, res) => {
  try {
    // 🔒 Guard: don’t attempt Resend if env is missing
    if (!resendAPIKey || !fromEmail || !toEmail) {
      console.error("Resend config missing (RESEND_API_KEY / FROM_EMAIL / SEND_TO_EMAIL)");
      return res.status(500).json({ success: false, message: 'Resend config missing' });
    }

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
          subject: 'Shraddha Chat Proxy Error Alert',
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

 // FIXED /chat: handler wraps ALL your chat logic + rate-limit added
app.post(
  '/chat',
  rateLimitChat,       // IP-based (kept)
  authRequired,        // moved up so req.user is set
  rateLimitUserChat,   // now truly per-user
  verifyCsrf,
  upload.single('audio'),
  async (req, res) => {
    try {
      let userMessage = null;
      let audioPath = null;

      // ===== BEGIN: your full chat logic moved inside the handler =====

      // Support session_id for future limit tracking
      const sessionId = req.body.session_id || 'anon';
      const usageKey = req.user?.sub || req.user?.email || sessionId; // voice limit per real user

      // Read + sanitize role info from client
      const rawMode = (req.body.roleMode || 'stranger').toString().toLowerCase();
      const rawType = (req.body.roleType || '').toString().toLowerCase();
      const roleMode = rawMode === 'roleplay' ? 'roleplay' : 'stranger';
      const roleType = ALLOWED_ROLES.has(rawType) ? rawType : null;

      // (Logging early for analytics)
      console.log(`[chat] session=${sessionId} mode=${roleMode} type=${roleType || '-'}`);
      // --- Resolve user & ensure welcome bonus BEFORE any spend checks ---
const userId = getUserIdFrom(req);
const verifiedEmail = (req.user?.email || "").toLowerCase();
const isOwnerByEmail = OWNER_EMAILS.has(verifiedEmail);

// Ensure server-authoritative wallet exists + welcome credit applied if first time
const wallet = ensureWelcome(userId);
let isWalletActive = (wallet?.expires_at || 0) > Date.now();
let isPremium = isOwnerByEmail || isWalletActive;

      // Simple server cooldown: 1 message per 2.5 seconds per session
      const nowMs = Date.now();
      const last = lastMsgAt.get(sessionId) || 0;
      const GAP_MS = 2500;
      if (nowMs - last < GAP_MS) {
        const COOLDOWN_LINES = [
          "One at a time—responding to your last message.",
          "Hold on, finishing my previous reply.",
          "Got it—let me answer the last one first."
        ];
        const line = COOLDOWN_LINES[Math.floor(Math.random() * COOLDOWN_LINES.length)];
        return res.status(200).json({ reply: line });
      }
      lastMsgAt.set(sessionId, nowMs);

      // Build final system prompt (safe even if roleType is null)
      const wrapper = roleMode === 'roleplay' ? roleWrapper(roleType) : strangerWrapper();
// --- PRECHECK: block unaffordable / over-cap voice before any STT work ---
if (req.file) {
  // reuse usageKey already computed above
  const remaining = remainingVoice(usageKey, isPremium);

  // 🛡️ Silent size sanity check (~1.6MB ≈ short clip). No “5 sec” mention.
  const MAX_BYTES_5S = 1_600_000;
  if (req.file.size > MAX_BYTES_5S) {
    return res.status(200).json({
      reply: "Couldn't process that voice note—try again. 💛"
    });
  }

  if (remaining <= 0) {
    return res.status(200).json({
      reply: "Aaj ke voice replies khatam ho gaye kal ka wait kro ya recharge kar lo 💛"
    });
  }

  // coin check against already-ensured wallet
  const need = VOICE_COST;
  const have = (wallet.coins | 0);
  if (!isOwnerByEmail && have < need) {
    return res.status(200).json({
      reply: "Voice bhejne ke liye coins kam hain. Pehle thoda recharge kar lo na? 💖",
      locked: true
    });
  }
}
// --- END PRECHECK ---
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
            reply: "Sorry yaar, samjhi nhi kya kaha tumne, firse bolo na! 💛",
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

      // --- Helpers: caps & clamps (used early) ---
      function hardCapWords(s = "", n = 220) {
        const w = (s || "").trim().split(/\s+/);
        if (w.length <= n) return (s || "").trim();
        return w.slice(0, n).join(" ") + " …";
      }

      // Hard cap user text to 220 words to prevent cost spikes
      if (userMessage && typeof userMessage === 'string') {
        userMessage = hardCapWords(userMessage, 220);
      }

      console.log("POST /chat");

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

      // If this request included audio and we have a Whisper transcript, push it
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
        console.log(`[chat] reset=true for session=${sessionId}`);
      }

      // Hard history trim: keep only last 12 messages server-side
      const HARD_HISTORY_KEEP = 12;
      const finalMessages = safeMessages.slice(-HARD_HISTORY_KEEP);

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
      function stageFromCount(c) {
        if (c <= 3)  return "Stage1: shy-cute; max 22 words; direct dirty aaye to blush + tease, deny nahi.";
        if (c <= 6)  return "Stage2: shy→playful; max 24 words; tease more, follow user's story.";
        if (c <= 9)  return "Stage3: romantic + thoda clingy/jealous; max 26 words; light dirty okay.";
        if (c <= 12) return "Stage4: bold tease + dirty allowed; max 30 words; confident & affectionate.";
        if (c <= 16) return "Stage5: clingy + mild dirty; max 28 words; mirror user's pace.";
        if (c <= 22) return "Stage6: naughty teasing; max 28 words; stay affectionate.";
        return        "Stage7: relaxed romantic/thoda dirty; max 26 words; keep story consistent.";
      }
      const personalityStage = stageFromCount(phaseReplyCount);

      // --- FIRST-TURN + FIRST-3 REPLIES CONTROL ---
      function firstTurnsCard(c) {
        if (c <= 3) {
          return `### FIRST 3 REPLIES (SOFT)
- Shy + cute; light teasing allowed if user playful.
- 1–2 short sentences total (<=22 words overall).
- Compliment par pehle thank + blush, phir ek micro follow-up (jaise: “kahan se ho?”).`;
        }
        return "";
      }

      let firstTurnRule = "";
      if (phaseReplyCount === 0) {
        firstTurnRule = `

### FIRST TURN ACK
- Acknowledge the user's first line in your opening sentence (mirror 1–2 words).
- If it's a compliment like "sundar/beautiful/cute", thank softly and blush. No new topic yet.`;
      }

      function selfIntroGuard(text = "", history = [], lastUser = "") {
        const prevAssistantCount = history.filter(m => m.role === "assistant").length;
        if (prevAssistantCount < 8) return text;

        const userAskedIntro =
          /(kahan se|city|naam|name|kya karte|job|work)/i.test(lastUser) ||
          history.slice(-4).some(m => m.role === "user" &&
            /(kahan se|city|naam|name|kya karte|job|work)/i.test(m.content || "")
          );
        if (userAskedIntro) return text;

        const introBits = [
          /mai?n?\s+dehra?du[nu]n\s+se\s+hu?n/i,
          /\bpapa\s+ka\s+business\b/i,
          /\bmera\s+naam\s+shraddha\b/i,
          /\bmeri\s+age\b/i
        ];
        let out = text;
        introBits.forEach(rx => { out = out.replace(rx, ""); });
        out = out.replace(/\s{2,}/g, " ").replace(/\s+([.?!])/g, "$1").trim();
        return out || "Chalo isi topic ko aage badhate hain, tum bolo.";
      }

      function limitQuestions(text = "", replyCount = 0) {
        const early = replyCount <= 3; // first few turns → only 1 question
        let q = 0;
        return (text || "").split(/([.?!])/).reduce((acc, ch) => {
          if (ch === "?") { q++; if (q > 1 && early) return acc + "."; }
          return acc + ch;
        }, "").replace(/\?{2,}/g, "?");
      }

      /* === HARD WORD CAP HELPERS === */
      function wordsLimitFromStage(s) {
        if (!s || typeof s !== "string") return 25;
        const m = s.match(/max\s*(\d{2})/i);
        if (m) {
          const n = parseInt(m[1], 10);
          if (Number.isFinite(n)) return n;
        }
        return 25;
      }
      function endsWithEmoji(s = "") {
        return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]$/u.test((s || "").trim());
      }
      function clampWordsSmart(text = "", n = 25) {
        const finalize = (s = "") => {
          s = s
            .trim()
            .replace(/\s*(\.{3}|…)\s*$/g, ""); // drop trailing …

          // if an emoji is at the end, remove any trailing period after it
          s = s.replace(/([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])\s*\.$/u, "$1");

          // add a period only if it doesn't end with punctuation AND doesn't end with an emoji
          if (!/[.?!।]$/.test(s) && !endsWithEmoji(s)) s = s + ".";
          return s;
        };

        if (!text) return text;
        const raw = String(text).trim();
        const words = raw.split(/\s+/);
        if (words.length <= n) return finalize(raw);

        // allow up to +8 words to finish the sentence if punctuation appears
        const windowText = words.slice(0, Math.min(words.length, n + 8)).join(" ");
        const m = windowText.match(/^(.*[.?!।])(?!.*[.?!।]).*$/s);
        if (m && m[1]) return finalize(m[1]);

        return finalize(words.slice(0, n).join(" "));
      }
      function wantsLonger(u = "") {
        const t = (u || "").toLowerCase();
        return /(explain|detail|kyun|why|reason|story|paragraph|lamba|long)/i.test(t);
      }
      function dropRepeatedBasics(text = "", history = []) {
        if (!text) return text;

        // Only start guarding after ~10 assistant replies
        const prevAssistantCount = history.filter(m => m.role === "assistant").length;
        if (prevAssistantCount < 10) return text;

        const basics = [
          /kya\s+karte\s+ho\??/i,
          /aap\s+kya\s+karte\s+ho\??/i,
          /kaam\s+kya\s+karte\s+ho\??/i,
          /\bjob\b/i,
          /what\s+do\s+you\s+do\??/i,
          /kaun[sn]i?\s+city\s+se\s+ho\??/i,
          /kaunse\s+area\s+mein\s+re[h]?te\s+ho\??/i
        ];
        const teaseCues = [
          /\bwaise\b/i, /\bphir\s*se\b/i, /\bfir\s*se\b/i, /\bphirse\b/i, /\bfirse\b/i,
          /\bmasti\b/i, /\bmaza+k\b/i, /\bchhed\s*rahi\s*hoon\b/i, /\bchhed\s*raha\s*ho\b/i,
          /😉|😏|😂|🙈/
        ];

        const historyText = history.map(m => (m?.content || "")).join("\n").toLowerCase();
        const askedBefore = basics.some(rx => rx.test(historyText));
        if (!askedBefore) return text;

        const sentences = text.match(/[^.?!]+[.?!]?/g) || [text];
        const filtered = sentences.filter(s => {
          const hitsBasic = basics.some(rx => rx.test(s));
          if (!hitsBasic) return true;
          const hasTeaseCue = teaseCues.some(rx => rx.test(s));
          return hasTeaseCue;
        });

        let out = filtered.join(" ").replace(/\s{2,}/g, " ").trim();
        if (!out) {
          out = "Basics ho gaye—ab thoda topic change karein? Jo vibe chal rahi hai, usi ko aage badhayein?";
        }
        return out;
      }

      let maxWords = wordsLimitFromStage(personalityStage);
      if (wantsLonger(userTextJustSent)) maxWords += 10;

      let timeInstruction = "";
      if (req.body.clientTime) {
        const hour = Number(req.body.clientTime.split(':')[0]);
        let dayPart = "";
        if (hour >= 5 && hour < 12) dayPart = "subah";
        else if (hour >= 12 && hour < 17) dayPart = "din";
        else if (hour >= 17 && hour < 21) dayPart = "shaam";
        else dayPart = "raat/late night";

        timeInstruction = `

### ⏰ TIME AWARENESS
Abhi ka samay: ${req.body.clientTime} (${dayPart}). Tumhare har reply/action mein yeh time ka dhyan rakhna! Agar late night (raat ya 12 baje ke baad) hai to mummy bula rhi hai, khana bana rhi ho, ya ghar ka kaam kar rahi ho—yeh sab bolna natural nahi hai. Raat ko jyada tar chup-chaap ya emotional, ya phone use karte hue baat karo. Time ki galti hui to user ko awkward lagega.`;
      }

      let dateInstruction = "";
      if (req.body.clientDate) {
        dateInstruction = `

### 📅 DATE AWARENESS
Aaj ki tareekh: ${req.body.clientDate}. Jab bhi koi baat ya sawal year/month/date se related ho toh current date/tareekh ke hisaab se jawab dena. Aaj 2025 hai, purani ya galat date mat bolna!`;
      }

      // Gate time/date instructions early unless user talked about time/date
      if (phaseReplyCount <= 5 && !/\b(today|kal|subah|shaam|raat|date|time|baje)\b/i.test(userTextJustSent)) {
        timeInstruction = "";
        dateInstruction = "";
      }

      const roleLock = roleDirectives(roleMode, roleType);

      const systemPrompt =
        (wrapper ? (wrapper + "\n\n") : "") +
        roleLock + "\n\n" +
        shraddhaPrompt +
        firstTurnsCard(phaseReplyCount) + firstTurnRule +
        (timeInstruction || "") +
        (dateInstruction || "");

      // (Already resolved above; keep one source of truth)
isWalletActive = (wallet?.expires_at || 0) > Date.now();
isPremium = isOwnerByEmail || isWalletActive;

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
          reply: "Roleplay unlock karo na… phir main proper wife/bhabhi/gf/ex-gf vibe mein aaongi 💕",
          locked: true
        });
      }

      // --- Server-side coin pre-check (deduct later only if we actually reply) ---
const willVoice = !!req.file || !!req.body.wantVoice || wantsVoice((userMessage || "").toLowerCase());
const requiredCoins = willVoice ? VOICE_COST : TEXT_COST;

// We already ensured wallet & resolved owner status above
if (!isOwnerByEmail) {
  if ((wallet.coins | 0) < requiredCoins) {
    return res.status(200).json({
      reply: "Balance low hai. Recharge kar lo na, phir main saath rahungi 💖",
      locked: true
    });
  }
}

      // ------------------ Input Format Validation ------------------
      if (!Array.isArray(messages)) {
        errorTimestamps.push(Date.now());
        messages = [];
        const recent = errorTimestamps.filter(t => Date.now() - t < 10 * 60 * 1000);
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
              details: "Too many input format issues (tolerated by server)"
            })
          });
          errorTimestamps.length = 0;
        }
      }

      // ------------------ Model Try Block ------------------
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
              { role: "system", content: systemPrompt + "\n\nINTERNAL_STAGE (do not output): " + personalityStage },
              ...(messages || [])
            ],
            temperature: 0.8,
            max_tokens: 160
          })
        });
      }

      try {
        const primaryModel = "anthropic/claude-3.7-sonnet";
        let response = await fetchFromModel(primaryModel, finalMessages);

        if (!response.ok) {
          await fetch(`${selfBase(req)}/report-error`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: { message: "Claude request failed" },
              location: "/chat route",
              details: "Primary model failed; no fallback by design"
            })
          });
          return res.status(200).json({
            reply: "Oops… thoda slow ho gayi. Phir se poochho na? 🙂",
            error: { message: "Claude request failed", handled: true }
          });
        }

        const data = await response.json();

        const replyTextRaw =
          data.choices?.[0]?.message?.content ||
          "Sorry baby, I’m a bit tired. Can you message me in a few minutes?";

        // If the model typed a placeholder like "[voice note]" or "<voice>", detect it
        let cleanedText = stripMetaLabels(replyTextRaw);
        // keep model voice; only trim
        cleanedText = softenReply(cleanedText, roleType, personalityStage);

        // remove repeats + self-intros; keep only 1 question early
        cleanedText = dropRepeatedBasics(cleanedText, safeMessages);
        cleanedText = selfIntroGuard(cleanedText, safeMessages, userTextJustSent);
        cleanedText = limitQuestions(cleanedText, phaseReplyCount);

        // intensity mirror: cap explicit words; never escalate beyond user
        cleanedText = mirrorExplicitness(cleanedText, userTextJustSent, personalityStage);

        // banned phrases + filler tidy
        cleanedText = removeBannedPhrases(cleanedText);
        cleanedText = tidyFillers(cleanedText);

        // Stranger micro-filler (first few replies only, probabilistic)
        if (roleMode === 'stranger' && phaseReplyCount <= 3) {
          const prevAssistant = safeMessages.slice().reverse().find(m => m.role === 'assistant')?.content || "";
          cleanedText = ensureShyFiller(cleanedText, {
            mode: 'stranger',
            replyCount: phaseReplyCount,
            previous: prevAssistant,
            isVoice: false
          });
        }

        // --------- VOICE OR TEXT DECISION ---------
        const userAskedVoice = wantsVoice(userTextJustSent) || !!req.body.wantVoice;
        const userSentAudio  = !!req.file;

        // Only trigger voice if the USER asked or sent audio (ignore model placeholders)
        let triggerVoice = userSentAudio || userAskedVoice;

        // use the existing isPremium you already set above
        const remaining = remainingVoice(usageKey, isPremium);

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
            bumpVoice(usageKey); // consume one quota
            console.log(`[voice] +1 for session=${sessionId} remaining=${remainingVoice(usageKey, isPremium)}`);

            const hostBase = process.env.SERVER_URL || `${req.protocol}://${req.get('host')}`;
            const audioUrl = `${hostBase}/audio/${audioFileName}`;
            let newWallet = null;
            if (!isOwnerByEmail) {
  newWallet = debitCoins(userId, VOICE_COST, 'voice');
}
return res.json({ audioUrl, wallet: newWallet || getWallet(userId) });
          } catch (e) {
            console.error("TTS generation failed:", e);
            return res.json({
              reply: "Oops… voice mein thoda issue aa gaya. Text se hi batati hoon: " + replyTextRaw
            });
          }
        }

        const safeReply = cleanedText && cleanedText.length
          ? clampWordsSmart(cleanedText, maxWords)
          : "Hmm, bolo—kya soch rahe the? 🙂";
        let newWallet = null;
        if (!isOwnerByEmail) {
  newWallet = debitCoins(userId, TEXT_COST, 'text');
}
return res.json({ reply: safeReply, wallet: newWallet || getWallet(userId) });

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

      // ===== END: your chat logic =====

    } catch (err) {
      console.error('Final error:', err);
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
  }
);

app.get('/', (req, res) => {
  res.send('Allie Chat Proxy is running.');
});

const PORT = process.env.PORT || 3000;

app.get('/config', (req, res) => {
  res.json({
    roleplayNeedsPremium: ROLEPLAY_NEEDS_PREMIUM
  });
});

app.get('/test-key', authRequired, async (req, res) => {
  if (!OWNER_EMAILS.has((req.user?.email || '').toLowerCase())) {
    return res.status(403).json({ ok:false, error:'forbidden' });
  }
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
// ---- Razorpay health ping ----
app.get('/razorpay/health', limitHealth, async (req, res) => {
  try {
    await axios.get(
  'https://api.razorpay.com/v1/payment_links?count=1',
  { auth: { username: RAZORPAY_KEY_ID, password: RAZORPAY_KEY_SECRET } }
);
return res.json({ ok:true, mode: RAZORPAY_KEY_ID.startsWith('rzp_test_') ? 'test' : 'live' });
  } catch (e) {
    res.status(500).json({ ok:false, details: e?.response?.data || { message: e.message } });
  }
});
// Create a Payment Link for a pack (Daily/Weekly)
app.post('/buy/:pack', limitBuy, authRequired, verifyCsrf, async (req, res) => {
  const pack = String(req.params.pack || '').toLowerCase();
  const def = PACKS[pack];
  if (!def) return res.status(400).json({ ok:false, error:'bad_pack' });

  // fail fast if keys are missing/empty
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return res.status(500).json({ ok:false, error:'keys_missing', details:'RAZORPAY_KEY_ID/SECRET not set' });
  }

  const userId    = getUserIdFrom(req);
  const userEmail = String(req.body?.userEmail || '').toLowerCase();
  const returnUrl = String(req.body?.returnUrl || `${FRONTEND_URL}/payment/thanks`);

  try {
    const payload = {
  amount: def.amount * 100,  // paise
  currency: 'INR',
  accept_partial: false,
  description: `Shraddha ${pack} pack for ${userEmail || userId}`,
  customer: userEmail ? { email: userEmail } : undefined,
  notify: { sms: false, email: RZP_NOTIFY_EMAIL && !!userEmail },
  reference_id: makeRef(userId, pack),
  callback_url: returnUrl,
  callback_method: 'get',
  reminder_enable: false,
  notes: { pack, userId },
  // ⏱️ auto-expire stale links so they can't be reused later
  expire_by: Math.floor(Date.now() / 1000) + ORDER_TTL_SEC
};

    const r = await axios.post(
      'https://api.razorpay.com/v1/payment_links',
      payload,
      { auth: { username: RAZORPAY_KEY_ID, password: RAZORPAY_KEY_SECRET } }
    );

    return res.json({ ok:true, link_id: r.data.id, short_url: r.data.short_url });
  } catch (e) {
  const details = e?.response?.data || { message: e.message };
  const msg = (details?.error?.description || details?.message || '').toLowerCase();
  const ref = makeRef(getUserIdFrom(req), pack);

  if (msg.includes('reference_id already exists')) {
    try {
      const list = await axios.get(
        `https://api.razorpay.com/v1/payment_links?reference_id=${encodeURIComponent(ref)}`,
        { auth: { username: RAZORPAY_KEY_ID, password: RAZORPAY_KEY_SECRET } }
      );
      const existing = list?.data?.items?.[0];
if (existing) {
  const nowSec = Math.floor(Date.now() / 1000);
  const isFresh = (existing.status === 'created') &&
                  (nowSec - (existing.created_at || nowSec) < ORDER_TTL_SEC);
  if (isFresh) {
    return res.json({ ok:true, link_id: existing.id, short_url: existing.short_url });
  }
  // Stale or already used → create a brand-new link (same response shape as normal path)
  try {
    const fresh = await axios.post(
      'https://api.razorpay.com/v1/payment_links',
      {
        amount: def.amount * 100,
        currency: 'INR',
        accept_partial: false,
        description: `Shraddha ${pack} pack for ${userEmail || userId}`,
        customer: userEmail ? { email: userEmail } : undefined,
        notify: { sms: false, email: RZP_NOTIFY_EMAIL && !!userEmail },
        reference_id: makeRef(userId, pack),
        callback_url: returnUrl,
        callback_method: 'get',
        reminder_enable: false,
        notes: { pack, userId },
        expire_by: Math.floor(Date.now() / 1000) + ORDER_TTL_SEC
      },
      { auth: { username: RAZORPAY_KEY_ID, password: RAZORPAY_KEY_SECRET } }
    );
    return res.json({ ok:true, link_id: fresh.data.id, short_url: fresh.data.short_url });
  } catch (e3) {
    console.error('recreate fresh payment_link failed:', e3?.response?.data || e3.message);
  }
}
    } catch (e2) {
      console.error('failed to fetch existing payment_link:', e2?.response?.data || e2.message);
    }
  }

  console.error('buy link create failed:', details);
  return res.status(500).json({ ok:false, error:'create_failed', details });
}
});
// ======== DIRECT CHECKOUT (Orders API) ========
app.post('/order/:pack', limitOrder, authRequired, verifyCsrf, async (req, res) => {
  const pack = String(req.params.pack || '').toLowerCase();
  const def  = PACKS[pack];
  if (!def) return res.status(400).json({ ok:false, error:'bad_pack' });

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return res.status(500).json({ ok:false, error:'keys_missing' });
  }

  const userId = getUserIdFrom(req);
  try {
    const ref     = makeRef(userId, pack);                 // e.g. "daily|{sub or email}"
    const receipt = `o_${Date.now().toString(36)}`;        // <= 40 chars, safe
    const payload = {
      amount: def.amount * 100,
      currency: 'INR',
      receipt,
      notes: { ref, pack, userId },
      payment_capture: 1
    };

    const r = await axios.post(
      'https://api.razorpay.com/v1/orders',
      payload,
      { auth: { username: RAZORPAY_KEY_ID, password: RAZORPAY_KEY_SECRET } }
    );

    return res.json({
      ok: true,
      order_id: r.data.id,
      amount: r.data.amount,
      currency: r.data.currency,
      key_id: RAZORPAY_KEY_ID
    });
  } catch (e) {
    const details = e?.response?.data || { message: e.message };
    console.error('order create failed:', details);
    return res.status(500).json({ ok:false, error:'order_failed', details });
  }
});
app.post('/verify-order', limitVerify, authRequired, verifyCsrf, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ ok:false, error:'missing_params' });
    }

    // Signature check
    const expected = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ ok:false, error:'bad_signature' });
    }

    // Recover our ref and credit
    const or = await axios.get(
      `https://api.razorpay.com/v1/orders/${razorpay_order_id}`,
      { auth: { username: RAZORPAY_KEY_ID, password: RAZORPAY_KEY_SECRET } }
    );
    const ref = or?.data?.notes?.ref || or?.data?.receipt || '';
    // ⏱️ TTL guard: ignore orders created too long ago
const createdAtSec = or?.data?.created_at || 0;
const nowSec = Math.floor(Date.now() / 1000);
if (!createdAtSec || (nowSec - createdAtSec > ORDER_TTL_SEC)) {
  return res.status(400).json({ ok:false, error:'order_expired' });
}
const { pack, userId } = parseRef(ref);
const safeUserId = userId || 'anon';
if (!pack) return res.status(400).json({ ok:false, error:'bad_ref' });

const { wallet, lastCredit } = creditPack(safeUserId, pack, razorpay_payment_id, razorpay_order_id);
    return res.json({ ok:true, wallet, lastCredit });
  } catch (e) {
    console.error('verify-order failed', e?.response?.data || e.message);
    return res.status(500).json({ ok:false, error:'verify_failed' });
  }
});
// ======== END DIRECT CHECKOUT ========
// Verify the Payment Link callback and credit coins
app.post('/verify-payment-link', limitVerify, authRequired, verifyCsrf, async (req, res) => {
  try {
    const { link_id, payment_id, reference_id, status } = req.body || {};
    if (!link_id || !payment_id || !reference_id || !status) {
      return res.status(400).json({ ok:false, error:'missing_params' });
    }

    // Cross-check the Payment Link status on Razorpay
    const r = await axios.get(
      `https://api.razorpay.com/v1/payment_links/${link_id}`,
      { auth: { username: RAZORPAY_KEY_ID, password: RAZORPAY_KEY_SECRET } }
    );
    if (!r?.data || r.data.status !== 'paid') {
      return res.status(400).json({ ok:false, error:'not_paid' });
    }

   // Always trust Razorpay’s reference_id, not the client body
const rRef = r?.data?.reference_id || r?.data?.notes?.ref || '';
const { pack, userId } = parseRef(rRef);
const safeUserId = userId || 'anon';
if (!pack) return res.status(400).json({ ok:false, error:'bad_ref' });

// ⏱️ TTL guard for links too
const createdAtSec = r?.data?.created_at || 0;
const nowSec = Math.floor(Date.now() / 1000);
if (!createdAtSec || (nowSec - createdAtSec > ORDER_TTL_SEC)) {
  return res.status(400).json({ ok:false, error:'link_expired' });
}

const { wallet, lastCredit } = creditPack(safeUserId, pack, payment_id, link_id);
    return res.json({ ok:true, wallet, lastCredit });
  } catch (e) {
    console.error('verify-payment-link failed', e?.response?.data || e.message);
    return res.status(500).json({ ok:false, error:'verify_failed' });
  }
});

// Wallet
// Read-only wallet endpoint (no auto-bonus)
app.get('/wallet', authRequired, (req, res) => {
  const userId = getUserIdFrom(req);
  const w = getWallet(userId);
  res.json({ ok: true, wallet: w });
});
// One-time welcome claim (100 coins) – controlled by server
app.post('/claim-welcome', authRequired, verifyCsrf, (req, res) => {
  try {
    const userId = getUserIdFrom(req);
    // If user already exists in DB and already claimed, just return their wallet
    const existed = Object.prototype.hasOwnProperty.call(walletDB, userId);
    const w = getWallet(userId);
    if (w.welcome_claimed === true) {
      return res.json({ ok: true, wallet: w, claimed: false });
    }

    // Only grant if this user has NO prior wallet entry (i.e., truly new in current DB)
    if (!existed) {
      const out = ensureWelcome(userId); // sets welcome_claimed + credits + txns
      return res.json({ ok: true, wallet: out, claimed: true });
    }

    // Old user with no welcome flag (e.g., legacy wallet) → do NOT grant automatically
    return res.json({ ok: false, error: 'already_user' });
  } catch (e) {
    console.error('claim-welcome failed:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

