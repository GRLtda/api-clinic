const express = require('express');
const router = express.Router();
const { registerUser, loginUser, getMe } = require('./auth.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

router.post('/register', registerUser);
router.post('/login', loginUser);

router.get('/me', isAuthenticated, requireClinic, getMe);

module.exports = router;