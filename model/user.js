const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    accountType: { type: String, enum: ['buyer', 'seller'], default: 'buyer' },
    fullName: { type: String, required: true },
    email: { type: String },
    dateOfBirth: { type: String },
    gender: { type: String },
    address: {
        street: { type: String },
        city: { type: String },
        district: { type: String },
        postalCode: { type: String }
    },
    businessInfo: {
        businessName: { type: String },
        businessRegNumber: { type: String },
        businessType: { type: String },
        businessDescription: { type: String },
        businessAddress: { type: String },
        businessPhone: { type: String },
        businessEmail: { type: String },
        taxId: { type: String },
        bankAccountDetails: { type: String },
        businessLicense: { type: String },
        businessHours: { type: String },
        deliveryAreas: [{ type: String }],
        productCategories: [{ type: String }]
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);




