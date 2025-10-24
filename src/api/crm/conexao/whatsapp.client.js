// src/api/crm/conexao/whatsapp.client.js

// Importações do whatsapp-web.js
const { Client } = require("whatsapp-web.js");
const { MongoStore } = require("wwebjs-mongo");
const { RemoteAuth } = require("whatsapp-web.js");

// Importações de infra
const qrcode = require("qrcode");
const mongoose = require("mongoose");
const path = require("path");

// ===================================================================
// ARMAZENAMENTO E CONFIGURAÇÃO GLOBAL
// ===================================================================

const clients = new Map();
const qrCodes = new Map();
const creatingQr = new Map();
let mongoStore;

// ===================================================================
// DETECÇÃO DE AMBIENTE
// ===================================================================
// Checa se estamos rodando em um ambiente serverless conhecido (como Vercel)
// Você pode adicionar outros, como process.env.LAMBDA_TASK_ROOT
const IS_SERVERLESS = process.env.VERCEL === "1";

let chromium;
if (IS_SERVERLESS) {
  try {
    // Tenta carregar o pacote serverless APENAS se estivermos no serverless
    chromium = require("@sparticuz/chrome-aws-lambda");
  } catch (e) {
    console.error("Falha ao carregar @sparticuz/chrome-aws-lambda", e);
  }
}

// (initializeMongoStore permanece o mesmo)
const initializeMongoStore = () => {
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

// (getClientStatus permanece o mesmo)
const getClientStatus = (clinicId) => {
  const id = clinicId.toString();
  const client = clients.get(id);

  if (!client) return "disconnected";
  if (client.info && client.info.wid) return "connected";
  if (qrCodes.has(id)) return "qrcode_pending";
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

// (logoutAndRemoveClient permanece o mesmo)
const logoutAndRemoveClient = async (clinicId) => {
  const id = clinicId.toString();
  if (clients.has(id)) {
    const client = clients.get(id);
    try {
      if (client.info) await client.logout();
    } catch (error) {
      console.warn(
        `[LOGOUT] Cliente ${id}: Erro seguro ao tentar logout. ${error.message}`
      );
    }
    try {
      if (client.pupBrowser) await client.destroy();
      else
        console.warn(
          `[DESTROY] Cliente ${id}: Browser (pupBrowser) não encontrado, pulando destroy.`
        );
    } catch (error) {
      console.warn(
        `[DESTROY] Cliente ${id}: Erro seguro ao tentar destruir. ${error.message}`
      );
    }
    clients.delete(id);
  }
  qrCodes.delete(id);
  creatingQr.delete(id);
  console.log(`[CLIENT] Cliente ${id} removido e limpo da memória.`);
};

// ===================================================================
// FUNÇÕES DE GERENCIAMENTO DE CLIENTE
// ===================================================================

const initializeClient = async (clinicId) => {
  const id = clinicId.toString();

  if (clients.has(id)) {
    const client = clients.get(id);
    if (client.info || client.state === "INITIALIZING") {
      return client;
    }
  }

  if (!mongoStore) {
    throw new Error(
      "MongoStore não inicializado. Chame initializeMongoStore() no server.js primeiro."
    );
  }

  await logoutAndRemoveClient(id);
  creatingQr.set(id, true);
  console.log(`[CLIENT] Marcando criação de QR code para ${id}`);

  // ===================================================================
  // CONFIGURAÇÃO CONDICIONAL (Local vs Serverless)
  // ===================================================================

  // Define o caminho de cache.
  // path.join garante que vai usar /tmp (Linux) ou \AppData\Local\Temp (Windows)
  const dataPath = path.join(
    require("os").tmpdir(), // <-- Pega o diretório temporário CORRETO
    ".wwebjs_auth",
    `session-${id}`
  );

  console.log(`[CLIENT] Usando dataPath: ${dataPath}`);

  const authStrategy = new RemoteAuth({
    store: mongoStore,
    clientId: id,
    backupSyncIntervalMs: 300000,
    dataPath: dataPath,
  });

  // Configurações do Puppeteer
  let puppeteerConfig = {
    headless: true, // Sempre headless
    dataPath: dataPath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process", // <- Pode ajudar em ambientes com poucos recursos
      "--disable-gpu",
    ],
  };

  if (IS_SERVERLESS) {
    // Configuração SERVERLESS (usando @sparticuz/chrome-aws-lambda)
    console.log("[CLIENT] Detectado ambiente Serverless. Usando Chromium AWS.");
    if (!chromium || !chromium.executablePath) {
      throw new Error(
        "Ambiente serverless detectado, mas @sparticuz/chrome-aws-lambda falhou ao carregar."
      );
    }
    puppeteerConfig.executablePath = await chromium.executablePath();
    puppeteerConfig.args = [
      ...chromium.args,
      ...puppeteerConfig.args, // Adiciona nossos args extras
    ];
    puppeteerConfig.defaultViewport = chromium.defaultViewport;
    puppeteerConfig.headless = chromium.headless;
  } else {
    // Configuração LOCAL (Windows/Mac/Linux com Chrome instalado)
    console.log(
      "[CLIENT] Detectado ambiente Local. Usando puppeteer/chrome local."
    );
    // Para rodar localmente, você pode precisar do 'puppeteer'
    // Se o 'whatsapp-web.js' não o baixou, rode: npm install puppeteer
    // Se você tem o Google Chrome instalado, pode tentar adicionar:
    // puppeteerConfig.executablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }

  const client = new Client({
    authStrategy: authStrategy,
    puppeteer: puppeteerConfig,
    webVersionCache: {
      type: "remote",
      remotePath:
        "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
    },
  });

  // ===================================================================

  // (Listeners permanecem os mesmos)
  client.on("qr", async (qr) => {
    console.log(`[QR_CODE] recebido para ${id}`);
    const qrDataUrl = await qrcode.toDataURL(qr);
    qrCodes.set(id, qrDataUrl);
    creatingQr.delete(id);
    console.log(
      `[CLIENT] QR code gerado para ${id}, removendo flag de criação`
    );
  });

  client.on("ready", () => {
    console.log(`[CLIENT] Cliente ${id} está PRONTO!`);
    qrCodes.delete(id);
    creatingQr.delete(id);
  });

  client.on("authenticated", () => {
    console.log(`[AUTH] Sessão ${id} restaurada do MongoDB.`);
    creatingQr.delete(id);
  });

  client.on("auth_failure", (msg) => {
    console.error(`[AUTH_FAILURE] Cliente ${id}:`, msg);
    creatingQr.delete(id);
  });

  client.on("disconnected", (reason) => {
    console.log(`[DISCONNECTED] Cliente ${id}:`, reason);
    qrCodes.delete(id);
    creatingQr.delete(id);
  });

  // (Inicialização permanece a mesma)
  client.initialize().catch((err) => {
    console.error(`[ERROR] ERRO ao inicializar o cliente ${id}:`, err);
    creatingQr.delete(id);
    logoutAndRemoveClient(clinicId);
  });

  clients.set(id, client);
  return client;
};

// ===================================================================
// FUNÇÃO DE ENVIO DE MENSAGEM
// ===================================================================
// (sendMessage permanece o mesmo)
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