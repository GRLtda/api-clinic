// src/jobs/cron.service.js
// (Substitui o conteúdo anterior)

const cron = require("node-cron");
const { captureException } = require("../utils/sentry");
const { sendToDiscord } = require("../utils/discordLogger");

// Importa a função runTask do serviço de agendamento
const { runTask } = require("./scheduler.service");

/**
 * Lida com erros das tarefas agendadas para evitar que o processo principal quebre
 * @param {Error} error O erro capturado
 * @param {string} taskName O nome da tarefa que falhou
 */
const handleTaskError = (error, taskName) => {
  console.error(
    `[SCHEDULER] Erro não tratado na tarefa agendada ${taskName}:`,
    error
  );
  captureException(error, {
    tags: { severity: "cron_task_unhandled", task: taskName },
  });
  sendToDiscord(
    `Erro fatal (unhandled) na tarefa ${taskName}: \`\`\`${error.message}\`\`\``,
    "error",
    taskName
  );
};

// ===================================================================
// INICIALIZAÇÃO DO CRON (chama runTask diretamente, in-process)
// ===================================================================
exports.startAutoMessageScheduler = () => {
  console.log("--- Iniciando Agendador de Mensagens Automáticas (In-Process)... ---");

  /**
   * CRON MINUTÁRIO (robusto a downtime):
   * Executa as tarefas de lembrete baseadas em OFFSET:
   *  - APPOINTMENT_3_MINS_BEFORE   (3 minutos antes)
   *  - APPOINTMENT_2_HOURS_BEFORE  (2 horas antes)
   *  - APPOINTMENT_1_DAY_BEFORE    (1 dia antes)
   *
   * Observação: o cálculo de janela (±2min, configurável) é feito
   * dentro do scheduler.service. Rodando por minuto, garantimos
   * que nenhuma consulta dependa de um “disparo diário às 00:00”.
   */
  cron.schedule("* * * * *", async () => {
    const minuteTasks = [
      "APPOINTMENT_3_MINS_BEFORE",
      "APPOINTMENT_2_HOURS_BEFORE",
      "APPOINTMENT_1_DAY_BEFORE",
    ];

    console.log(
      `[SCHEDULER] Tick do minuto — executando tarefas: ${minuteTasks.join(", ")}`
    );

    // Dispara todas em paralelo, cada uma com seu próprio tratamento de erro
    const runs = minuteTasks.map(async (taskName) => {
      try {
        console.log(`[SCHEDULER] Executando tarefa: ${taskName}`);
        sendToDiscord(`Iniciando tarefa: **${taskName}**`, "info", taskName);
        await runTask(taskName);
      } catch (err) {
        handleTaskError(err, taskName);
      }
    });

    await Promise.allSettled(runs);
  });

  /**
   * CRON DIÁRIO: apenas ANIVERSÁRIOS
   * "0 1 * * *" = 1:00 AM UTC
   * Mantemos aniversário diário porque a regra é por DIA (BR),
   * enquanto lembretes de consulta agora são por OFFSET.
   */
  cron.schedule(
    "0 1 * * *",
    async () => {
      const taskName = "PATIENT_BIRTHDAY";
      try {
        console.log("[CRON Diário] Iniciando tarefa diária de aniversários...");
        console.log(`[SCHEDULER] Executando tarefa: ${taskName}`);
        sendToDiscord(`Iniciando tarefa: **${taskName}**`, "info", taskName);
        await runTask(taskName);
      } catch (err) {
        handleTaskError(err, taskName);
      }
    },
    { timezone: "UTC" }
  );

  console.log("--- Agendador de Mensagens Automáticas Iniciado e Tarefas Agendadas. ---");
};
