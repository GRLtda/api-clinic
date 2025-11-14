// api/auth/auth.routes.js
const express = require('express');
const router = express.Router();
const { 
    registerUser, 
    loginUser, 
    getMe, 
    forgotPassword, 
    resetPassword,
    getInvitationDetails
  } = require('./auth.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

router.get('/verify-invitation/:token', getInvitationDetails);
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);  

router.get('/me', isAuthenticated, requireClinic, getMe);

module.exports = router;
