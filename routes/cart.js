const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Define CartItem schema (matches Flutter's Items model)
const cartItemSchema = new mongoose.Schema({
  productID: { type: String, required: true },
  productName: String,
  quantity: Number,
  price: Number,
  variant: String,
  sellerName: String,
});

const cartSchema = new mongoose.Schema({
  userID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [cartItemSchema],
});

const Cart = mongoose.model('Cart', cartSchema);

// Get user's cart
router.get('/:userId', async (req, res) => {
  try {
    const cart = await Cart.findOne({ userID: req.params.userId });
    if (!cart) return res.json({ success: true, data: [] });
    res.json({ success: true, data: cart.items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add item to cart
router.post('/:userId', async (req, res) => {
  try {
    let cart = await Cart.findOne({ userID: req.params.userId });
    if (!cart) {
      cart = new Cart({ userID: req.params.userId, items: [] });
    }
    cart.items.push(req.body);
    await cart.save();
    res.json({ success: true, data: cart.items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Remove item from cart
router.delete('/:userId/:itemId', async (req, res) => {
  try {
    const cart = await Cart.findOne({ userID: req.params.userId });
    if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });
    cart.items = cart.items.filter(item => item._id.toString() !== req.params.itemId);
    await cart.save();
    res.json({ success: true, data: cart.items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Clear cart
router.delete('/:userId', async (req, res) => {
  try {
    const cart = await Cart.findOne({ userID: req.params.userId });
    if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });
    cart.items = [];
    await cart.save();
    res.json({ success: true, data: [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;