// routes/notifications.js
const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();
const PushNotificationService = require('../services/pushNotificationService');
const NotificationScheduler = require('../services/notificationScheduler');
const UserDevice = require('../model/userDevice');

/**
 * Register/Update FCM Token
 * POST /notifications/register
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { userId, fcmToken, platform, deviceId, appVersion, osVersion } = req.body;

  if (!userId || !fcmToken || !platform) {
    return res.status(400).json({
      success: false,
      message: "userId, fcmToken, and platform are required."
    });
  }

  const deviceInfo = {
    platform,
    deviceId: deviceId || 'unknown',
    appVersion: appVersion || 'unknown',
    osVersion: osVersion || 'unknown'
  };

  const result = await PushNotificationService.registerDevice(
    userId,
    fcmToken,
    deviceInfo
  );

  if (result.success) {
    res.json({
      success: true,
      message: "Device registered successfully.",
      data: {
        deviceId: result.device._id,
        userId: result.device.userId
      }
    });
  } else {
    res.status(500).json({
      success: false,
      message: "Failed to register device: " + result.error
    });
  }
}));

/**
 * Unregister FCM Token (Logout)
 * POST /notifications/unregister
 */
router.post('/unregister', asyncHandler(async (req, res) => {
  const { fcmToken } = req.body;

  if (!fcmToken) {
    return res.status(400).json({
      success: false,
      message: "fcmToken is required."
    });
  }

  const result = await PushNotificationService.unregisterDevice(fcmToken);

  if (result.success) {
    res.json({
      success: true,
      message: "Device unregistered successfully."
    });
  } else {
    res.status(500).json({
      success: false,
      message: "Failed to unregister device: " + result.error
    });
  }
}));

/**
 * Get user's registered devices
 * GET /notifications/devices/:userId
 */
router.get('/devices/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const devices = await UserDevice.find({ 
    userId,
    isActive: true 
  }).select('-fcmToken'); // Don't expose tokens

  res.json({
    success: true,
    message: "Devices retrieved successfully.",
    data: {
      count: devices.length,
      devices: devices
    }
  });
}));

/**
 * Test notification endpoint (for development)
 * POST /notifications/test
 */
router.post('/test', asyncHandler(async (req, res) => {
  const { userId, title, body } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "userId is required."
    });
  }

  const notification = {
    title: title || 'Test Notification',
    body: body || 'This is a test notification from your backend.'
  };

  const data = {
    type: 'test',
    timestamp: new Date().toISOString()
  };

  const result = await PushNotificationService.sendToUser(userId, notification, data);

  res.json({
    success: result.success,
    message: result.success ? "Test notification sent." : "Failed to send notification.",
    data: result
  });
}));

/**
 * Manually trigger unresolved conversation check (for testing)
 * POST /notifications/check-unresolved
 */
router.post('/check-unresolved', asyncHandler(async (req, res) => {
  console.log('🔧 Manual unresolved conversation check triggered via API');
  
  // Run in background
  NotificationScheduler.triggerManualCheck().catch(err => {
    console.error('❌ Manual check failed:', err);
  });

  res.json({
    success: true,
    message: "Unresolved conversation check triggered. Check server logs for results."
  });
}));

module.exports = router;