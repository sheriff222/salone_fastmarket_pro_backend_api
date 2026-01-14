const express = require('express');
const router = express.Router();
const User = require('../model/user');
const emailService = require('../services/emailService');

/**
 * GET all users with emails
 * Returns list of all users who have email addresses
 */
router.get('/users', async (req, res) => {
  try {
    const users = await User.find(
      { email: { $exists: true, $ne: null, $ne: '' } },
      { fullName: 1, email: 1, phoneNumber: 1, accountType: 1 }
    ).sort({ fullName: 1 });

    res.json({
      success: true,
      message: `Found ${users.length} users with email addresses`,
      data: {
        total: users.length,
        users: users.map(user => ({
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          accountType: user.accountType
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

/**
 * GET user statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const usersWithEmail = await User.countDocuments({ 
      email: { $exists: true, $ne: null, $ne: '' } 
    });
    const buyers = await User.countDocuments({ 
      accountType: 'buyer',
      email: { $exists: true, $ne: null, $ne: '' } 
    });
    const sellers = await User.countDocuments({ 
      accountType: 'seller',
      email: { $exists: true, $ne: null, $ne: '' } 
    });

    res.json({
      success: true,
      data: {
        totalUsers,
        usersWithEmail,
        usersWithoutEmail: totalUsers - usersWithEmail,
        buyers,
        sellers
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
});

/**
 * POST send email to specific users
 */
router.post('/send', async (req, res) => {
  try {
    const { recipients, from, subject, htmlContent, textContent } = req.body;

    // Validation
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Recipients array is required and cannot be empty'
      });
    }

    if (!subject || subject.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Subject is required'
      });
    }

    if (!htmlContent && !textContent) {
      return res.status(400).json({
        success: false,
        message: 'Either htmlContent or textContent is required'
      });
    }

    // Validate all recipients have email addresses
    const invalidRecipients = recipients.filter(email => 
      !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    );

    if (invalidRecipients.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email addresses found',
        data: { invalidRecipients }
      });
    }

    // Send emails
    const result = await emailService.sendBulkEmailInBatches({
      recipients,
      from: from || 'info@salonefastmarket.com',
      subject,
      html: htmlContent,
      text: textContent
    });

    res.json({
      success: true,
      message: 'Email sending completed',
      data: result
    });

  } catch (error) {
    console.error('Error sending emails:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send emails',
      error: error.message
    });
  }
});

/**
 * POST send email to all users
 */
router.post('/send-all', async (req, res) => {
  try {
    const { from, subject, htmlContent, textContent, accountType } = req.body;

    // Validation
    if (!subject || subject.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Subject is required'
      });
    }

    if (!htmlContent && !textContent) {
      return res.status(400).json({
        success: false,
        message: 'Either htmlContent or textContent is required'
      });
    }

    // Build query
    const query = { email: { $exists: true, $ne: null, $ne: '' } };
    if (accountType && ['buyer', 'seller'].includes(accountType)) {
      query.accountType = accountType;
    }

    // Get all users with emails
    const users = await User.find(query, { email: 1 });
    const recipients = users.map(user => user.email);

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No users with email addresses found'
      });
    }

    // Send emails
    const result = await emailService.sendBulkEmailInBatches({
      recipients,
      from: from || 'info@salonefastmarket.com',
      subject,
      html: htmlContent,
      text: textContent
    });

    res.json({
      success: true,
      message: `Email sent to ${accountType || 'all'} users`,
      data: result
    });

  } catch (error) {
    console.error('Error sending bulk emails:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send bulk emails',
      error: error.message
    });
  }
});

/**
 * POST send personalized emails
 */
router.post('/send-personalized', async (req, res) => {
  try {
    const { from, subject, htmlTemplate, textTemplate, accountType } = req.body;

    if (!subject || (!htmlTemplate && !textTemplate)) {
      return res.status(400).json({
        success: false,
        message: 'Subject and template content are required'
      });
    }

    // Build query
    const query = { email: { $exists: true, $ne: null, $ne: '' } };
    if (accountType && ['buyer', 'seller'].includes(accountType)) {
      query.accountType = accountType;
    }

    // Get users
    const users = await User.find(query, { 
      email: 1, 
      fullName: 1, 
      accountType: 1 
    });

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No users found'
      });
    }

    // Send personalized emails
    const result = await emailService.sendPersonalizedBulkEmail({
      recipients: users,
      from: from || 'info@salonefastmarket.com',
      subject,
      getHtmlContent: (user) => {
        return htmlTemplate
          .replace(/\{fullName\}/g, user.fullName)
          .replace(/\{email\}/g, user.email)
          .replace(/\{accountType\}/g, user.accountType);
      },
      getTextContent: (user) => {
        if (!textTemplate) return null;
        return textTemplate
          .replace(/\{fullName\}/g, user.fullName)
          .replace(/\{email\}/g, user.email)
          .replace(/\{accountType\}/g, user.accountType);
      }
    });

    res.json({
      success: true,
      message: 'Personalized emails sent',
      data: result
    });

  } catch (error) {
    console.error('Error sending personalized emails:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send personalized emails',
      error: error.message
    });
  }
});

module.exports = router;