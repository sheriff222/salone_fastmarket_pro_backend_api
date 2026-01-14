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
      console.log(`📧 Using domain: ${this.domain}`);
    } else {
      console.warn('⚠️ MAILGUN_API_KEY or MAILGUN_DOMAIN not found in environment variables');
    }
  }

  /**
   * Send email to a single recipient
   */
  async sendSingleEmail({ to, from, subject, html, text }) {
    try {
      // Skip if email is null or invalid
      if (!to || !this.isValidEmail(to)) {
        console.warn(`⚠️ Skipping invalid email: ${to}`);
        throw new Error(`Invalid email address: ${to}`);
      }

      const messageData = {
        from: from || process.env.EMAIL_FROM || 'Salone Fast Market <info@salonefastmarket.com>',
        to: to,
        subject,
        html: html || text,
        text: text || this.stripHtml(html),
      };

      const response = await this.mg.messages.create(this.domain, messageData);
      console.log(`✅ Email sent to ${to}`);
      return { success: true, messageId: response.id };
    } catch (error) {
      // Check if it's a sandbox domain error
      if (error.message && error.message.includes('Forbidden')) {
        console.error(`❌ SANDBOX DOMAIN ERROR: ${to} is not an authorized recipient`);
        console.error('💡 Add this email to authorized recipients in Mailgun dashboard or verify a custom domain');
        throw new Error(`Sandbox domain: ${to} not authorized. Add to Mailgun authorized recipients list.`);
      }
      console.error(`❌ Failed to send email to ${to}:`, error.message);
      throw error;
    }
  }

  /**
   * Validate email format
   */
  isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Strip HTML tags
   */
  stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '');
  }

  /**
   * Send bulk emails (one by one to handle errors gracefully)
   */
  async sendBulkEmail({ recipients, from, subject, html, text }) {
    try {
      // Filter out invalid emails
      const validRecipients = recipients.filter(email => this.isValidEmail(email));
      
      if (validRecipients.length === 0) {
        throw new Error('No valid email addresses provided');
      }

      console.log(`📧 Sending to ${validRecipients.length} valid recipients`);

      const results = {
        successful: 0,
        failed: 0,
        errors: []
      };

      // Send emails one by one to handle sandbox restrictions
      for (const recipient of validRecipients) {
        try {
          await this.sendSingleEmail({ to: recipient, from, subject, html, text });
          results.successful++;
          
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          results.failed++;
          results.errors.push({
            email: recipient,
            error: error.message
          });
        }
      }

      console.log(`✅ Bulk email completed: ${results.successful} successful, ${results.failed} failed`);
      
      return { 
        success: results.successful > 0, 
        recipientCount: validRecipients.length,
        successful: results.successful,
        failed: results.failed,
        errors: results.errors
      };
    } catch (error) {
      console.error('❌ Bulk email failed:', error.message);
      throw error;
    }
  }

  /**
   * Send emails in batches (for very large recipient lists)
   */
  async sendBulkEmailInBatches({ recipients, from, subject, html, text, batchSize = 100 }) {
    const results = {
      total: recipients.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Filter out invalid emails first
    const validRecipients = recipients.filter(email => this.isValidEmail(email));
    
    if (validRecipients.length === 0) {
      return {
        ...results,
        failed: recipients.length,
        errors: [{ error: 'No valid email addresses found' }]
      };
    }

    console.log(`📧 Processing ${validRecipients.length} valid emails out of ${recipients.length} total`);

    // Split into batches
    for (let i = 0; i < validRecipients.length; i += batchSize) {
      const batch = validRecipients.slice(i, i + batchSize);
      
      try {
        const batchResult = await this.sendBulkEmail({ 
          recipients: batch, 
          from, 
          subject, 
          html, 
          text 
        });
        
        results.successful += batchResult.successful;
        results.failed += batchResult.failed;
        
        if (batchResult.errors && batchResult.errors.length > 0) {
          results.errors.push(...batchResult.errors);
        }
        
        console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} completed (${batchResult.successful}/${batch.length} sent)`);
      } catch (error) {
        results.failed += batch.length;
        results.errors.push({
          batch: Math.floor(i / batchSize) + 1,
          error: error.message
        });
        console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} failed`);
      }

      // Delay between batches
      if (i + batchSize < validRecipients.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  /**
   * Send personalized emails to multiple recipients
   */
  async sendPersonalizedBulkEmail({ recipients, from, subject, getHtmlContent, getTextContent }) {
    const results = {
      total: recipients.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    for (const recipient of recipients) {
      // Skip if no valid email
      if (!recipient.email || !this.isValidEmail(recipient.email)) {
        results.failed++;
        results.errors.push({
          email: recipient.email || 'null',
          error: 'Invalid or missing email address'
        });
        continue;
      }

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
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    return results;
  }

  /**
   * Check if using sandbox domain
   */
  isSandboxDomain() {
    return this.domain && this.domain.includes('sandbox');
  }

  /**
   * Get domain info
   */
  getDomainInfo() {
    return {
      domain: this.domain,
      isSandbox: this.isSandboxDomain(),
      warning: this.isSandboxDomain() 
        ? 'You are using a sandbox domain. You can only send to authorized recipients. Add recipients in Mailgun dashboard or verify a custom domain.'
        : null
    };
  }
}

module.exports = new EmailService();