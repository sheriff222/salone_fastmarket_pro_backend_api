const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();
const User = require('../model/user');
const { generateToken, protect } = require('../middleware/auth');

// Validate Sierra Leone phone number
const validateSierraLeonePhone = (phone) => {
    if (!phone) return 'Phone number is required';
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    const sierraLeonePattern = /^(\+232|232|0)[0-9]{8}$/;
    if (!sierraLeonePattern.test(cleanPhone)) {
        return 'Invalid Sierra Leone phone number format';
    }
    return null;
};

// Format phone number
const formatPhoneNumber = (phone) => {
    let cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    if (cleanPhone.startsWith('0')) {
        cleanPhone = `+232${cleanPhone.substring(1)}`;
    } else if (cleanPhone.startsWith('232')) {
        cleanPhone = `+${cleanPhone}`;
    }
    return cleanPhone;
};

// 🔐 Login with JWT
router.post('/login', asyncHandler(async (req, res) => {
    console.log('=== RAW REQUEST DEBUG ===');
    console.log('Content-Type:', req.get('Content-Type'));
    console.log('Content-Length:', req.get('Content-Length'));
    console.log('Raw Body:', req.body);
    console.log('Body type:', typeof req.body);
    console.log('Body keys:', Object.keys(req.body || {}));
    console.log('phoneNumber value:', req.body?.phoneNumber);
    console.log('password value:', req.body?.password);
    console.log('Headers:', req.headers);
    console.log('========================');

    const { phoneNumber, password } = req.body;

    const phoneValidation = validateSierraLeonePhone(phoneNumber);
    if (phoneValidation) {
        return res.status(400).json({ success: false, message: phoneValidation });
    }

    const formattedPhone = formatPhoneNumber(phoneNumber);
    const user = await User.findOne({ phoneNumber: formattedPhone });

    if (!user || user.password !== password) {
        return res.status(401).json({ success: false, message: "Invalid phone number or password." });
    }

    // Generate JWT token
    const token = generateToken(user._id);

    // Return user without password + token
    const userResponse = { ...user.toObject() };
    delete userResponse.password;

    res.status(200).json({ 
        success: true, 
        message: "Login successful.", 
        data: userResponse,
        token: token
    });
}));

// 👤 Get current user (protected route)
router.get('/me', protect, asyncHandler(async (req, res) => {
    const userResponse = { ...req.user.toObject() };
    delete userResponse.password;
    
    res.json({ 
        success: true, 
        message: "User retrieved successfully.", 
        data: userResponse 
    });
}));

// Get all users
router.get('/', asyncHandler(async (req, res) => {
    const users = await User.find().select('-password');
    res.json({ success: true, message: "Users retrieved successfully.", data: users });
}));

// Register
router.post('/register', asyncHandler(async (req, res) => {
    const {
        phoneNumber, password, accountType, fullName, email, dateOfBirth, gender,
        streetAddress, city, district, postalCode, businessInfo
    } = req.body;

    const phoneValidation = validateSierraLeonePhone(phoneNumber);
    if (phoneValidation) {
        return res.status(400).json({ success: false, message: phoneValidation });
    }

    if (!fullName) {
        return res.status(400).json({ success: false, message: "Full name is required." });
    }

    if (!password) {
        return res.status(400).json({ success: false, message: "Password is required." });
    }

    const formattedPhone = formatPhoneNumber(phoneNumber);
    const userExists = await User.findOne({ phoneNumber: formattedPhone });
    if (userExists) {
        return res.status(400).json({ success: false, message: "Phone number already registered." });
    }

    const userData = {
        phoneNumber: formattedPhone,
        password,
        accountType: accountType || 'buyer',
        fullName,
        email,
        dateOfBirth,
        gender,
        address: {
            street: streetAddress,
            city,
            district,
            postalCode
        }
    };

    if (accountType === 'seller' && businessInfo) {
        userData.businessInfo = {
            businessName: businessInfo.businessName,
            businessRegNumber: businessInfo.businessRegNumber,
            businessType: businessInfo.businessType,
            businessDescription: businessInfo.businessDescription,
            businessAddress: businessInfo.businessAddress,
            businessPhone: businessInfo.businessPhone,
            businessEmail: businessInfo.businessEmail,
            taxId: businessInfo.taxId,
            bankAccountDetails: businessInfo.bankAccountDetails,
            businessLicense: businessInfo.businessLicense,
            businessHours: businessInfo.businessHours,
            deliveryAreas: businessInfo.deliveryAreas,
            productCategories: businessInfo.productCategories
        };
    }

    const user = new User(userData);
    await user.save();
    
    // Generate token for auto-login after registration
    const token = generateToken(user._id);
    const userResponse = { ...user.toObject() };
    delete userResponse.password;

     res.status(201).json({ 
        success: true, 
        message: "User created successfully.", 
        data: userResponse,
        token: token
    });
}));

// Get a user by ID
router.get('/:id', asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
    }
    res.json({ success: true, message: "User retrieved successfully.", data: user });
}));

// Update a user (protected)
router.put('/:id', protect, asyncHandler(async (req, res) => {
    const {
        phoneNumber, password, accountType, fullName, email, dateOfBirth, gender,
        streetAddress, city, district, postalCode, businessInfo
    } = req.body;

     if (phoneNumber) {
        const phoneValidation = validateSierraLeonePhone(phoneNumber);
        if (phoneValidation) {
            return res.status(400).json({ success: false, message: phoneValidation });
        }
        userData.phoneNumber = formatPhoneNumber(phoneNumber);
    }
    
    if (password) {
        userData.password = password;
    }

    const userData = {
        phoneNumber: phoneNumber ? formatPhoneNumber(phoneNumber) : undefined,
        password,
        accountType,
        fullName,
        email,
        dateOfBirth,
        gender,
        address: {
            street: streetAddress,
            city,
            district,
            postalCode
        }
    };

    if (accountType === 'seller' && businessInfo) {
        userData.businessInfo = {
            businessName: businessInfo.businessName,
            businessRegNumber: businessInfo.businessRegNumber,
            businessType: businessInfo.businessType,
            businessDescription: businessInfo.businessDescription,
            businessAddress: businessInfo.businessAddress,
            businessPhone: businessInfo.businessPhone,
            businessEmail: businessInfo.businessEmail,
            taxId: businessInfo.taxId,
            bankAccountDetails: businessInfo.bankAccountDetails,
            businessLicense: businessInfo.businessLicense,
            businessHours: businessInfo.businessHours,
            deliveryAreas: businessInfo.deliveryAreas,
            productCategories: businessInfo.productCategories
        };
    }

    const updatedUser = await User.findByIdAndUpdate(
        req.params.id,
        { $set: userData },
        { new: true }
    ).select('-password');

    if (!updatedUser) {
        return res.status(404).json({ success: false, message: "User not found." });
    }

    res.json({ success: true, message: "User updated successfully.", data: updatedUser });
}));

// Delete a user (protected)
router.delete('/:id', protect, asyncHandler(async (req, res) => {
    const deletedUser = await User.findByIdAndDelete(req.params.id);
    if (!deletedUser) {
        return res.status(404).json({ success: false, message: "User not found." });
    }
    res.json({ success: true, message: "User deleted successfully." });
}));

module.exports = router;