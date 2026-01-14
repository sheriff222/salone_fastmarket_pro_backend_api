const formData = require('form-data');
const Mailgun = require('mailgun.js');

class EmailService {
  constructor() {
    // Initialize Mailgun
    if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
      const mailgun = new Mailgun(formData);
      this.mg = mailgun.client({
        username: 'api',
        key: process.env.MAILGUN_API_KEY,
      });
      this.domain = process.env.MAILGUN_DOMAIN;
      console.log('✅ Mailgun initialized');
    } else {
      console.warn('⚠️ MAILGUN_API_KEY or MAILGUN_DOMAIN not found in environment variables');
    }
  }

  /**
   * Send email to a single recipient
   */
  async sendSingleEmail({ to, from, subject, html, text }) {
    try {
      const messageData = {
        from: from || process.env.EMAIL_FROM || 'info@salonefastmarket.com',
        to: [to],
        subject,
        html: html || text,
        text: text || html?.replace(/<[^>]*>/g, ''), // Strip HTML for text version
      };

      const response = await this.mg.messages.create(this.domain, messageData);
      console.log(`✅ Email sent to ${to}`);
      return { success: true, messageId: response.id };
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error.message);
      throw error;
    }
  }

  /**
   * Send bulk emails (Mailgun supports multiple recipients)
   */
  async sendBulkEmail({ recipients, from, subject, html, text }) {
    try {
      const messageData = {
        from: from || process.env.EMAIL_FROM || 'info@salonefastmarket.com',
        to: recipients, // Array of email addresses
        subject,
        html: html || text,
        text: text || html?.replace(/<[^>]*>/g, ''),
      };

      const response = await this.mg.messages.create(this.domain, messageData);
      console.log(`✅ Bulk email sent to ${recipients.length} recipients`);
      return { 
        success: true, 
        recipientCount: recipients.length,
        messageId: response.id
      };
    } catch (error) {
      console.error('❌ Bulk email failed:', error.message);
      throw error;
    }
  }

  /**
   * Send emails in batches (for very large recipient lists)
   * Mailgun recommends max 1000 recipients per message
   */
  async sendBulkEmailInBatches({ recipients, from, subject, html, text, batchSize = 1000 }) {
    const results = {
      total: recipients.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Split into batches
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      
      try {
        await this.sendBulkEmail({ recipients: batch, from, subject, html, text });
        results.successful += batch.length;
        console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} sent (${batch.length} emails)`);
      } catch (error) {
        results.failed += batch.length;
        results.errors.push({
          batch: Math.floor(i / batchSize) + 1,
          error: error.message
        });
        console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} failed`);
      }

      // Small delay between batches to avoid rate limits
      if (i + batchSize < recipients.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  /**
   * Send personalized emails to multiple recipients using Mailgun's recipient variables
   */
  async sendPersonalizedBulkEmail({ recipients, from, subject, getHtmlContent, getTextContent }) {
    const results = {
      total: recipients.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Mailgun supports recipient variables for batch personalization
    // But for simplicity and full control, we'll send individually
    for (const recipient of recipients) {
      try {
        const html = getHtmlContent ? getHtmlContent(recipient) : null;
        const text = getTextContent ? getTextContent(recipient) : null;

        await this.sendSingleEmail({
          to: recipient.email,
          from,
          subject,
          html,
          text
        });

        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          email: recipient.email,
          error: error.message
        });
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }

  /**
   * Advanced: Send with Mailgun recipient variables for true batch personalization
   */
  async sendBatchPersonalized({ recipients, from, subject, htmlTemplate, textTemplate }) {
    try {
      // Prepare recipient variables
      const recipientVariables = {};
      const emails = recipients.map(r => {
        recipientVariables[r.email] = {
          fullName: r.fullName,
          email: r.email,
          accountType: r.accountType
        };
        return r.email;
      });

      const messageData = {
        from: from || process.env.EMAIL_FROM || 'info@salonefastmarket.com',
        to: emails,
        subject,
        html: htmlTemplate.replace(/\{fullName\}/g, '%recipient.fullName%')
                         .replace(/\{email\}/g, '%recipient.email%')
                         .replace(/\{accountType\}/g, '%recipient.accountType%'),
        text: textTemplate?.replace(/\{fullName\}/g, '%recipient.fullName%')
                          .replace(/\{email\}/g, '%recipient.email%')
                          .replace(/\{accountType\}/g, '%recipient.accountType%'),
        'recipient-variables': JSON.stringify(recipientVariables)
      };

      const response = await this.mg.messages.create(this.domain, messageData);
      console.log(`✅ Batch personalized email sent to ${emails.length} recipients`);
      
      return {
        success: true,
        recipientCount: emails.length,
        messageId: response.id
      };
    } catch (error) {
      console.error('❌ Batch personalized email failed:', error.message);
      throw error;
    }
  }
}

module.exports = new EmailService();