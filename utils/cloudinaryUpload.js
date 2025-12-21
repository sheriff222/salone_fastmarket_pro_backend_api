// utils/cloudinaryUpload.js
const { cloudinary } = require('../config/cloudinary');
const streamifier = require('streamifier');

/**
 * Get folder path with optional subfolder from .env
 * @param {string} type - Type of upload (products, categories, posters, messages)
 * @param {string} subtype - Subtype for messages (images, videos, voice, documents)
 */
const getCloudinaryFolder = (type, subtype = null) => {
    const baseFolder = process.env.CLOUDINARY_FOLDER || 'sfm-ecommerce';
    
    if (subtype) {
        return `${baseFolder}/${type}/${subtype}`;
    }
    return `${baseFolder}/${type}`;
};

/**
 * Upload a file buffer to Cloudinary
 * @param {Buffer} fileBuffer - File buffer from multer
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} - Cloudinary upload result
 */
const uploadToCloudinary = (fileBuffer, options = {}) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: options.folder || getCloudinaryFolder('general'),
                resource_type: options.resource_type || 'auto',
                transformation: options.transformation || null,
                public_id: options.public_id || undefined,
                overwrite: options.overwrite || false,
                invalidate: true,
                ...options
            },
            (error, result) => {
                if (error) {
                    console.error('❌ Cloudinary upload error:', error);
                    reject(error);
                } else {
                    console.log('✅ File uploaded to Cloudinary:', result.secure_url);
                    resolve(result);
                }
            }
        );

        streamifier.createReadStream(fileBuffer).pipe(uploadStream);
    });
};

/**
 * Upload product image with optimization
 */
const uploadProductImage = async (fileBuffer, filename) => {
    try {
        const result = await uploadToCloudinary(fileBuffer, {
            folder: getCloudinaryFolder('products'),
            resource_type: 'image',
            transformation: [
                { quality: 'auto', fetch_format: 'auto' },
                { width: 1000, height: 1000, crop: 'limit' }
            ],
            public_id: `product_${Date.now()}_${filename.replace(/\.[^/.]+$/, '')}`
        });

        return {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            width: result.width,
            height: result.height
        };
    } catch (error) {
        console.error('Product image upload error:', error);
        throw error;
    }
};

/**
 * Upload category image with optimization
 */
const uploadCategoryImage = async (fileBuffer, filename) => {
    try {
        const result = await uploadToCloudinary(fileBuffer, {
            folder: getCloudinaryFolder('categories'),
            resource_type: 'image',
            transformation: [
                { quality: 'auto', fetch_format: 'auto' },
                { width: 500, height: 500, crop: 'fill', gravity: 'center' }
            ],
            public_id: `category_${Date.now()}_${filename.replace(/\.[^/.]+$/, '')}`
        });

        return {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format
        };
    } catch (error) {
        console.error('Category image upload error:', error);
        throw error;
    }
};

/**
 * Upload poster image (marketing banner)
 */
const uploadPosterImage = async (fileBuffer, filename, order = 0) => {
    try {
        const result = await uploadToCloudinary(fileBuffer, {
            folder: getCloudinaryFolder('posters'),
            resource_type: 'image',
            transformation: [
                { quality: 'auto', fetch_format: 'auto' },
                { width: 1920, height: 1080, crop: 'limit' }
            ],
            public_id: `poster_${Date.now()}_${order}_${filename.replace(/\.[^/.]+$/, '')}`
        });

        return {
            url: result.secure_url,
            publicId: result.public_id,
            filename: result.public_id,
            order: order,
            format: result.format
        };
    } catch (error) {
        console.error('Poster image upload error:', error);
        throw error;
    }
};

/**
 * Upload message image
 */
const uploadMessageImage = async (fileBuffer, filename) => {
    try {
        const result = await uploadToCloudinary(fileBuffer, {
            folder: getCloudinaryFolder('messages', 'images'),
            resource_type: 'image',
            transformation: [
                { quality: 'auto', fetch_format: 'auto' },
                { width: 1200, height: 1200, crop: 'limit' }
            ],
            public_id: `msg_img_${Date.now()}_${filename.replace(/\.[^/.]+$/, '')}`
        });

        return {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            size: result.bytes
        };
    } catch (error) {
        console.error('Message image upload error:', error);
        throw error;
    }
};

/**
 * Upload message video
 */
const uploadMessageVideo = async (fileBuffer, filename) => {
    try {
        const result = await uploadToCloudinary(fileBuffer, {
            folder: getCloudinaryFolder('messages', 'videos'),
            resource_type: 'video',
            transformation: [
                { quality: 'auto', fetch_format: 'auto' },
                { width: 1280, height: 720, crop: 'limit' }
            ],
            public_id: `msg_video_${Date.now()}_${filename.replace(/\.[^/.]+$/, '')}`
        });

        return {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            duration: result.duration,
            size: result.bytes
        };
    } catch (error) {
        console.error('Message video upload error:', error);
        throw error;
    }
};

/**
 * Upload message voice/audio
 */
const uploadMessageVoice = async (fileBuffer, filename) => {
    try {
        const result = await uploadToCloudinary(fileBuffer, {
            folder: getCloudinaryFolder('messages', 'voice'),
            resource_type: 'video', // Audio files use 'video' resource type in Cloudinary
            public_id: `msg_voice_${Date.now()}_${filename.replace(/\.[^/.]+$/, '')}`
        });

        return {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            duration: result.duration,
            size: result.bytes
        };
    } catch (error) {
        console.error('Message voice upload error:', error);
        throw error;
    }
};

/**
 * Upload message document
 */
const uploadMessageDocument = async (fileBuffer, filename) => {
    try {
        const result = await uploadToCloudinary(fileBuffer, {
            folder: getCloudinaryFolder('messages', 'documents'),
            resource_type: 'raw', // For non-media files
            public_id: `msg_doc_${Date.now()}_${filename.replace(/\.[^/.]+$/, '')}`
        });

        return {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            size: result.bytes,
            originalFilename: filename
        };
    } catch (error) {
        console.error('Message document upload error:', error);
        throw error;
    }
};

/**
 * Delete file from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @param {string} resourceType - Type of resource (image, video, raw)
 */
const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
    try {
        const result = await cloudinary.uploader.destroy(publicId, {
            resource_type: resourceType,
            invalidate: true
        });
        
        console.log('🗑️ Deleted from Cloudinary:', publicId);
        return result;
    } catch (error) {
        console.error('Delete from Cloudinary error:', error);
        throw error;
    }
};

/**
 * Delete multiple files from Cloudinary
 * @param {Array<string>} publicIds - Array of public IDs
 * @param {string} resourceType - Type of resource
 */
const deleteMultipleFromCloudinary = async (publicIds, resourceType = 'image') => {
    try {
        const result = await cloudinary.api.delete_resources(publicIds, {
            resource_type: resourceType,
            invalidate: true
        });
        
        console.log(`🗑️ Deleted ${publicIds.length} files from Cloudinary`);
        return result;
    } catch (error) {
        console.error('Bulk delete from Cloudinary error:', error);
        throw error;
    }
};

/**
 * Get optimized image URL with transformations
 * @param {string} publicId - Cloudinary public ID
 * @param {Object} transformations - Transformation options
 */
const getOptimizedImageUrl = (publicId, transformations = {}) => {
    return cloudinary.url(publicId, {
        secure: true,
        transformation: [
            { quality: 'auto', fetch_format: 'auto' },
            ...Object.entries(transformations).map(([key, value]) => ({ [key]: value }))
        ]
    });
};

/**
 * Extract public ID from Cloudinary URL
 * @param {string} url - Cloudinary URL
 */
const extractPublicId = (url) => {
    if (!url || typeof url !== 'string') return null;
    
    try {
        // Extract public_id from Cloudinary URL
        const matches = url.match(/\/v\d+\/(.+)\.[^.]+$/);
        if (matches && matches[1]) {
            return matches[1];
        }
        
        // Alternative pattern
        const altMatches = url.match(/\/([^/]+\/[^/]+\/[^/]+)\.[^.]+$/);
        if (altMatches && altMatches[1]) {
            return altMatches[1];
        }
        
        return null;
    } catch (error) {
        console.error('Error extracting public ID:', error);
        return null;
    }
};

/**
 * Format file size
 * @param {number} bytes - Size in bytes
 */
const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

module.exports = {
    uploadToCloudinary,
    uploadProductImage,
    uploadCategoryImage,
    uploadPosterImage,
    uploadMessageImage,
    uploadMessageVideo,
    uploadMessageVoice,
    uploadMessageDocument,
    deleteFromCloudinary,
    deleteMultipleFromCloudinary,
    getOptimizedImageUrl,
    extractPublicId,
    formatFileSize,
    getCloudinaryFolder
};