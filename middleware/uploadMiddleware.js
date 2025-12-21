// middleware/uploadMiddleware.js - Fixed Multer configuration
const multer = require('multer');

// Use memory storage since we upload buffers to Cloudinary
const storage = multer.memoryStorage();

// Common file size limits
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB for images
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB for videos
const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB for voice notes
const MAX_DOC_SIZE = 20 * 1024 * 1024; // 20MB for documents

// Common file filter for images
const imageFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'), false);
    }
};

// Filter for videos
const videoFilter = (req, file, cb) => {
    const allowedMimes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only video files (mp4, mov, avi, mkv) are allowed'), false);
    }
};

// Filter for audio/voice
const audioFilter = (req, file, cb) => {
    const allowedMimes = ['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/ogg'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only audio files (mp3, wav, aac, ogg) are allowed'), false);
    }
};

// Filter for documents
const docFilter = (req, file, cb) => {
    const allowedMimes = ['application/pdf', 'application/msword', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
        'text/plain'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only document files (pdf, doc, docx, txt) are allowed'), false);
    }
};

// Upload handler for posters
const uploadPosterImages = multer({
    storage,
    limits: { fileSize: MAX_IMAGE_SIZE, files: 5 },
    fileFilter: imageFilter
});

// Upload handler for categories
const uploadCategoryImage = multer({
    storage,
    limits: { fileSize: MAX_IMAGE_SIZE },
    fileFilter: imageFilter
});

// Upload handler for products
const uploadProductImages = multer({
    storage,
    limits: { fileSize: MAX_IMAGE_SIZE, files: 10 },
    fileFilter: imageFilter
});

// FIXED: Message attachments upload - More permissive file filter
const uploadMessageAttachments = multer({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max
        files: 1
    },
    fileFilter: (req, file, cb) => {
        // Define allowed types for each message type
        const allowedTypes = {
            image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
            video: ['video/mp4', 'video/mpeg', 'video/3gpp', 'video/quicktime', 'video/x-msvideo'],
            voice: ['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/aac', 'audio/ogg', 'audio/webm'],
            document: [
                'application/pdf', 
                'text/plain', 
                'application/msword', 
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            ]
        };

        // Try to determine message type from field name if not in body yet
        let messageType = req.body?.messageType;
        
        // If messageType not in body, infer from field name
        if (!messageType) {
            if (file.fieldname === 'image') messageType = 'image';
            else if (file.fieldname === 'video') messageType = 'video';
            else if (file.fieldname === 'voice') messageType = 'voice';
            else if (file.fieldname === 'document') messageType = 'document';
        }

        // If still no message type, reject
        if (!messageType) {
            const error = new Error('Message type is required. Please send messageType field before the file.');
            error.status = 400;
            return cb(error);
        }

        // Validate file type against message type
        const validMimeTypes = allowedTypes[messageType];
        if (!validMimeTypes) {
            const error = new Error(`Invalid message type: ${messageType}`);
            error.status = 400;
            return cb(error);
        }

        if (!validMimeTypes.includes(file.mimetype)) {
            const error = new Error(
                `Invalid file type "${file.mimetype}" for ${messageType}. ` +
                `Allowed types: ${validMimeTypes.join(', ')}`
            );
            error.status = 400;
            return cb(error);
        }

        // All checks passed
        cb(null, true);
    }
}).fields([
    { name: 'image', maxCount: 1 },
    { name: 'video', maxCount: 1 },
    { name: 'voice', maxCount: 1 },
    { name: 'document', maxCount: 1 }
]);

// Error handler middleware
const handleMulterError = (req, res, next) => {
    if (req.multerError) {
        console.error('Multer error:', req.multerError);
        return res.status(req.multerError.status || 400).json({
            success: false,
            message: req.multerError.message || 'File upload error'
        });
    }
    if (next) next();
    return false;
};

const multerErrorMiddleware = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        req.multerError = {
            status: 400,
            message: err.message
        };
    } else if (err) {
        req.multerError = {
            status: err.status || 400,
            message: err.message || 'Unknown upload error'
        };
    }
    next();
};

module.exports = {
    handleMulterError,
    multerErrorMiddleware,
    uploadPosterImages,
    uploadCategoryImage,
    uploadProductImages,
    uploadMessageAttachments
};