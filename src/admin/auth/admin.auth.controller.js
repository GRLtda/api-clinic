// src/admin/auth/admin.auth.controller.js
const generateAdminToken = require('../utils/generateAdminToken');
const asyncHandler = require('../utils/asyncHandler');

// --- Credenciais Fixas ---
const ADMIN_USER = 'GSkzin';
const ADMIN_PASS = '2025@GSkz!n@81';
// -------------------------

/**
 * @desc    Autentica o admin e retorna um token
 * @route   POST /api/admin/login
 * @access  Public
 */
exports.loginAdmin = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Usuário e senha são obrigatórios.' });
  }

  // Compara com as credenciais fixas
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    // Dados do "usuário" admin para o token
    const adminUser = {
      id: 'admin_GSkzin', // ID estático para o admin
      role: 'admin',
    };

    return res.json({
      _id: adminUser.id,
      name: 'Admin GSkzin',
      role: adminUser.role,
      token: generateAdminToken(adminUser.id, adminUser.role),
    });
  }

  return res.status(401).json({ message: 'Usuário ou senha inválidos.' });
});