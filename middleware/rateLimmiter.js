// middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

// Analytics tracking rate limiter
// Allows 100 requests per 15 minutes per IP
const analyticsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 600, // Limit each IP to 100 requests per windowMs
    message: {
        success: false,
        message: 'Too many analytics requests from this IP, please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    
    // Skip successful requests from the count
    skipSuccessfulRequests: false,
    
    // Skip failed requests from the count
    skipFailedRequests: false,
    
    // Custom key generator (uses IP address)
    keyGenerator: (req) => {
        // Extract real IP (handles proxies/load balancers)
        return req.ip || 
               req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress || 
               'unknown';
    },
    
    // Custom handler for when rate limit is exceeded
    handler: (req, res) => {
        console.warn(`⚠️ Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
            success: false,
            message: 'Too many analytics requests. Please slow down.',
            retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
        });
    },
    
    // Store rate limit info in req object
    requestPropertyName: 'rateLimit',
    
    // Skip rate limiting for certain conditions
    skip: (req) => {
        // Skip if in development mode (optional)
        if (process.env.NODE_ENV === 'development' && process.env.SKIP_RATE_LIMIT === 'true') {
            return true;
        }
        
        // Skip if request is from trusted IP (optional)
        const trustedIPs = process.env.TRUSTED_IPS?.split(',') || [];
        const clientIP = req.ip || req.headers['x-forwarded-for']?.split(',')[0];
        return trustedIPs.includes(clientIP);
    }
});

// General API rate limiter (more restrictive)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // 500 requests per 15 minutes
    message: {
        success: false,
        message: 'Too many API requests from this IP.',
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Strict limiter for sensitive operations (auth, etc.)
const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // Only 20 requests per 15 minutes
    message: {
        success: false,
        message: 'Too many requests. Please wait before trying again.',
    },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = {
    analyticsLimiter,
    apiLimiter,
    strictLimiter
};