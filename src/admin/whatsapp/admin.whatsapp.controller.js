// src/admin/whatsapp/admin.whatsapp.controller.js
const asyncHandler = require('../../utils/asyncHandler');
const adminWhatsappService = require('../../services/adminWhatsappServiceClient'); // Importa o novo service

/**
 * @desc    Solicitar QR Code do WhatsApp Admin
 * @route   GET /api/admin/whatsapp/qrcode
 * @access  Private (Admin)
 */
exports.getAdminQRCode = asyncHandler(async (req, res) => {
  try {
    const { status, data } = await adminWhatsappService.getQRCode();
    res.status(status).json(data);
  } catch (error) {
    // O erro já vem tratado do handleRequest
    res.status(error.status || 500).json(error.data || { message: error.message });
  }
});

/**
 * @desc    Verificar status do WhatsApp Admin
 * @route   GET /api/admin/whatsapp/status
 * @access  Private (Admin)
 */
exports.getAdminStatus = asyncHandler(async (req, res) => {
  try {
    const { status, data } = await adminWhatsappService.getStatus();
    res.status(status).json(data);
  } catch (error) {
    res.status(error.status || 500).json(error.data || { message: error.message });
  }
});

/**
 * @desc    Desconectar o WhatsApp Admin
 * @route   POST /api/admin/whatsapp/logout
 * @access  Private (Admin)
 */
exports.logoutAdminClient = asyncHandler(async (req, res) => {
  try {
    const { status, data } = await adminWhatsappService.logout();
    res.status(status).json(data);
  } catch (error) {
    res.status(error.status || 500).json(error.data || { message: error.message });
  }
});

/**
 * @desc    Enviar mensagem transacional (Admin)
 * @route   POST /api/admin/whatsapp/send-message
 * @access  Private (Admin)
 */
exports.sendAdminMessage = asyncHandler(async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ message: '"to" (número) e "message" (mensagem) são obrigatórios.' });
  }

  try {
    const { status, data } = await adminWhatsappService.sendMessage(to, message);
    res.status(status).json(data);
  } catch (error) {
    res.status(error.status || 500).json(error.data || { message: error.message });
  }
});