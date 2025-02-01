const express = require('express');
const router = express.Router();
const SettingsController = require('../controllers/SettingsController');

router.get('/discord-webhooks', SettingsController.getWebhooks);
router.post('/discord-webhook', SettingsController.saveWebhook);
router.put('/discord-webhook/:id', SettingsController.updateWebhook);
router.delete('/discord-webhook/:id', SettingsController.deleteWebhook);

router.get('/payment', SettingsController.getPaymentSettings);
router.put('/payment', SettingsController.updatePaymentSettings);

router.get('/crisp', SettingsController.getCrispSettings);
router.put('/crisp', SettingsController.updateCrispSettings);

module.exports = router; 