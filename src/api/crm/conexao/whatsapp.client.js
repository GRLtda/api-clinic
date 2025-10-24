// src/api/crm/conexao/whatsapp.client.js

// Importações do whatsapp-web.js
const { Client } = require("whatsapp-web.js");
// Importações para Persistência de Sessão em Serverless/MongoDB
const { MongoStore } = require("wwebjs-mongo");
const { RemoteAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const mongoose = require("mongoose"); // Importar Mongoose para usar a conexão DB

// ===================================================================
// ARMAZENAMENTO E CONFIGURAÇÃO GLOBAL
// ===================================================================

// Mapa para armazenar instâncias ativas dos clientes (por clinicId)
const clients = new Map();
// Mapa para armazenar o QR code mais recente (por clinicId)
const qrCodes = new Map();
// Mapa para rastrear quando um QR code está sendo criado (por clinicId)
const creatingQr = new Map();

// Variável para armazenar a instância do MongoStore
let mongoStore;

/**
 * Inicializa o MongoStore. DEVE ser chamado no server.js após conectar o DB.
 */
const initializeMongoStore = () => {
  // A checagem de readyState é uma boa prática
  if (!mongoose.connection.readyState) {
    console.error(
      "Mongoose não está conectado. Não foi possível inicializar o MongoStore."
    );
    return;
  }
  if (!mongoStore) {
    mongoStore = new MongoStore({ mongoose: mongoose });
    console.log("MongoStore para sessões WhatsApp inicializado.");
  }
};

/**
 * Retorna o status atual da conexão de uma clínica.
 * @param {string} clinicId
 * @returns {string}
 */
const getClientStatus = (clinicId) => {
  const id = clinicId.toString();
  const client = clients.get(id);

  if (!client) return "disconnected";
  if (client.info && client.info.wid) return "connected";
  if (qrCodes.has(id)) return "qrcode_pending";

  // Verifica se está criando QR code (flag específica ou estados de inicialização)
  if (
    creatingQr.has(id) ||
    client.state === "INITIALIZING" ||
    client.state === "CONFLICT" ||
    client.state === "UNPAIRED" ||
    (client.state === "UNPAIRED_IDLE" && !qrCodes.has(id))
  ) {
    return "creating_qr";
  }

  return "disconnected";
};

/**
 * Remove o cliente da memória, força o logout e destrói a instância.
 * @param {string} clinicId
 */
const logoutAndRemoveClient = async (clinicId) => {
  const id = clinicId.toString();
  if (clients.has(id)) {
    const client = clients.get(id);

    try {
      // Tenta forçar o logout
      await client.logout();
    } catch (error) {
      // Ignora erros de logout em sessões já corrompidas
      console.warn(
        `[LOGOUT] Cliente ${id}: Erro seguro ao tentar logout. ${error.message}`
      );
    }

    // Destrói o cliente para liberar recursos do Puppeteer/Chromium
    await client.destroy();

    clients.delete(id);
  }
  qrCodes.delete(id); // Limpa qualquer QR code pendente
  creatingQr.delete(id); // Limpa a flag de criação
  console.log(`[CLIENT] Cliente ${id} removido e destruído.`);
};

// ===================================================================
// FUNÇÕES DE GERENCIAMENTO DE CLIENTE
// ===================================================================

/**
 * Inicializa ou retorna o cliente WhatsApp para uma clínica, usando RemoteAuth.
 * @param {string} clinicId
 * @returns {Promise<Client>}
 */
const initializeClient = async (clinicId) => {
  const id = clinicId.toString();

  // 1. Retorna a instância se já estiver pronto ou em processo
  if (clients.has(id)) {
    const client = clients.get(id);
    if (client.info || client.state === "INITIALIZING") {
      return client;
    }
  }

  // 2. Validação crítica
  if (!mongoStore) {
    throw new Error(
      "MongoStore não inicializado. Chame initializeMongoStore() no server.js primeiro."
    );
  }

  // 3. Garante que o antigo foi destruído antes de começar um novo
  await logoutAndRemoveClient(id);

  // 4. Marca que está criando QR code
  creatingQr.set(id, true);
  console.log(`[CLIENT] Marcando criação de QR code para ${id}`);

  // --- Estratégia de Autenticação (RemoteAuth com MongoStore) ---
  const authStrategy = new RemoteAuth({
    store: mongoStore,
    clientId: id,
    backupSyncIntervalMs: 300000,
  });

  // 4. Cria o novo cliente
  const client = new Client({
    authStrategy: authStrategy,
    puppeteer: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
    webVersionCache: {
      type: "remote",
      remotePath:
        "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
    },
  });

  // 5. Adiciona Listeners
  client.on("qr", async (qr) => {
    console.log(`[QR_CODE] recebido para ${id}`);
    const qrDataUrl = await qrcode.toDataURL(qr);
    qrCodes.set(id, qrDataUrl);
    creatingQr.delete(id); // Remove a flag de criação quando QR é gerado
    console.log(
      `[CLIENT] QR code gerado para ${id}, removendo flag de criação`
    );
  });

  client.on("ready", () => {
    console.log(`[CLIENT] Cliente ${id} está PRONTO!`);
    qrCodes.delete(id);
    creatingQr.delete(id); // Remove flag de criação quando conectado
  });

  client.on("authenticated", () => {
    console.log(`[AUTH] Sessão ${id} restaurada do MongoDB.`);
    creatingQr.delete(id); // Remove flag de criação quando autenticado
  });

  client.on("auth_failure", (msg) => {
    console.error(`[AUTH_FAILURE] Cliente ${id}:`, msg);
    creatingQr.delete(id); // Remove flag de criação em caso de falha
    // MUDANÇA CRÍTICA: REMOVIDA CHAMADA PARA logoutAndRemoveClient. O CONTROLLER DECIDE.
  });

  client.on("disconnected", (reason) => {
    console.log(`[DISCONNECTED] Cliente ${id}:`, reason);
    qrCodes.delete(id);
    creatingQr.delete(id); // Remove flag de criação quando desconectado
  });

  // 6. Inicia o cliente
  client.initialize().catch((err) => {
    console.error(`[ERROR] ERRO ao inicializar o cliente ${id}:`, err);
    creatingQr.delete(id); // Remove flag de criação em caso de erro
    logoutAndRemoveClient(clinicId);
  });

  // 7. Armazena e retorna
  clients.set(id, client);
  return client;
};

// ===================================================================
// FUNÇÃO DE ENVIO DE MENSAGEM
// ===================================================================

/**
 * Envia uma mensagem de texto para um número.
 */
const sendMessage = async (clinicId, number, message) => {
  const id = clinicId.toString();
  const client = clients.get(id);

  if (!client || getClientStatus(id) !== "connected") {
    throw new Error(
      "Cliente WhatsApp não conectado. Por favor, conecte a clínica primeiro."
    );
  }

  const chatId = number.endsWith("@c.us") ? number : `${number}@c.us`;

  try {
    const result = await client.sendMessage(chatId, message);
    return result;
  } catch (error) {
    console.error(
      `[${id}] Falha ao enviar mensagem para ${number}:`,
      error.message
    );
    throw new Error(`Falha ao enviar mensagem: ${error.message}`);
  }
};

// ===================================================================
// EXPORTS
// ===================================================================

module.exports = {
  initializeMongoStore,
  initializeClient,
  getClientStatus,
  logoutAndRemoveClient,
  sendMessage,
  clients,
  qrCodes,
};
