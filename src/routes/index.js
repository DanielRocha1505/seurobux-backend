const express = require('express');
const router = express.Router();

const categoriesRoutes = require('./categories');
const productsRoutes = require('./products');
const couponsRoutes = require('./coupons');
const stockRoutes = require('./stock');
const cartRoutes = require('./cart');
const paymentsRoutes = require('./payments');

router.use(categoriesRoutes);
router.use(productsRoutes);
router.use(couponsRoutes);
router.use(stockRoutes);
router.use(cartRoutes);
router.use(paymentsRoutes); 

module.exports = router;