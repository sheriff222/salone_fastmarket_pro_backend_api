// services/notificationScheduler.js
const cron = require('node-cron');
const { Conversation, Message } = require('../model/message');
const PushNotificationService = require('./pushNotificationService');
const User = require('../model/user');

class NotificationScheduler {
  
  /**
   * Start all scheduled notification jobs
   */
  static start() {
    console.log('🕐 Starting notification scheduler...');
    
    // Check every 15 minutes for unresolved conversations
    cron.schedule('*/15 * * * *', async () => {
      console.log('🔍 Checking for unresolved conversations...');
      await this.checkUnresolvedConversations();
    });

    console.log('✅ Notification scheduler started');
  }

  /**
   * Check for unresolved conversations and send reminders
   */
  static async checkUnresolvedConversations() {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now - 60 * 60 * 1000);
      const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

      // Find conversations with unread messages older than 1 hour
      const conversations = await Conversation.find({
        updatedAt: { $lt: oneHourAgo },
        isDeleted: false,
        $or: [
          { 'lastMessage.timestamp': { $exists: true } }
        ]
      }).populate([
        { path: 'buyerId', select: 'fullName' },
        { path: 'sellerId', select: 'fullName' }
      ]);

      console.log(`📊 Found ${conversations.length} conversations to check`);

      for (const conv of conversations) {
        await this.processConversation(conv, now);
      }

    } catch (error) {
      console.error('❌ checkUnresolvedConversations error:', error);
    }
  }

  /**
   * Process a single conversation for unresolved messages
   */
  static async processConversation(conversation, now) {
    try {
      const lastMessageTime = new Date(conversation.lastMessage?.timestamp || conversation.updatedAt);
      const hoursSinceLastMessage = Math.floor((now - lastMessageTime) / (1000 * 60 * 60));

      // Skip if last message was less than 1 hour ago
      if (hoursSinceLastMessage < 1) {
        return;
      }

      // Get unread counts
      const buyerId = conversation.buyerId?._id || conversation.buyerId;
      const sellerId = conversation.sellerId?._id || conversation.sellerId;

      const buyerUnreadCount = conversation.unreadCounts.get(buyerId?.toString()) || 0;
      const sellerUnreadCount = conversation.unreadCounts.get(sellerId?.toString()) || 0;

      // Check if there are unread messages for either party
      if (buyerUnreadCount === 0 && sellerUnreadCount === 0) {
        return; // Both parties have read all messages
      }

      // Determine notification timing (1h, 24h, 48h, etc.)
      const shouldNotify = 
        hoursSinceLastMessage === 1 || // First reminder after 1 hour
        (hoursSinceLastMessage >= 24 && hoursSinceLastMessage % 24 === 0); // Then every 24 hours

      if (!shouldNotify) {
        return;
      }

      console.log(`📬 Sending reminders for conversation ${conversation._id}`);

      // Send reminder to buyer if they have unread messages
      if (buyerUnreadCount > 0 && buyerId) {
        const sellerName = conversation.sellerId?.fullName || 'Seller';
        await PushNotificationService.sendUnresolvedConversationReminder(
          buyerId,
          conversation._id,
          sellerName,
          hoursSinceLastMessage
        );
        console.log(`✅ Sent reminder to buyer (${buyerUnreadCount} unread)`);
      }

      // Send reminder to seller if they have unread messages
      if (sellerUnreadCount > 0 && sellerId) {
        const buyerName = conversation.buyerId?.fullName || 'Buyer';
        await PushNotificationService.sendUnresolvedConversationReminder(
          sellerId,
          conversation._id,
          buyerName,
          hoursSinceLastMessage
        );
        console.log(`✅ Sent reminder to seller (${sellerUnreadCount} unread)`);
      }

    } catch (error) {
      console.error(`❌ processConversation error for ${conversation._id}:`, error);
    }
  }

  /**
   * Manual trigger for testing
   */
  static async triggerManualCheck() {
    console.log('🔧 Manual unresolved conversation check triggered');
    await this.checkUnresolvedConversations();
  }
}

module.exports = NotificationScheduler;