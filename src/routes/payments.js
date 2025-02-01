const express = require('express');
const router = express.Router();
const PaymentController = require('../controllers/PaymentController');

// Rotas de pagamento
router.post('/', PaymentController.createPayment);
router.post('/webhook', PaymentController.handleWebhook);

// Importante: rotas específicas antes das genéricas
router.get('/dashboard/stats', PaymentController.getDashboardStats);
router.get('/sales', PaymentController.getSales);

// Rotas com parâmetros depois
router.get('/:payment_id/status', PaymentController.getPaymentStatus);
router.get('/external/:external_id/status', PaymentController.getPaymentStatusByExternalId);
router.get('/:external_id/items', PaymentController.getSoldItems);

module.exports = router;