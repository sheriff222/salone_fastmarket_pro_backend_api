const mongoose = require('mongoose');

const buttonSchema = new mongoose.Schema({
  label: { type: String, required: true },
  action: {
    type: String,
    enum: ['dismiss', 'acknowledge', 'open_url', 'navigate', 'logout', 'ban_appeal', 'contact_support'],
    required: true,
  },
  url: String,         // for open_url
  route: String,       // for navigate (in-app screen name)
  style: { type: String, enum: ['primary', 'danger', 'ghost'], default: 'primary' },
});

const systemDialogSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: {
    type: String,
    enum: ['info', 'warning', 'error', 'ban', 'suspend', 'announcement', 'force_update', 'terms'],
    default: 'info',
  },

  // Targeting
  targetType: {
    type: String,
    enum: ['all', 'user', 'device', 'both'],
    default: 'all',
  },
  targetUserIds: [{ type: String }],   // specific userIds
  targetDeviceIds: [{ type: String }], // specific deviceIds/FCM tokens

  // Behaviour
  isDismissible: { type: Boolean, default: true },   // can user close without action?
  isForce: { type: Boolean, default: false },         // block all navigation?
  showOnce: { type: Boolean, default: true },         // only show once per session or ever?
  priority: { type: Number, default: 0 },             // higher = shown first

  // Content
  imageUrl: String,
  buttons: [buttonSchema],

  // Delivery
  active: { type: Boolean, default: true },
  expiresAt: Date,

  // Tracking
  seenBy: [{ type: String }],   // userIds who have seen it
  ackedBy: [{ type: String }],  // userIds who acknowledged

}, { timestamps: true });

module.exports = mongoose.model('SystemDialog', systemDialogSchema);