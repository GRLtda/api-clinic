// src/api/crm/crm.controller.js
const expressAsyncHandler = require("express-async-handler");
const {
  initializeClient,
  getClientStatus,
  destroyClient,
  sendMessage,
} = require("./whatsapp.client.js");
const { formatPhoneNumber } = require("../utils/phone-formatter");

/**
 * @desc    Solicita o QR code para iniciar/tentar restaurar a conexão WhatsApp
 * @route   GET /api/crm/qrcode
 * @access  Private (Requer clínica)
 */
exports.getQrCode = expressAsyncHandler(async (req, res) => {
  const clinicId = req.clinicId.toString();

  // 1. Inicializa (ou obtém) o cliente.
  let client = await initializeClient(clinicId);
  let status = getClientStatus(clinicId);

  // 2. Verifica e retorna o status
  if (status === "connected") {
    return res
      .status(200)
      .json({ status: "connected", message: "Cliente já conectado." });
  }

  if (status === "qr_ready" && client.qrCode) {
    // Retorna o QR code em formato Data URL
    return res.status(200).json({
      status: "qr_ready",
      qrCode: client.qrCode, // O QR Code como Data URL
      message: "Escaneie o QR code para conectar.",
    });
  }

  // Para 'initializing' ou 'disconnected' após a tentativa de init
  if (status === "initializing") {
    // Retorna 202 (Accepted) para indicar que a requisição foi aceita
    // mas o processamento (geração do QR) ainda está em curso.
    return res.status(202).json({
      status: "initializing",
      message: "Conexão em progresso, tente novamente em alguns segundos.",
    });
  }

  // Caso genérico de erro
  res.status(500).json({
    status: "error",
    message: "Falha ao obter QR code ou inicializar cliente.",
  });
});

/**
 * @desc    Verifica o status da conexão WhatsApp
 * @route   GET /api/crm/status
 * @access  Private (Requer clínica)
 */
exports.getConnectionStatus = expressAsyncHandler(async (req, res) => {
  const clinicId = req.clinicId.toString();
  const status = getClientStatus(clinicId);

  // Mensagens amigáveis para o front-end
  let message;
  switch (status) {
    case "connected":
      message = "WhatsApp conectado com sucesso.";
      break;
    case "qr_ready":
      message = "Aguardando escaneamento do QR Code.";
      break;
    case "disconnected":
      message = "WhatsApp desconectado. Gere um novo QR code para conectar.";
      break;
    case "initializing":
    default:
      message = "Conexão em inicialização.";
      break;
  }

  res.status(200).json({ status, message });
});

/**
 * @desc    Desloga e destroi a sessão do WhatsApp (excluir os cookies da db e etc.)
 * @route   POST /api/crm/logout
 * @access  Private (Requer clínica)
 */
exports.logoutClient = expressAsyncHandler(async (req, res) => {
  const clinicId = req.clinicId.toString();
  await destroyClient(clinicId);
  res.status(200).json({
    status: "disconnected",
    message: "Sessão WhatsApp encerrada com sucesso.",
  });
});

/**
 * @desc    Envia uma mensagem de texto (funcionalidade CRM)
 * @route   POST /api/crm/send-message
 * @access  Private (Requer clínica)
 */
exports.sendMessageToPatient = expressAsyncHandler(async (req, res) => {
  const { number, message } = req.body;
  const clinicId = req.clinicId.toString();

  if (!number || !message) {
    return res
      .status(400)
      .json({ message: "Número e mensagem são obrigatórios." });
  }

  try {
    // Formata o número de telefone com prefixo 55 do Brasil
    const formattedPhone = formatPhoneNumber(number);
    const result = await sendMessage(clinicId, formattedPhone, message);
    res.status(200).json({ message: "Mensagem enviada com sucesso.", result });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});
