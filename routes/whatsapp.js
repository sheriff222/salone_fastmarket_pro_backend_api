// routes/whatsapp.js
// Proxy routes for Evolution API — avoids CORS issues from browser
const express = require('express');
const router = express.Router();

const EVOLUTION_API_URL = 'https://evolution-api-mqvx.onrender.com';
const INSTANCE = 'Salone Fast Market Express';
const INSTANCE_ENCODED = encodeURIComponent(INSTANCE);

function getApiKey(req) {
  // Accept from header or env
  return req.headers['x-evolution-key'] || process.env.EVOLUTION_API_KEY || '';
}

async function evoFetch(url, options = {}) {
  // Dynamic import for node-fetch compatibility, or use global fetch (Node 18+)
  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
  return fetchFn(url, options);
}

// ── Send text message ──────────────────────────────────────────────
router.post('/send/text', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) return res.status(401).json({ success: false, message: 'Missing Evolution API key' });

    const { number, text } = req.body;
    if (!number || !text) return res.status(400).json({ success: false, message: 'number and text are required' });

    const response = await evoFetch(
      `${EVOLUTION_API_URL}/message/sendText/${INSTANCE_ENCODED}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
        body: JSON.stringify({ number, text })
      }
    );

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('❌ WA send text error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Send media (image with caption) ───────────────────────────────
router.post('/send/media', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) return res.status(401).json({ success: false, message: 'Missing Evolution API key' });

    const { number, media, caption, fileName } = req.body;
    if (!number || !media) return res.status(400).json({ success: false, message: 'number and media are required' });

    const response = await evoFetch(
      `${EVOLUTION_API_URL}/message/sendMedia/${INSTANCE_ENCODED}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
        body: JSON.stringify({
          number,
          mediatype: 'image',
          media,
          caption: caption || '',
          fileName: fileName || 'image.jpg'
        })
      }
    );

    const data = await response.json();

    // If media send failed on Evolution side, fall back to text
    if (!response.ok) {
      console.warn('⚠️ Media send failed, trying text fallback...');
      const fallback = await evoFetch(
        `${EVOLUTION_API_URL}/message/sendText/${INSTANCE_ENCODED}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
          body: JSON.stringify({ number, text: caption || '' })
        }
      );
      const fallbackData = await fallback.json();
      return res.status(fallback.status).json({ ...fallbackData, _usedFallback: true });
    }

    res.status(response.status).json(data);
  } catch (err) {
    console.error('❌ WA send media error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Fetch groups ───────────────────────────────────────────────────
router.get('/groups', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) return res.status(401).json({ success: false, message: 'Missing Evolution API key' });

    const response = await evoFetch(
      `${EVOLUTION_API_URL}/group/fetchAllGroups/${INSTANCE_ENCODED}?getParticipants=false`,
      { headers: { 'apikey': apiKey } }
    );

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('❌ WA fetch groups error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Fetch chats (for finding contact JIDs) ─────────────────────────
router.post('/chats', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) return res.status(401).json({ success: false, message: 'Missing Evolution API key' });

    const response = await evoFetch(
      `${EVOLUTION_API_URL}/chat/findChats/${INSTANCE_ENCODED}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
        body: JSON.stringify({})
      }
    );

    const data = await response.json();
    // Filter to individual chats only (not groups)
    const chats = Array.isArray(data) ? data : (data.data || []);
    const contacts = chats.filter(c => {
      const jid = c.remoteJid || c.id || '';
      return jid.includes('@s.whatsapp.net');
    });

    res.json({ success: true, data: contacts });
  } catch (err) {
    console.error('❌ WA fetch chats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Instance connection status ─────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) return res.status(401).json({ success: false, message: 'Missing Evolution API key' });

    const response = await evoFetch(
      `${EVOLUTION_API_URL}/instance/connectionState/${INSTANCE_ENCODED}`,
      { headers: { 'apikey': apiKey } }
    );

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('❌ WA status error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;