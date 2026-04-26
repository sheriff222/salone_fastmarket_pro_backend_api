// services/pushNotificationService.js
const { getMessaging } = require('../config/firebase');
const UserDevice = require('../model/userDevice');
const { Conversation } = require('../model/message');

class PushNotificationService {
  
  /**
   * Send notification to a specific user (all their devices)
   */
  static async sendToUser(userId, notification, data = {}) {
    try {
      const devices = await UserDevice.find({ 
        userId, 
        isActive: true 
      });

      if (devices.length === 0) {
        console.log(`⚠️ No active devices for user ${userId}`);
        return { success: false, reason: 'no_devices' };
      }

      const tokens = devices.map(d => d.fcmToken);
      return await this.sendToTokens(tokens, notification, data);
      
    } catch (error) {
      console.error('❌ sendToUser error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send notification to multiple FCM tokens
   */
  static async sendToTokens(tokens, notification, data = {}) {
    if (!tokens || tokens.length === 0) {
      return { success: false, reason: 'no_tokens' };
    }

    try {
      const messaging = getMessaging();
      
      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
          ...(notification.imageUrl && { imageUrl: notification.imageUrl })
        },
        data: {
          ...data,
          timestamp: new Date().toISOString()
        },
        tokens: tokens,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'messages'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              'content-available': 1
            }
          }
        }
      };

      // ✅ FIX: Changed from sendEachForMultitoken to sendEachForMulticast
      const response = await messaging.sendEachForMulticast(message);
      
      console.log(`✅ Sent to ${response.successCount}/${tokens.length} devices`);
      
      // Clean up invalid tokens
      if (response.failureCount > 0) {
        await this.cleanupInvalidTokens(tokens, response.responses);
      }

      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
        responses: response.responses
      };

    } catch (error) {
      console.error('❌ sendToTokens error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send new message notification
   */
  static async sendMessageNotification(senderId, receiverId, conversationId, messagePreview, messageType = 'text') {
    try {
      const User = require('../model/user');
      const sender = await User.findById(senderId).select('fullName');
      
      if (!sender) {
        console.error('❌ Sender not found');
        return { success: false };
      }

      let bodyText = messagePreview;
      if (messageType === 'image') bodyText = '📷 Sent a photo';
      else if (messageType === 'video') bodyText = '🎥 Sent a video';
      else if (messageType === 'voice') bodyText = '🎵 Sent a voice message';
      else if (messageType === 'document') bodyText = '📄 Sent a document';

      const notification = {
        title: sender.fullName,
        body: bodyText
      };

      const data = {
        type: 'new_message',
        conversationId: conversationId.toString(),
        senderId: senderId.toString(),
        messageType,
        screen: 'messages'
      };

      return await this.sendToUser(receiverId, notification, data);
      
    } catch (error) {
      console.error('❌ sendMessageNotification error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send unresolved conversation reminder
   */
  static async sendUnresolvedConversationReminder(userId, conversationId, otherUserName, hoursSinceLastMessage) {
    try {
      const notification = {
        title: 'Unresolved Conversation',
        body: `You have an unread message from ${otherUserName} (${hoursSinceLastMessage}h ago)`
      };

      const data = {
        type: 'unresolved_conversation',
        conversationId: conversationId.toString(),
        screen: 'messages'
      };

      return await this.sendToUser(userId, notification, data);
      
    } catch (error) {
      console.error('❌ sendUnresolvedConversationReminder error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clean up invalid/expired FCM tokens
   */
  static async cleanupInvalidTokens(tokens, responses) {
    try {
      const invalidTokens = [];
      
      responses.forEach((response, index) => {
        if (!response.success) {
          const errorCode = response.error?.code;
          
          // FCM error codes that indicate invalid tokens
          if (errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered') {
            invalidTokens.push(tokens[index]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        await UserDevice.updateMany(
          { fcmToken: { $in: invalidTokens } },
          { isActive: false }
        );
        console.log(`🗑️ Deactivated ${invalidTokens.length} invalid tokens`);
      }
      
    } catch (error) {
      console.error('❌ cleanupInvalidTokens error:', error);
    }
  }

  /**
   * Register or update device token
   */
  static async registerDevice(userId, fcmToken, deviceInfo) {
    try {
      const existing = await UserDevice.findOne({ fcmToken });
      
      if (existing) {
        // Update existing device
        existing.userId = userId;
        existing.deviceInfo = deviceInfo;
        existing.isActive = true;
        existing.lastUsed = new Date();
        await existing.save();
        
        console.log(`✅ Updated device token for user ${userId}`);
        return { success: true, device: existing };
      }

      // Create new device
      const device = new UserDevice({
        userId,
        fcmToken,
        deviceInfo,
        isActive: true
      });
      
      await device.save();
      console.log(`✅ Registered new device for user ${userId}`);
      
      return { success: true, device };
      
    } catch (error) {
      console.error('❌ registerDevice error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Unregister device token (logout)
   */
  static async unregisterDevice(fcmToken) {
    try {
      await UserDevice.updateOne(
        { fcmToken },
        { isActive: false }
      );
      
      console.log(`✅ Unregistered device token`);
      return { success: true };
      
    } catch (error) {
      console.error('❌ unregisterDevice error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = PushNotificationService;