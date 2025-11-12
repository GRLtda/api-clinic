// src/server.js
require("dotenv").config({ quiet: true });
const app = require("./app");
const connectDB = require("./config/database");
const { Sentry } = require("./utils/sentry");
const { startAutoMessageScheduler } = require("./jobs/cron.service");

// --- Constantes e Variáveis de Ambiente ---
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || "development";

/**
 * Função principal para inicializar e iniciar o servidor.
 */
async function startServer() {
  try {
    await connectDB();
    console.log("[DB] ✅ Conexão com o MongoDB estabelecida com sucesso.");

    if (NODE_ENV !== "dev" && NODE_ENV !== "development") {
      startAutoMessageScheduler();
      console.log("[CRON] ⏰ Agendador de mensagens automáticas iniciado.");
    } else {
      console.log(
        "[CRON] ⚠️ Agendador de mensagens automáticas não iniciado em ambiente de desenvolvimento."
      );
    }

    app.listen(PORT, () => {
      console.log(
        `[SERVER] 🚀 Servidor rodando em http://localhost:${PORT} (Ambiente: ${NODE_ENV})`
      );
    });
  } catch (error) {
    console.error("[FATAL] ❌ Falha ao iniciar o servidor:", error);
    Sentry.captureException(error);
    process.exit(1);
  }
}

startServer();
