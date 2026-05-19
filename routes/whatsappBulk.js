// routes/whatsapp_bulk.js
const express = require('express');
const router = express.Router();

const EVOLUTION_API_URL = 'https://evolution-api-mqvx.onrender.com';
const EVOLUTION_API_KEY = 'jaf.salonefastmarket.com/@sfmadmin';
const EVOLUTION_INSTANCE = 'Salone Fast Market Express';

function getApiKey(req) {
  return req.headers['x-evolution-key'] || EVOLUTION_API_KEY;
}

async function evoFetch(url, options = {}) {
  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
  return fetchFn(url, options);
}

const queues = {};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function buildText(product) {
  const link = `https://salonefastmarket.com/app/product/${product._id}`;
  const price = product.offerPrice
    ? `🏷️ *Offer:* Le ${Number(product.offerPrice).toLocaleString()} ~~Le ${Number(product.price).toLocaleString()}~~`
    : `💰 *Price:* Le ${Number(product.price).toLocaleString()}`;
  const cat = product.proCategoryId?.name || product.category?.name || product.category || 'General';
  const desc = product.description
    ? '\n\n' + product.description.slice(0, 200) + (product.description.length > 200 ? '...' : '')
    : '';
  return `🛍️ *${product.name}*${desc}\n${price}\n📦 Category: ${cat}\n\n🔗 ${link}\n\n> > _This is *Salone Fast Market*  Your Trusted Online Marketplace_ 🇸🇱`;
}

async function sendOneProduct(product, jid, instance, apiKey) {
  const INSTANCE_ENCODED = encodeURIComponent(instance);
  const text = buildText(product);
  const res = await evoFetch(
    `${EVOLUTION_API_URL}/message/sendText/${INSTANCE_ENCODED}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
      body: JSON.stringify({ number: jid, text })
    }
  );
  const raw = await res.text();
  console.log(`📨 [${jid.slice(0, 20)}] status=${res.status} body=${raw.slice(0, 100)}`);
  return { ok: res.ok, status: res.status, raw };
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
    if (i < q.jobs.length - 1 && q.status !== 'stopped') {
      job.nextAt = new Date(Date.now() + q.delayMs).toISOString();
      await sleep(q.delayMs);
    }
  }

  q.status = q.status === 'stopped' ? 'stopped' : 'done';
  q.finishedAt = new Date().toISOString();
}

router.post('/queue/start', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) return res.status(401).json({ success: false, message: 'Missing API key' });
    const { products, jids, delaySeconds = 30 } = req.body;
    const instance = req.body.instance || EVOLUTION_INSTANCE;
    if (!products?.length) return res.status(400).json({ success: false, message: 'products required' });
    if (!jids?.length) return res.status(400).json({ success: false, message: 'jids required' });
    if (!instance) return res.status(400).json({ success: false, message: 'instance required' });

    const queueId = generateId();
    queues[queueId] = {
      id: queueId, status: 'pending', instance, apiKey, jids,
      delayMs: Math.min(Math.max(delaySeconds, 5), 300) * 1000,
      progress: 0, total: products.length,
      createdAt: new Date().toISOString(),
      jobs: products.map(p => ({ product: p, status: 'pending' }))
    };

    processQueue(queueId).catch(e => {
      if (queues[queueId]) queues[queueId].status = 'error';
      console.error('Queue error:', e.message);
    });

    res.json({ success: true, queueId, total: products.length, delaySeconds });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/queue/:id', (req, res) => {
  const q = queues[req.params.id];
  if (!q) return res.status(404).json({ success: false, message: 'Queue not found' });
  res.json({
    success: true, id: q.id, status: q.status,
    progress: q.progress, total: q.total, delayMs: q.delayMs,
    createdAt: q.createdAt, startedAt: q.startedAt, finishedAt: q.finishedAt,
    currentJob: q.jobs[q.progress] || null,
    nextAt: q.jobs[q.progress - 1]?.nextAt || null,
    jobs: q.jobs.map(j => ({ name: j.product.name, status: j.status, error: j.error, results: j.results }))
  });
});

router.post('/queue/:id/stop', (req, res) => {
  const q = queues[req.params.id];
  if (!q) return res.status(404).json({ success: false, message: 'Queue not found' });
  q.status = 'stopped';
  res.json({ success: true, message: 'Queue stopped' });
});

router.get('/queues', (req, res) => {
  res.json({ success: true, queues: Object.values(queues).map(q => ({
    id: q.id, status: q.status, progress: q.progress, total: q.total,
    createdAt: q.createdAt, finishedAt: q.finishedAt
  }))});
});

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const id in queues) {
    if (new Date(queues[id].createdAt).getTime() < cutoff) delete queues[id];
  }
}, 60 * 60 * 1000);

module.exports = router;
