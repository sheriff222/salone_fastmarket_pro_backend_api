const { v4: uuidv4 } = require('uuid');

/**
 * Extract real IP address from request (handles proxies/load balancers)
 * @param {Object} req - Express request object
 * @returns {String} - IP address
 */
function extractIPAddress(req) {
    // Priority order:
    // 1. X-Forwarded-For header (proxy/load balancer)
    // 2. X-Real-IP header (nginx)
    // 3. CF-Connecting-IP header (Cloudflare)
    // 4. req.ip (direct connection)
    // 5. req.connection.remoteAddress (fallback)
    
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        // X-Forwarded-For can contain multiple IPs (client, proxy1, proxy2...)
        // First IP is the real client IP
        return forwardedFor.split(',')[0].trim();
    }
    
    return req.headers['x-real-ip'] ||
           req.headers['cf-connecting-ip'] ||
           req.ip ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           'unknown';
}

/**
 * Generate unique session ID for guest users
 * @returns {String} - UUID session ID
 */
function generateSessionId() {
    return `guest_${uuidv4()}`;
}

/**
 * Validate analytics event data
 * @param {Object} eventData - Event data to validate
 * @returns {Object} - { valid: boolean, errors: array }
 */
function validateAnalyticsEvent(eventData) {
    const errors = [];
    
    // Required fields
    if (!eventData.productId) {
        errors.push('productId is required');
    }
    
    if (!eventData.action) {
        errors.push('action is required');
    }
    
    // Valid actions
    const validActions = [
        'view', 'click', 'add_to_cart', 'remove_from_cart', 
        'purchase', 'favorite', 'unfavorite', 'share', 'search',
        'review_added', 'review_updated', 'review_deleted'
    ];
    
    if (eventData.action && !validActions.includes(eventData.action)) {
        errors.push(`Invalid action. Must be one of: ${validActions.join(', ')}`);
    }
    
    // Action-specific validation
    if (eventData.action === 'search' && !eventData.metadata?.searchQuery) {
        errors.push('searchQuery is required in metadata for search action');
    }
    
    // Metadata validation
    if (eventData.metadata) {
        // Check metadata structure
        if (typeof eventData.metadata !== 'object') {
            errors.push('metadata must be an object');
        } else {
            // Validate source values
            const validSources = [
                'feed', 'search', 'category', 'recommendation', 
                'similar', 'trending', 'sponsored', 'review'
            ];
            if (eventData.metadata.source && !validSources.includes(eventData.metadata.source)) {
                errors.push(`Invalid source. Must be one of: ${validSources.join(', ')}`);
            }
            
            // Validate position (if provided)
            if (eventData.metadata.position !== undefined && eventData.metadata.position !== null) {
                const position = parseInt(eventData.metadata.position);
                if (isNaN(position) || position < 0) {
                    errors.push('position must be a non-negative number');
                }
            }
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Sanitize metadata to prevent injection attacks
 * @param {Object} metadata - Raw metadata
 * @returns {Object} - Sanitized metadata
 */
function sanitizeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return {};
    }
    
    const sanitized = {};
    const allowedFields = [
        'source', 'position', 'searchQuery', 'categoryId', 
        'referrer', 'sessionId', 'isSponsored', 'sponsorshipId',
        'rating', 'platform'
    ];
    
    allowedFields.forEach(field => {
        if (metadata[field] !== undefined && metadata[field] !== null) {
            // Convert to appropriate type and sanitize
            if (field === 'position' || field === 'rating') {
                sanitized[field] = parseInt(metadata[field]) || 0;
            } else if (field === 'isSponsored') {
                sanitized[field] = Boolean(metadata[field]);
            } else {
                // String fields - limit length and remove special characters
                sanitized[field] = String(metadata[field])
                    .slice(0, 500) // Max 500 chars
                    .replace(/[<>]/g, ''); // Remove < and > to prevent HTML injection
            }
        }
    });
    
    return sanitized;
}

/**
 * Calculate analytics aggregation (helper for reports)
 * @param {Array} events - Array of analytics events
 * @returns {Object} - Aggregated statistics
 */
function aggregateAnalytics(events) {
    const stats = {
        total: events.length,
        byAction: {},
        bySource: {},
        uniqueUsers: new Set(),
        uniqueProducts: new Set(),
        timeRange: {
            earliest: null,
            latest: null
        }
    };
    
    events.forEach(event => {
        // Count by action
        stats.byAction[event.action] = (stats.byAction[event.action] || 0) + 1;
        
        // Count by source
        const source = event.metadata?.source || 'unknown';
        stats.bySource[source] = (stats.bySource[source] || 0) + 1;
        
        // Track unique users and products
        if (event.userId) {
            stats.uniqueUsers.add(event.userId.toString());
        }
        if (event.productId) {
            stats.uniqueProducts.add(event.productId.toString());
        }
        
        // Track time range
        const eventTime = new Date(event.timestamp);
        if (!stats.timeRange.earliest || eventTime < stats.timeRange.earliest) {
            stats.timeRange.earliest = eventTime;
        }
        if (!stats.timeRange.latest || eventTime > stats.timeRange.latest) {
            stats.timeRange.latest = eventTime;
        }
    });
    
    // Convert sets to counts
    stats.uniqueUsers = stats.uniqueUsers.size;
    stats.uniqueProducts = stats.uniqueProducts.size;
    
    return stats;
}

/**
 * Check if user is rate limited (in-memory check before DB)
 * @param {String} identifier - User ID or IP address
 * @param {Number} limit - Max events per window
 * @param {Number} windowMs - Time window in milliseconds
 * @returns {Boolean} - True if rate limited
 */
const rateLimitCache = new Map();

function isRateLimited(identifier, limit = 100, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    const key = `${identifier}_${Math.floor(now / windowMs)}`;
    
    const cached = rateLimitCache.get(key);
    if (!cached) {
        rateLimitCache.set(key, { count: 1, expiry: now + windowMs });
        return false;
    }
    
    if (cached.expiry < now) {
        // Expired, reset
        rateLimitCache.delete(key);
        rateLimitCache.set(key, { count: 1, expiry: now + windowMs });
        return false;
    }
    
    cached.count++;
    return cached.count > limit;
}

// Clean up expired rate limit cache entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitCache.entries()) {
        if (value.expiry < now) {
            rateLimitCache.delete(key);
        }
    }
}, 5 * 60 * 1000);

/**
 * Format error response
 * @param {String} message - Error message
 * @param {Array} errors - Array of error details
 * @returns {Object} - Formatted error response
 */
function formatErrorResponse(message, errors = []) {
    return {
        success: false,
        message,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString()
    };
}

/**
 * Format success response
 * @param {String} message - Success message
 * @param {Object} data - Response data
 * @returns {Object} - Formatted success response
 */
function formatSuccessResponse(message, data = null) {
    return {
        success: true,
        message,
        data,
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    extractIPAddress,
    generateSessionId,
    validateAnalyticsEvent,
    sanitizeMetadata,
    aggregateAnalytics,
    isRateLimited,
    formatErrorResponse,
    formatSuccessResponse
};