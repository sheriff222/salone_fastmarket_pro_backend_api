const express = require('express');
const router = express.Router();
const SystemDialog = require('../model/systemDialog');

// GET /system-dialogs/check — called by Flutter on startup or via socket push
// Query params: userId, deviceId
router.get('/check', async (req, res) => {
  try {
    const { userId, deviceId } = req.query;
    const now = new Date();

    const query = {
      active: true,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
      $and: [
        {
          $or: [
            { targetType: 'all' },
            { targetType: 'user', targetUserIds: userId },
            { targetType: 'device', targetDeviceIds: deviceId },
            { targetType: 'both', targetUserIds: userId, targetDeviceIds: deviceId },
          ],
        },
      ],
    };

    const dialogs = await SystemDialog.find(query).sort({ priority: -1, createdAt: -1 });

    // Filter out already-seen ones if showOnce is true
    const filtered = dialogs.filter(d => {
      if (!d.showOnce) return true;
      if (userId && d.seenBy.includes(userId)) return false;
      return true;
    });

    res.json({ success: true, data: filtered });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /system-dialogs/seen — mark dialog as seen
router.post('/seen', async (req, res) => {
  try {
    const { dialogId, userId } = req.body;
    if (userId) {
      await SystemDialog.findByIdAndUpdate(dialogId, { $addToSet: { seenBy: userId } });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /system-dialogs/ack — mark dialog as acknowledged
router.post('/ack', async (req, res) => {
  try {
    const { dialogId, userId } = req.body;
    if (userId) {
      await SystemDialog.findByIdAndUpdate(dialogId, {
        $addToSet: { ackedBy: userId, seenBy: userId },
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Admin CRUD ──────────────────────────────────────────────────────────────

// GET all
router.get('/', async (req, res) => {
  try {
    const dialogs = await SystemDialog.find().sort({ createdAt: -1 });
    res.json({ success: true, data: dialogs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET one
router.get('/:id', async (req, res) => {
  try {
    const dialog = await SystemDialog.findById(req.params.id);
    if (!dialog) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: dialog });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create
router.post('/', async (req, res) => {
  try {
    const dialog = await SystemDialog.create(req.body);
    res.status(201).json({ success: true, data: dialog });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT update
router.put('/:id', async (req, res) => {
  try {
    const dialog = await SystemDialog.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: dialog });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await SystemDialog.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST push via socket — emit to targeted users
// Requires `io` to be injected; call setupDialogSocket(io) first
let _io = null;
const setupDialogSocket = (io) => { _io = io; };

router.post('/push', async (req, res) => {
  try {
    const dialog = await SystemDialog.create(req.body);

    if (_io) {
      const payload = { event: 'system_dialog', data: dialog };

      if (dialog.targetType === 'all') {
        _io.emit('system_dialog', dialog);
      } else {
        const ids = [...(dialog.targetUserIds || []), ...(dialog.targetDeviceIds || [])];
        ids.forEach(id => _io.to(id).emit('system_dialog', dialog));
      }
    }

    res.status(201).json({ success: true, data: dialog });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = { router, setupDialogSocket };