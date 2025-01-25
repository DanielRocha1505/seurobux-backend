const express = require('express');
const router = express.Router();
const PaymentController = require('../controllers/PaymentController');

router.post('/payments', PaymentController.createPayment);
router.post('/payments/webhook', PaymentController.handleWebhook);
router.get('/payments/:payment_id/status', PaymentController.getPaymentStatus);

module.exports = router;