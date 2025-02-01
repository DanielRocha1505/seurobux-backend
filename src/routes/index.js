const express = require('express');
const router = express.Router();
const PaymentController = require('../controllers/PaymentController');

// Importar outras rotas
const categoriesRoutes = require('./categories');
const productsRoutes = require('./products');
const couponsRoutes = require('./coupons');
const stockRoutes = require('./stock');
const cartRoutes = require('./cart');
const paymentsRoutes = require('./payments');
const settingsRoutes = require('./settings');

// Usar outras rotas
router.use(categoriesRoutes);
router.use(productsRoutes);
router.use(couponsRoutes);
router.use(stockRoutes);
router.use(cartRoutes);
router.use('/payments', paymentsRoutes);
router.use('/settings', settingsRoutes);

// Rotas de pagamento
router.post('/payments', PaymentController.createPayment);
router.post('/payments/webhook', PaymentController.handleWebhook);
router.get('/payments/:payment_id/status', PaymentController.getPaymentStatus);

module.exports = router;