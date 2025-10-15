// api/payments/payments.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./payments.controller');
const { isAuthenticated } = require('../../middlewares/auth.middleware');

router.post('/', isAuthenticated, controller.createPayment);

router.post('/accept-payment', isAuthenticated, controller.acceptPayment);

module.exports = router;