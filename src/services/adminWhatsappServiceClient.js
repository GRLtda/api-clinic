// src/services/adminWhatsappServiceClient.js
const axios = require('axios');

// 1. Busque a URL e a Chave de API das variáveis de ambiente
//    (Você precisará adicionar estes valores ao seu arquivo .env)
const ADMIN_WHATSAPP_SERVICE_URL = process.env.ADMIN_WHATSAPP_SERVICE_URL;
const ADMIN_API_KEY = process.env.ADMIN_WHATSAPP_SERVICE_API_KEY;

if (!ADMIN_WHATSAPP_SERVICE_URL || !ADMIN_API_KEY) {
  console.warn('Variáveis de ambiente ADMIN_WHATSAPP_SERVICE_URL ou ADMIN_WHATSAPP_SERVICE_API_KEY não estão definidas. O serviço de WhatsApp Admin não funcionará.');
}

// 2. Cria uma instância do axios com os headers de autenticação estáticos
const adminWhatsappApi = axios.create({
  baseURL: ADMIN_WHATSAPP_SERVICE_URL,
  headers: {
    'x-admin-api-key': ADMIN_API_KEY, // Seta o header de autenticação estático
    'Content-Type': 'application/json'
  }
});

/**
 * Helper para padronizar o tratamento de requisições e erros
 * vindos do serviço de WhatsApp Admin.
 */
const handleRequest = async (requestPromise) => {
  try {
    const response = await requestPromise;
    // Retorna um objeto padronizado para o controller
    return { status: response.status, data: response.data };
  } catch (error) {
    // Log do erro
    console.error('Erro ao comunicar com o Serviço de WhatsApp Admin:', error.response?.data || error.message);
    
    // Repassa o status e a data do erro, se disponíveis
    const status = error.response?.status || 500;
    const data = error.response?.data || { message: 'Erro ao comunicar com o serviço WhatsApp Admin.' };
    
    // Re-joga um objeto de erro padronizado para o asyncHandler capturar
    const err = new Error(data.message);
    err.status = status;
    err.data = data;
    throw err;
  }
};

// --- Funções Exportadas ---

/** Solicita o QR Code (GET /admin/qrcode) */
exports.getQRCode = () => {
  return handleRequest(adminWhatsappApi.get('/admin/qrcode'));
};

/** Verifica o Status (GET /admin/status) */
exports.getStatus = () => {
  return handleRequest(adminWhatsappApi.get('/admin/status'));
};

/** Desconecta (POST /admin/logout) */
exports.logout = () => {
  return handleRequest(adminWhatsappApi.post('/admin/logout'));
};

/** Envia Mensagem (POST /admin/send-message) */
exports.sendMessage = (to, message) => {
  return handleRequest(adminWhatsappApi.post('/admin/send-message', { to, message }));
};