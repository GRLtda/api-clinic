// src/api/crm/scheduler/auto-message.service.js
const cron = require("node-cron");
const MessageSetting = require("../message-settings.model");
const MessageTemplate = require("../modelos/message-template.model");
const Appointment = require("../../appointments/appointments.model");
const Patient = require("../../patients/patients.model");
const whatsappServiceClient = require('../../../services/whatsappServiceClient');
const { createLogEntry } = require("../logs/message-log.controller");
const { MessageLog, LOG_STATUS, ACTION_TYPES } = require("../logs/message-log.model");
const { captureException } = require('../../../utils/sentry');

// Carrega p-limit dinamicamente porque ele é um ES Module
let pLimit;
import('p-limit').then((module) => {
    pLimit = module.default; // Acessa a função exportada como padrão
    console.log("[SCHEDULER] p-limit carregado com sucesso usando import() dinâmico.");
}).catch(err => {
    console.error("[SCHEDULER] FALHA CRÍTICA AO CARREGAR p-limit:", err);
    captureException(err, { tags: { severity: 'critical', context: 'p-limit-load' } });
    // Considerar encerrar o processo se p-limit for essencial para a operação
    process.exit(1); // Ou defina pLimit como uma função vazia para evitar crash, mas perder a funcionalidade
});

// ===================================================================
// UTILS DE FORMATAÇÃO E PREENCHIMENTO
// ===================================================================

const fillTemplate = (templateContent, data) => {
    let content = templateContent || ''; // Garante que content seja uma string
    // Usa regex global (g) para substituir todas as ocorrências
    content = content.replace(/{ ?paciente ?}/g, data.patientName || "Paciente");
    content = content.replace(/{ ?clinica ?}/g, data.clinicName || "Clínica");
    content = content.replace(/{ ?nome_medico ?}/g, data.doctorName || "Dr(a).");
    content = content.replace(/{ ?data_consulta ?}/g, data.appointmentDate || "");
    content = content.replace(/{ ?hora_consulta ?}/g, data.appointmentTime || "");
    content = content.replace(/{ ?link_anamnese ?}/g, data.anamnesisLink || "");
    return content.trim();
};

const formatDate = (date) => {
  if (!date) return "";
  // Garante que é um objeto Date antes de formatar
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return ""; // Retorna vazio se a data for inválida
  return dateObj.toLocaleDateString("pt-BR", { timeZone: 'America/Sao_Paulo' }); // Considera fuso horário
};

const formatTime = (date) => {
  if (!date) return "";
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return "";
  return dateObj.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: 'America/Sao_Paulo' // Considera fuso horário
  });
};

// ===================================================================
// FUNÇÃO CENTRAL DE ENVIO (COM LOG LOCAL E CHAMADA AO SERVIÇO)
// ===================================================================

const trySendMessageAndLog = async ({
  clinicId,
  patientId,
  recipientPhone,
  finalMessage,
  settingType,
  templateId,
}) => {
  // Validação básica de entrada
  if (!clinicId || !patientId || !recipientPhone || !finalMessage || !settingType) {
      console.error(`[SCHEDULER ${settingType}] Dados insuficientes para enviar mensagem.`, { clinicId, patientId, recipientPhone: !!recipientPhone, finalMessage: !!finalMessage, settingType });
      return;
  }

  const formattedPhone = recipientPhone.replace(/\D/g, ''); // Garante que só tenha dígitos

  let logEntry;
  try {
    // 1. Cria o log local com status SENT_ATTEMPT
    logEntry = await createLogEntry({
      clinic: clinicId,
      patient: patientId,
      template: templateId, // Pode ser null se não for baseado em template
      settingType: settingType,
      messageContent: finalMessage,
      recipientPhone: formattedPhone, // Salva o número formatado
      status: LOG_STATUS.SENT_ATTEMPT,
      actionType:
        settingType === "PATIENT_BIRTHDAY"
          ? ACTION_TYPES.AUTOMATIC_BIRTHDAY
          : ACTION_TYPES.AUTOMATIC_REMINDER, // Assume lembrete para outros tipos
    });

    if (!logEntry) {
        throw new Error("Falha ao criar entrada de log inicial."); // Joga erro para o catch
    }

    // 2. Chama o serviço WhatsApp dedicado para realizar o envio
    // console.log(`[SCHEDULER ${clinicId}] Solicitando envio (Log ID: ${logEntry._id}) para ${formattedPhone} via serviço...`);
    const response = await whatsappServiceClient.sendMessage(clinicId, formattedPhone, finalMessage);
    // console.log(`[SCHEDULER ${clinicId}] Resposta do serviço para ${formattedPhone} (Log ID: ${logEntry._id}): Status ${response.status}`);

    // 3. Atualiza o log local para DELIVERED
    await MessageLog.findByIdAndUpdate(logEntry._id, {
      status: LOG_STATUS.DELIVERED,
      wwebjsMessageId: response.data?.result?.id?.id || null, // Captura ID se disponível
    });

    // console.log(`[SCHEDULER ${settingType}] Mensagem enviada para ${formattedPhone} via serviço. Log ID: ${logEntry._id}`);

  } catch (error) {
    // 4. Em caso de erro na comunicação ou erro retornado pelo serviço
    const errorMessage = error.response?.data?.message || error.message || 'Erro desconhecido ao contatar serviço WhatsApp.';
    captureException(error, {
        tags: { severity: 'whatsapp_automatic_failure', clinic_id: clinicId.toString(), setting_type: settingType, context: 'autoMessageServiceSend' },
        extra: { patient_id: patientId.toString(), phone: recipientPhone, log_id: logEntry?._id?.toString() || 'N/A', error_details: error.response?.data || errorMessage }
    });

    // Atualiza o log no DB para indicar o erro
    if (logEntry) {
      await MessageLog.findByIdAndUpdate(logEntry._id, {
        status: LOG_STATUS.ERROR_SYSTEM, // Ou ERROR_WHATSAPP se o erro veio especificamente do serviço WA
        errorMessage: `Erro via serviço: ${errorMessage}`,
      }).catch(logUpdateError => { // Adiciona catch para erro ao atualizar o log
          console.error(`[SCHEDULER ${settingType}] Falha ao ATUALIZAR log de erro ${logEntry._id}:`, logUpdateError);
          captureException(logUpdateError, { tags: { severity: 'scheduler_log_update_failure' } });
      });
    }
    // Loga o erro no console do servidor da api-clinic
    console.error(`[SCHEDULER ${settingType}] ERRO ao solicitar envio para ${formattedPhone} (Log ID: ${logEntry?._id || 'N/A'}): ${errorMessage}`);
  }
};

// ===================================================================
// LÓGICA DE LEMBRETES DE CONSULTA (Otimizada com p-limit)
// ===================================================================
const checkAndSendAppointmentReminders = async (type, daysOffset) => {
  if (!pLimit) {
      console.warn(`[SCHEDULER ${type}] p-limit não carregado. Pulando execução.`);
      return;
  }
  const limit = pLimit(5); // Limita a 5 chamadas simultâneas (ajuste se necessário)
  // console.log(`[SCHEDULER] Iniciando verificação de ${type} com limite ${limit.concurrency}...`);

  try {
    const activeSettings = await MessageSetting.find({ type: type, isActive: true })
        .select('clinic template')
        .populate({ path: "template", select: "content" })
        .populate({ path: "clinic", select: "name owner", populate: { path: "owner", select: "name" }})
        .lean();

    if (!activeSettings || activeSettings.length === 0) {
      // console.log(`[SCHEDULER] Nenhuma configuração ativa para ${type}.`);
      return;
    }

    const now = new Date();
    let targetStart = new Date(now);
    let targetEnd = new Date(now);

    // Definição da janela de busca
    if (daysOffset > 0) {
      // Para dias antes, busca no dia inteiro (considerando UTC do DB)
      targetStart.setUTCDate(now.getUTCDate() + daysOffset);
      targetStart.setUTCHours(0, 0, 0, 0);
      targetEnd = new Date(targetStart);
      targetEnd.setUTCHours(23, 59, 59, 999);
    } else if (type === 'APPOINTMENT_1_MIN_BEFORE') {
        // Para minutos antes, busca em uma janela mais precisa (UTC)
        targetStart = new Date(now.getTime() + 1 * 60 * 1000); // 1 minuto a partir de agora
        targetEnd = new Date(now.getTime() + 2 * 60 * 1000);   // Até 2 minutos a partir de agora
    } else {
        console.warn(`[SCHEDULER ${type}] Tipo de offset (${daysOffset}) não tratado. Pulando.`);
        return;
    }

    // Otimização: Se a janela já passou, não busca no DB
    if (targetEnd <= now) {
         // console.log(`[SCHEDULER ${type}] Janela de busca (${targetStart.toISOString()} - ${targetEnd.toISOString()}) está no passado. Pulando.`);
         return;
    }

    // Processa cada configuração ativa em paralelo (limitado externamente por Promise.allSettled)
    const settingProcessingPromises = activeSettings.map(async (setting) => {
        if (!setting.template?.content || !setting.clinic?._id || !setting.clinic.owner?.name) {
            console.warn(`[SCHEDULER ${type}] Configuração ${setting._id} com dados populados inválidos ou incompletos. Pulando.`);
            return; // Pula esta configuração específica
        }

        const clinicId = setting.clinic._id;
        const clinicName = setting.clinic.name;
        const doctorName = setting.clinic.owner.name;
        const templateContent = setting.template.content;
        const templateId = setting.template._id;

        // Busca agendamentos dentro da janela calculada para esta clínica
        const appointments = await Appointment.find({
            clinic: clinicId,
            startTime: { $gte: targetStart, $lte: targetEnd },
            status: { $in: ["Agendado", "Confirmado"] },
            sendReminder: true, // Adiciona verificação do flag do agendamento
            // Verifica se o lembrete específico já foi enviado (ex: 'remindersSent.oneDayBefore')
            // Adapte o nome do campo conforme seu Appointment model
            // [`remindersSent.${type}`]: false // Descomente e ajuste se tiver campos específicos por tipo
        })
        .select('patient startTime') // Seleciona apenas o necessário + patient para populate
        .populate({ path: "patient", select: "name phone" }) // Popula só nome e telefone do paciente
        .lean();

        if(!appointments || appointments.length === 0) return; // Se não há agendamentos, finaliza para esta clínica

        // Mapeia as tarefas de envio usando o limitador
        const sendTasks = appointments.map(appointment => {
          // Validações essenciais
          if (!appointment.patient?._id || !appointment.patient.phone) {
              console.warn(`[SCHEDULER ${type}] Agendamento ${appointment._id} sem dados de paciente ou telefone válidos. Pulando.`);
              return Promise.resolve(); // Não quebra o map
          }

          const finalMessage = fillTemplate(templateContent, {
            patientName: appointment.patient.name,
            clinicName: clinicName,
            doctorName: doctorName,
            appointmentDate: formatDate(appointment.startTime),
            appointmentTime: formatTime(appointment.startTime),
            anamnesisLink: "" // Adicionar lógica se necessário
          });

          // Envolve a chamada a trySendMessageAndLog com o limitador
          return limit(() => trySendMessageAndLog({
            clinicId: clinicId,
            patientId: appointment.patient._id,
            recipientPhone: appointment.patient.phone,
            finalMessage: finalMessage,
            settingType: type,
            templateId: templateId,
          }));
        });

        // Aguarda todas as tarefas *desta clínica* concluírem
        await Promise.all(sendTasks);

        // Opcional: Marcar lembretes como enviados no Appointment model aqui,
        // mas pode ser complexo se o envio falhar. O log já registra a tentativa/sucesso.
    });

    // Aguarda o processamento de todas as configurações
    await Promise.all(settingProcessingPromises);

  } catch (error) {
      console.error(`[SCHEDULER ${type}] Erro GERAL durante a verificação:`, error);
      captureException(error, { tags: { severity: 'scheduler_general_failure', type: type } });
  } finally {
     // console.log(`[SCHEDULER] Finalizado verificação de ${type}.`);
  }
};

// ===================================================================
// LÓGICA DE ANIVERSÁRIO (Otimizada com p-limit)
// ===================================================================
const checkAndSendBirthdayWishes = async () => {
    if (!pLimit) {
        console.warn(`[SCHEDULER PATIENT_BIRTHDAY] p-limit não carregado. Pulando execução.`);
        return;
    }
    const limit = pLimit(10); // Limita a 10 chamadas simultâneas (ajuste)
    const type = "PATIENT_BIRTHDAY";
    // console.log(`[SCHEDULER] Iniciando verificação de ${type} com limite ${limit.concurrency}...`);

    try {
        const activeSettings = await MessageSetting.find({ type: type, isActive: true })
            .select('clinic template')
            .populate("template", "content")
            .populate({ path: "clinic", select: "name owner", populate: { path: "owner", select: "name" }})
            .lean();

        if (!activeSettings || activeSettings.length === 0) return;

        const today = new Date();
        // Ajusta para buscar pelo dia/mês no fuso horário local (ex: São Paulo) para evitar problemas de virada de dia UTC
        const todayLocal = new Date(today.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const todayDay = todayLocal.getDate();
        const todayMonth = todayLocal.getMonth() + 1; // getMonth() é 0-indexado
        // Define o início do dia local em UTC para consulta no DB
        const startOfDayLocal = new Date(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate());
        const startOfDayUTC = new Date(Date.UTC(startOfDayLocal.getFullYear(), startOfDayLocal.getMonth(), startOfDayLocal.getDate()));


        const settingProcessingPromises = activeSettings.map(async (setting) => {
            if (!setting.template?.content || !setting.clinic?._id || !setting.clinic.owner?.name) {
                 console.warn(`[SCHEDULER ${type}] Configuração ${setting._id} com dados incompletos. Pulando.`);
                 return;
            }

            const clinicId = setting.clinic._id;
            const clinicName = setting.clinic.name;
            const doctorName = setting.clinic.owner.name;
            const templateContent = setting.template.content;
            const templateId = setting.template._id;

            // Busca pacientes usando $dayOfMonth e $month (executa no servidor DB)
            const birthdayPatients = await Patient.find({
                clinicId: clinicId,
                $expr: {
                    $and: [
                        { $eq: [{ $dayOfMonth: { date: "$birthDate", timezone: "America/Sao_Paulo" } }, todayDay] }, // Usa timezone na query
                        { $eq: [{ $month: { date: "$birthDate", timezone: "America/Sao_Paulo" } }, todayMonth] }, // Usa timezone na query
                    ],
                },
                deletedAt: { $exists: false } // Ignora deletados
            }).select("_id name phone").lean(); // Busca ID, nome e telefone

            if(!birthdayPatients || birthdayPatients.length === 0) return;

            // Mapeia as tarefas de envio usando o limitador
            const sendTasks = birthdayPatients.map(async (patientData) => {
                if (!patientData.phone) {
                     console.warn(`[SCHEDULER ${type}] Paciente ${patientData._id} (${patientData.name}) sem telefone. Pulando.`);
                     return Promise.resolve();
                }

                // Verifica se já enviou HOJE (considerando início do dia UTC)
                const alreadySentToday = await MessageLog.exists({
                    clinic: clinicId,
                    patient: patientData._id,
                    settingType: type,
                    actionType: ACTION_TYPES.AUTOMATIC_BIRTHDAY,
                    status: { $in: [LOG_STATUS.SENT_ATTEMPT, LOG_STATUS.DELIVERED, LOG_STATUS.READ] },
                    createdAt: { $gte: startOfDayUTC } // Compara com início do dia em UTC
                });

                if (alreadySentToday) {
                    // console.log(`[SCHEDULER ${type}] Mensagem para ${patientData.name} já enviada hoje. Pulando.`);
                    return Promise.resolve();
                }

                const finalMessage = fillTemplate(templateContent, {
                    patientName: patientData.name,
                    clinicName: clinicName,
                    doctorName: doctorName,
                });

                return limit(() => trySendMessageAndLog({
                    clinicId: clinicId,
                    patientId: patientData._id,
                    recipientPhone: patientData.phone,
                    finalMessage: finalMessage,
                    settingType: type,
                    templateId: templateId,
                }));
            });
            await Promise.all(sendTasks);
        });

        await Promise.all(settingProcessingPromises);

    } catch (error) {
       console.error(`[SCHEDULER ${type}] Erro GERAL durante a verificação de aniversários:`, error);
       captureException(error, { tags: { severity: 'scheduler_general_failure', type: type } });
    } finally {
      // console.log(`[SCHEDULER] Finalizado verificação de ${type}.`);
    }
};

// ===================================================================
// INICIALIZAÇÃO DO CRON
// ===================================================================
exports.startAutoMessageScheduler = () => {
  // Verifica se o pLimit foi carregado antes de agendar
  if (!pLimit) {
      console.warn("--- [SCHEDULER] p-limit ainda não carregado, agendamento adiado. Tentando novamente em 5 segundos... ---");
      // Tenta novamente após um curto período
      setTimeout(exports.startAutoMessageScheduler, 5000);
      return;
  }

  console.log("--- Iniciando Agendador de Mensagens Automáticas (com p-limit)... ---");

  // CRON JOB 1: A CADA MINUTO
  cron.schedule("*/1 * * * *", () => {
    // Verifica pLimit novamente a cada execução (paranóia extra)
    if (pLimit) {
        // console.log("[CRON Minuto] Verificando lembretes de 1 min...");
        checkAndSendAppointmentReminders("APPOINTMENT_1_MIN_BEFORE", 0).catch(err => {
            console.error("[CRON Minuto] Erro não capturado em checkAndSendAppointmentReminders:", err);
            captureException(err, { tags: { severity: 'cron_job_failure', schedule: 'minute' }});
        });
    } else {
        console.warn("[CRON Minuto] p-limit não está disponível. Pulando execução.");
    }
  });

  // CRON JOB 2: DIÁRIO (Ex: 1:00 da manhã no fuso horário do servidor - geralmente UTC)
  // Se precisar que rode 1:00 AM de São Paulo, ajuste a string cron ou use timezone na config
  cron.schedule("0 1 * * *", () => { // "0 1 * * *" = 1:00 AM UTC
    if (pLimit) {
        console.log("[CRON Diário] Iniciando tarefas diárias (aniversários, lembretes)...");
        Promise.allSettled([
            checkAndSendAppointmentReminders("APPOINTMENT_2_DAYS_BEFORE", 2),
            checkAndSendAppointmentReminders("APPOINTMENT_1_DAY_BEFORE", 1),
            checkAndSendBirthdayWishes()
        ]).then(results => {
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    const taskName = ['Lembrete 2 Dias', 'Lembrete 1 Dia', 'Aniversário'][index];
                    console.error(`[CRON Diário] Erro na tarefa '${taskName}':`, result.reason);
                    captureException(result.reason, { tags: { severity: 'cron_job_failure', schedule: 'daily', task: taskName }});
                }
            });
            console.log("[CRON Diário] Tarefas diárias concluídas (verificar logs para erros individuais).");
        }).catch(err => { // Catch para erro no próprio Promise.allSettled (improvável)
             console.error("[CRON Diário] Erro inesperado ao processar tarefas diárias:", err);
             captureException(err, { tags: { severity: 'cron_job_failure', schedule: 'daily', task: 'allSettled' }});
        });
    } else {
        console.warn("[CRON Diário] p-limit não está disponível. Pulando execução.");
    }
  }, {
      timezone: "UTC" // Especifica explicitamente que o horário é UTC
  });

  console.log("--- Agendador de Mensagens Automáticas Iniciado e Tarefas Agendadas. ---");
};