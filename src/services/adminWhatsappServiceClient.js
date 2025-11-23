// src/services/adminWhatsappServiceClient.js
const axios = require('axios');

// Configuração da API ZAP (Admin)
// Usa a URL de produção como fallback se a variável de ambiente não estiver definida
const ADMIN_API_URL = process.env.ADMIN_WHATSAPP_SERVICE_URL || process.env.WHATSAPP_SERVICE_URL || 'https://apizap.squareweb.app';
const ADMIN_API_KEY = process.env.ADMIN_WHATSAPP_SERVICE_API_KEY || process.env.WHATSAPP_SERVICE_API_KEY;

if (!process.env.ADMIN_WHATSAPP_SERVICE_URL && !process.env.WHATSAPP_SERVICE_URL) {
  console.warn(`[AdminWhatsAppService] URL não definida. Usando fallback: ${ADMIN_API_URL}`);
}

if (!ADMIN_API_KEY) {
  console.warn('[AdminWhatsAppService] API Key não definida. O envio de mensagens admin falhará.');
}

const adminZapApi = axios.create({
  baseURL: ADMIN_API_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ADMIN_API_KEY}`
  }
});

const ADMIN_SESSION_NAME = 'admin-system';

/**
 * Obtém o sessionId (e status) chamando o endpoint /connect.
 */
const getAdminSessionInfo = async () => {
  try {
    const response = await adminZapApi.post('/connect', {
      sessionName: ADMIN_SESSION_NAME
    });
    return response.data;
  } catch (error) {
    console.error('[AdminWhatsAppService] Erro ao obter sessão:', error.response?.data || error.message);
    throw error;
  }
};

exports.getQRCode = async () => {
  try {
    const sessionInfo = await getAdminSessionInfo();
    return {
      status: 200,
      data: sessionInfo.data
    };
  } catch (error) {
    return {
      status: error.response?.status || 500,
      data: error.response?.data || { message: 'Erro ao obter QR Code Admin.' }
    };
  }
};

exports.getStatus = async () => {
  try {
    const sessionInfo = await getAdminSessionInfo();
    return {
      status: 200,
      data: sessionInfo.data
    };
  } catch (error) {
    return {
      status: error.response?.status || 500,
      data: error.response?.data || { message: 'Erro ao obter status Admin.' }
    };
  }
};

exports.logout = async () => {
  try {
    const sessionInfo = await getAdminSessionInfo();
    const sessionId = sessionInfo?.data?.sessionId;

    if (!sessionId) {
      console.warn(`[AdminWhatsAppService] Logout: Nenhum sessionId ativo encontrado.`);
      return {
        status: 200,
        data: { message: 'Nenhuma sessão Admin ativa para desconectar.' }
      };
    }

    console.log(`[AdminWhatsAppService] Desconectando sessão ${sessionId}`);
    const response = await adminZapApi.post('/logout', {
      sessionId: sessionId
    });

    console.log(`[AdminWhatsAppService] Sessão ${sessionId} desconectada com sucesso.`);
    return {
      status: 200,
      data: response.data
    };
  } catch (error) {
    console.error(`[AdminWhatsAppService] Erro ao desconectar sessão Admin:`, error.response?.data || error.message);
    return {
      status: error.response?.status || 500,
      data: error.response?.data || { message: 'Erro interno ao desconectar a sessão Admin.' }
    };
  }
};

exports.sendMessage = async (to, message) => {
  try {
    const sessionInfo = await getAdminSessionInfo();
    const sessionId = sessionInfo?.data?.sessionId;

    if (!sessionId) {
      throw new Error('ID da sessão Admin não encontrado.');
    }

    const response = await adminZapApi.post('/send', {
      sessionId: sessionId,
      number: to,
      message: message
    });

    const zapData = response.data;

    const mappedData = {
      message: 'Mensagem enviada com sucesso.',
      result: {
        id: zapData.data?.id,
        status: zapData.data?.status || 'success'
      },
      originalResponse: zapData
    };

    return {
      status: 200,
      data: mappedData
    };

  } catch (error) {
    console.error('[AdminWhatsAppService] Erro ao enviar mensagem:', error.response?.data || error.message);
    return {
      status: error.response?.status || 500,
      data: error.response?.data || { message: 'Erro ao enviar mensagem Admin.' }
    };
  }
};