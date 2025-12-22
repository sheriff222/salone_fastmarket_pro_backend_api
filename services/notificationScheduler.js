// services/notificationScheduler.js - FIXED VERSION
const cron = require('node-cron');
const { Conversation, Message } = require('../model/message');
const PushNotificationService = require('./pushNotificationService');
const User = require('../model/user');

class NotificationScheduler {
  
  // Track last notification time per conversation to avoid spam
  static lastNotificationMap = new Map(); // conversationId -> timestamp

  /**
   * Start all scheduled notification jobs
   */
  static start() {
    console.log('🕐 Starting notification scheduler...');
    
    // Check every 30 minutes for unresolved conversations
    cron.schedule('*/30 * * * *', async () => {
      const now = new Date();
      console.log(`🔍 [${now.toISOString()}] Checking for unresolved conversations...`);
      await this.checkUnresolvedConversations();
    });

    console.log('✅ Notification scheduler started (runs every 30 minutes)');
  }

  /**
   * Check for unresolved conversations and send reminders
   */
  static async checkUnresolvedConversations() {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now - 60 * 60 * 1000);

      console.log(`📊 Looking for conversations updated before: ${oneHourAgo.toISOString()}`);

      // Find conversations with:
      // 1. Last update was more than 1 hour ago
      // 2. Not deleted
      // 3. Has unread messages
      const conversations = await Conversation.find({
        updatedAt: { $lt: oneHourAgo },
        isDeleted: false,
        'lastMessage.timestamp': { $exists: true }
      }).populate([
        { path: 'buyerId', select: 'fullName phoneNumber' },
        { path: 'sellerId', select: 'fullName phoneNumber' }
      ]);

      console.log(`📋 Found ${conversations.length} conversations to check`);

      let notificationsSent = 0;

      for (const conv of conversations) {
        const sent = await this.processConversation(conv, now);
        if (sent) notificationsSent++;
      }

      console.log(`✅ Sent ${notificationsSent} unresolved conversation reminders`);

    } catch (error) {
      console.error('❌ checkUnresolvedConversations error:', error);
    }
  }

  /**
   * Process a single conversation for unresolved messages
   */
  static async processConversation(conversation, now) {
    try {
      const conversationId = conversation._id.toString();
      
      // Calculate hours since last message
      const lastMessageTime = new Date(conversation.lastMessage?.timestamp || conversation.updatedAt);
      const hoursSinceLastMessage = Math.floor((now - lastMessageTime) / (1000 * 60 * 60));

      // Skip if last message was less than 1 hour ago
      if (hoursSinceLastMessage < 1) {
        return false;
      }

      // Check if we've sent a notification recently (within last 23 hours)
      const lastNotificationTime = this.lastNotificationMap.get(conversationId);
      if (lastNotificationTime) {
        const hoursSinceLastNotification = Math.floor((now - lastNotificationTime) / (1000 * 60 * 60));
        
        if (hoursSinceLastNotification < 23) {
          // Skip this conversation - we sent a notification recently
          return false;
        }
      }

      // Get unread counts
      const buyerId = conversation.buyerId?._id || conversation.buyerId;
      const sellerId = conversation.sellerId?._id || conversation.sellerId;

      const buyerUnreadCount = conversation.unreadCounts.get(buyerId?.toString()) || 0;
      const sellerUnreadCount = conversation.unreadCounts.get(sellerId?.toString()) || 0;

      // Skip if no unread messages
      if (buyerUnreadCount === 0 && sellerUnreadCount === 0) {
        return false;
      }

      console.log(`📬 Conversation ${conversationId} has unread messages:`);
      console.log(`   Buyer: ${buyerUnreadCount}, Seller: ${sellerUnreadCount}`);
      console.log(`   Hours since last message: ${hoursSinceLastMessage}`);

      let notificationsSent = false;

      // Send reminder to buyer if they have unread messages
      if (buyerUnreadCount > 0 && buyerId) {
        const sellerName = conversation.sellerId?.fullName || 'Seller';
        console.log(`📤 Sending reminder to buyer (${buyerUnreadCount} unread messages)`);
        
        await PushNotificationService.sendUnresolvedConversationReminder(
          buyerId,
          conversation._id,
          sellerName,
          hoursSinceLastMessage
        );
        
        notificationsSent = true;
      }

      // Send reminder to seller if they have unread messages
      if (sellerUnreadCount > 0 && sellerId) {
        const buyerName = conversation.buyerId?.fullName || 'Buyer';
        console.log(`📤 Sending reminder to seller (${sellerUnreadCount} unread messages)`);
        
        await PushNotificationService.sendUnresolvedConversationReminder(
          sellerId,
          conversation._id,
          buyerName,
          hoursSinceLastMessage
        );
        
        notificationsSent = true;
      }

      // Update last notification time
      if (notificationsSent) {
        this.lastNotificationMap.set(conversationId, now);
        console.log(`✅ Reminders sent for conversation ${conversationId}`);
      }

      return notificationsSent;

    } catch (error) {
      console.error(`❌ processConversation error for ${conversation._id}:`, error);
      return false;
    }
  }

  /**
   * Manual trigger for testing
   */
  static async triggerManualCheck() {
    console.log('🔧 ========================================');
    console.log('🔧 MANUAL UNRESOLVED CONVERSATION CHECK');
    console.log('🔧 ========================================');
    
    // Clear the last notification map to force new notifications
    this.lastNotificationMap.clear();
    console.log('🗑️ Cleared notification cooldown map');
    
    await this.checkUnresolvedConversations();
    
    console.log('🔧 ========================================');
    console.log('🔧 MANUAL CHECK COMPLETED');
    console.log('🔧 ========================================');
  }

  /**
   * Clear notification cooldown for testing
   */
  static clearCooldowns() {
    this.lastNotificationMap.clear();
    console.log('🗑️ All notification cooldowns cleared');
  }

  /**
   * Get scheduler statistics
   */
  static getStats() {
    return {
      trackedConversations: this.lastNotificationMap.size,
      cooldowns: Array.from(this.lastNotificationMap.entries()).map(([convId, timestamp]) => ({
        conversationId: convId,
        lastNotificationTime: timestamp,
        hoursSince: Math.floor((Date.now() - timestamp) / (1000 * 60 * 60))
      }))
    };
  }
}

module.exports = NotificationScheduler;