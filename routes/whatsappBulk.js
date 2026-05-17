// routes/whatsapp_bulk.js
// Server-side bulk send queue — runs independently of the browser
const express = require('express');
const router = express.Router();

const EVOLUTION_API_URL = 'https://evolution-api-mqvx.onrender.com';

function getApiKey(req) {
  return req.headers['x-evolution-key'] || process.env.EVOLUTION_API_KEY;
}

async function evoFetch(url, options = {}) {
  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
  return fetchFn(url, options);
}

// In-memory queue store (survives tab close, resets on server restart)
const queues = {}; // { queueId: { status, jobs, results, createdAt } }

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendOneProduct(product, jid, instance, apiKey) {
  const INSTANCE_ENCODED = encodeURIComponent(instance);
  const link = `https://salonefastmarket.com/app/product/${product._id}`;
  const price = product.offerPrice
    ? `🏷️ *Offer:* Le ${Number(product.offerPrice).toLocaleString()} ~~Le ${Number(product.price).toLocaleString()}~~`
    : `💰 *Price:* Le ${Number(product.price).toLocaleString()}`;
  const cat = product.category?.name || product.category || 'General';
  const desc = product.description
    ? '\n\n' + product.description.slice(0, 200) + (product.description.length > 200 ? '...' : '')
    : '';

  const text = `🛍️ *${product.name}*${desc}\n${price}\n📦 Category: ${cat}\n\n🔗 ${link}\n\n_This is Salone Fast Market \n Your Trust Online Marketplace_ 🇸🇱`;

  const imgUrl = product.images?.[0]?.url || product.image || null;

  // Try image first
  if (imgUrl) {
    try {
      const res = await evoFetch(
        `${EVOLUTION_API_URL}/message/sendMedia/${INSTANCE_ENCODED}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
          body: JSON.stringify({
            number: jid,
            mediatype: 'image',
            media: imgUrl,
            caption: text,
            fileName: (product.name || 'product').slice(0, 40) + '.jpg'
          })
        }
      );
      if (res.ok) return { ok: true, method: 'media' };
    } catch {}
  }

  // Fallback to text
  const res = await evoFetch(
    `${EVOLUTION_API_URL}/message/sendText/${INSTANCE_ENCODED}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
      body: JSON.stringify({ number: jid, text })
    }
  );
  const raw = await res.text();
  return { ok: res.ok, status: res.status, method: 'text', raw };
}

async function processQueue(queueId) {
  const q = queues[queueId];
  if (!q) return;

  q.status = 'running';
  q.startedAt = new Date().toISOString();

  for (let i = 0; i < q.jobs.length; i++) {
    if (q.status === 'stopped') break;

    const job = q.jobs[i];
    job.status = 'sending';

    try {
      for (const jid of q.jids) {
        const result = await sendOneProduct(job.product, jid, q.instance, q.apiKey);
        job.results = job.results || [];
        job.results.push({ jid, ...result });
      }
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = e.message;
    }

    q.progress = i + 1;

    // Delay between products (skip delay after last one)
    if (i < q.jobs.length - 1 && q.status !== 'stopped') {
      job.nextAt = new Date(Date.now() + q.delayMs).toISOString();
      await sleep(q.delayMs);
    }
  }

  q.status = q.status === 'stopped' ? 'stopped' : 'done';
  q.finishedAt = new Date().toISOString();
}

// ── Start a bulk queue ─────────────────────────────────────────────
router.post('/queue/start', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) return res.status(401).json({ success: false, message: 'Missing API key' });

    const { products, jids, instance, delaySeconds = 30 } = req.body;

    if (!products?.length) return res.status(400).json({ success: false, message: 'products array required' });
    if (!jids?.length) return res.status(400).json({ success: false, message: 'jids array required' });
    if (!instance) return res.status(400).json({ success: false, message: 'instance name required' });

    const queueId = generateId();

    queues[queueId] = {
      id: queueId,
      status: 'pending',
      instance,
      apiKey,
      jids,
      delayMs: Math.min(Math.max(delaySeconds, 5), 300) * 1000, // 5s–300s
      progress: 0,
      total: products.length,
      createdAt: new Date().toISOString(),
      jobs: products.map(p => ({ product: p, status: 'pending' }))
    };

    // Run in background — don't await
    processQueue(queueId).catch(e => {
      if (queues[queueId]) queues[queueId].status = 'error';
      console.error('Queue error:', e.message);
    });

    res.json({ success: true, queueId, total: products.length, delaySeconds });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Poll queue status ──────────────────────────────────────────────
router.get('/queue/:id', (req, res) => {
  const q = queues[req.params.id];
  if (!q) return res.status(404).json({ success: false, message: 'Queue not found' });

  res.json({
    success: true,
    id: q.id,
    status: q.status,       // pending | running | done | stopped | error
    progress: q.progress,
    total: q.total,
    delayMs: q.delayMs,
    createdAt: q.createdAt,
    startedAt: q.startedAt,
    finishedAt: q.finishedAt,
    currentJob: q.jobs[q.progress] || null,
    nextAt: q.jobs[q.progress - 1]?.nextAt || null,
    jobs: q.jobs.map(j => ({
      name: j.product.name,
      status: j.status,
      error: j.error,
      results: j.results
    }))
  });
});

// ── Stop a queue ───────────────────────────────────────────────────
router.post('/queue/:id/stop', (req, res) => {
  const q = queues[req.params.id];
  if (!q) return res.status(404).json({ success: false, message: 'Queue not found' });
  q.status = 'stopped';
  res.json({ success: true, message: 'Queue stop requested' });
});

// ── List all queues ────────────────────────────────────────────────
router.get('/queues', (req, res) => {
  const list = Object.values(queues).map(q => ({
    id: q.id,
    status: q.status,
    progress: q.progress,
    total: q.total,
    createdAt: q.createdAt,
    finishedAt: q.finishedAt
  }));
  res.json({ success: true, queues: list });
});

// Clean up queues older than 24h
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const id in queues) {
    if (new Date(queues[id].createdAt).getTime() < cutoff) delete queues[id];
  }
}, 60 * 60 * 1000);

module.exports = router;
