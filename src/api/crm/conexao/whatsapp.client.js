// src/api/crm/conexao/whatsapp.client.js

// Importações do whatsapp-web.js
const { Client } = require('whatsapp-web.js');
// Importações para Persistência de Sessão em Serverless/MongoDB
const { MongoStore } = require('wwebjs-mongo');
const { RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const mongoose = require('mongoose'); // Importar Mongoose para usar a conexão DB

// Objeto para gerenciar as instâncias do Client (uma por clínica)
const clients = new Map();
// Mapeamento de status: initializing, qr_ready, connected, disconnected
const clientStatus = new Map(); 
let mongoStore;

// ===================================================================
// UTILS DE CONEXÃO
// ===================================================================

/**
 * Inicializa o MongoStore. DEVE ser chamado no server.js após conectar o DB.
 */
const initializeMongoStore = () => {
  if (!mongoStore) {
    // Usa a conexão Mongoose global
    mongoStore = new MongoStore({
      mongoose: mongoose, 
      collectionName: 'whatsappSessions' // Coleção onde os dados da sessão serão salvos
    });
    console.log('MongoStore para sessões WhatsApp inicializado.');
  }
};


/**
 * Retorna o status atual da conexão de uma clínica.
 * @param {string} clinicId
 * @returns {string}
 */
const getClientStatus = (clinicId) => {
  return clientStatus.get(clinicId.toString()) || 'disconnected';
};


/**
 * Inicializa ou retorna o cliente WhatsApp para uma clínica, usando RemoteAuth.
 * @param {string} clinicId
 * @returns {Promise<Client>}
 */
const initializeClient = async (clinicId) => {
  const id = clinicId.toString();

  // 1. Retorna a instância se já estiver inicializada e conectada/tentando
  if (clients.has(id) && getClientStatus(id) !== 'disconnected') {
    return clients.get(id);
  }
  
  // 2. Validação crítica
  if (!mongoStore) {
      throw new Error('MongoStore não inicializado. Chame initializeMongoStore() no server.js primeiro.');
  }
  
  // --- Estratégia de Autenticação (RemoteAuth com MongoStore) ---
  const authStrategy = new RemoteAuth({ 
    store: mongoStore, 
    clientId: id,
    backupSyncIntervalMs: 300000, // 5 minutos = 300.000ms. Mínimo é 60000ms.
});

  // 3. Cria um novo cliente
  const client = new Client({
    authStrategy: authStrategy, // Uso do RemoteAuth
    // Adiciona o puppeteer args para compatibilidade com ambientes serverless/sandboxed (Vercel)
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
    // Cache de versão (Recomendado para evitar bloqueio)
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html', 
    },
  });

  // 4. Configura Listeners de Eventos
  clients.set(id, client);
  clientStatus.set(id, 'initializing');
  client.qrCode = null; // Garante que o QR code está limpo inicialmente
  
  client.on('qr', async (qr) => {
    clientStatus.set(id, 'qr_ready');
    // Converte o QR code para Data URL para ser lido pelo controller da API
    client.qrCode = await qrcode.toDataURL(qr);
    console.log(`[${id}] QR_RECEIVED. Status: ${getClientStatus(id)}`);
  });

  client.on('ready', () => {
    clientStatus.set(id, 'connected');
    client.qrCode = null; 
    console.log(`[${id}] Client is ready! Status: ${getClientStatus(id)}`);
  });
  
  client.on('authenticated', () => {
    clientStatus.set(id, 'authenticated');
    console.log(`[${id}] AUTHENTICATED/REMOTELY RESTORED.`);
  });

  client.on('auth_failure', (msg) => {
    console.error(`[${id}] AUTHENTICATION FAILURE`, msg);
    clientStatus.set(id, 'disconnected');
    client.qrCode = null;
  });

  client.on('disconnected', (reason) => {
    clientStatus.set(id, 'disconnected');
    client.qrCode = null;
    console.log(`[${id}] Client was disconnected! Reason: ${reason}. Status: ${getClientStatus(id)}`);
    // O RemoteAuth tentará reconectar automaticamente se a sessão estiver no DB
  });

  // 5. Tenta inicializar o cliente.
  client.initialize().catch(err => {
    console.error(`[${id}] Erro ao inicializar o cliente:`, err.message);
    clientStatus.set(id, 'disconnected');
  });

  return client;
};

/**
 * Deleta a sessão salva no DB e destrói a instância do cliente.
 * @param {string} clinicId
 */
const destroyClient = async (clinicId) => {
  const id = clinicId.toString();
  const client = clients.get(id);
  
  if (client) {
    try {
      // client.destroy() com RemoteAuth limpa a sessão no MongoStore
      await client.destroy(); 
      console.log(`[${id}] Client destroyed and session deleted.`);
    } catch (error) {
      console.error(`[${id}] Erro ao destruir/deslogar cliente:`, error.message);
    }
    clients.delete(id);
    clientStatus.delete(id);
  }
};


// ===================================================================
// FUNÇÃO DE ENVIO DE MENSAGEM
// ===================================================================

/**
 * Envia uma mensagem de texto para um número.
 * @param {string} clinicId - ID da clínica
 * @param {string} number - Número de telefone (ex: 5515991234567)
 * @param {string} message - Conteúdo da mensagem
 * @returns {Promise<any>}
 */
const sendMessage = async (clinicId, number, message) => {
    const id = clinicId.toString();
    const client = clients.get(id);
    
    // 1. Checa se o cliente existe e está conectado
    if (!client || getClientStatus(id) !== 'connected') {
        throw new Error('Cliente WhatsApp não conectado. Por favor, conecte a clínica primeiro.');
    }

    // 2. Formata o número (adiciona @c.us se necessário)
    // O whatsapp-web.js é inteligente, mas o formato correto é essencial.
    const chatId = number.endsWith('@c.us') ? number : `${number}@c.us`;

    // 3. Envia a mensagem
    try {
        const result = await client.sendMessage(chatId, message);
        return result;
    } catch (error) {
        console.error(`[${id}] Falha ao enviar mensagem para ${number}:`, error.message);
        throw new Error(`Falha ao enviar mensagem: ${error.message}`);
    }
};


module.exports = {
  initializeMongoStore,
  initializeClient,
  getClientStatus,
  destroyClient,
  sendMessage,
};