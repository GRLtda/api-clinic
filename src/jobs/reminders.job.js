// jobs/reminders.job.js
// -----------------------------------------------------------------------------
// ADAPTADOR/SHIM DE COMPATIBILIDADE
//
// Este arquivo existia com uma lógica própria de varredura (1 dia e 2 horas).
// Após a refatoração, TODA a regra de janelas/offsets vive em src/jobs/scheduler.service,
// que é chamada a cada minuto via cron (3min, 1d, 2d) com tolerância.
// Para evitar duplicidade e disparos em dobro, este módulo passa a delegar
// para as tasks oficiais via runTask(taskName), preservando a API pública
// (export { runRemindersSweep }) caso exista algum chamador legado.
//
// Se você REALMENTE precisar reativar a antiga varredura de "2 horas", crie
// uma task oficial APPOINTMENT_2_HOURS_BEFORE no scheduler.service e mapeie
// o offset lá. Enquanto isso, mantemos apenas 1d e 2d aqui.
// -----------------------------------------------------------------------------

const { runTask } = require("../src/jobs/scheduler.service");
const { sendToDiscord } = require("../src/utils/discordLogger");

/**
 * Executa as tarefas oficiais de lembrete através do scheduler.service,
 * mantendo compatibilidade com chamadores antigos deste módulo.
 *
 * Obs.: deliberadamente NÃO envia "2 horas" para evitar duplicidade,
 * pois essa janela não existe como task oficial no scheduler atual.
 * Caso precise, padronize criando APPOINTMENT_2_HOURS_BEFORE no scheduler
 * e acrescente abaixo.
 */
async function runRemindersSweep() {
  const shimTaskGroup = "REMINDERS_SWEEP_SHIM";
  const tasks = [
    "APPOINTMENT_1_DAY_BEFORE",
    "APPOINTMENT_2_DAYS_BEFORE",
    // Se no futuro criar APPOINTMENT_2_HOURS_BEFORE no scheduler, adicione aqui.
    // "APPOINTMENT_2_HOURS_BEFORE",
  ];

  try {
    sendToDiscord(
      `Iniciando runRemindersSweep (shim) → ${tasks.join(", ")}`,
      "info",
      shimTaskGroup
    );

    await Promise.all(
      tasks.map((taskName) =>
        runTask(taskName).catch((err) => {
          sendToDiscord(
            `Erro executando ${taskName}: \`${(err && err.message) || "erro desconhecido"}\``,
            "error",
            taskName
          );
        })
      )
    );

    sendToDiscord(
      `runRemindersSweep (shim) concluído: ${tasks.join(", ")}`,
      "success",
      shimTaskGroup
    );
  } catch (err) {
    sendToDiscord(
      `Falha inesperada em runRemindersSweep (shim): \`${(err && err.message) || "erro desconhecido"}\``,
      "error",
      shimTaskGroup
    );
    // Não propaga, para não quebrar chamadores legados que não fazem try/catch
  }
}

module.exports = { runRemindersSweep };