// api/auth/auth.routes.js
const express = require('express');
const router = express.Router();
const { 
    registerUser, 
    loginUser, 
    getMe, 
    forgotPassword, 
    resetPassword 
  } = require('./auth.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/me', isAuthenticated, requireClinic, getMe);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);  

module.exports = router;
