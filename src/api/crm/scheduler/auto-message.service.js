// src/api/crm/scheduler/auto-message.service.js
const cron = require("node-cron");
const MessageSetting = require("../message-settings.model");
const MessageTemplate = require("../modelos/message-template.model");
const Appointment = require("../../appointments/appointments.model");
const Patient = require("../../patients/patients.model");
const whatsappServiceClient = require('../../../services/whatsappServiceClient'); //
const { createLogEntry } = require("../logs/message-log.controller");
const { MessageLog, LOG_STATUS, ACTION_TYPES } = require("../logs/message-log.model");
const { captureException } = require('../../../utils/sentry');
const pLimit = require('p-limit'); // Importa o p-limit

// ===================================================================
// UTILS DE FORMATAÇÃO E PREENCHIMENTO
// ===================================================================

const fillTemplate = (templateContent, data) => {
    let content = templateContent;
    content = content.replace(/{ paciente }/g, data.patientName || "Paciente");
    content = content.replace(/{paciente}/g, data.patientName || "Paciente");
    content = content.replace(/{ clinica }/g, data.clinicName || "Clínica");
    content = content.replace(/{ nome_medico }/g, data.doctorName || "Dr(a).");
    content = content.replace(/{ data_consulta }/g, data.appointmentDate || "");
    content = content.replace(/{ hora_consulta }/g, data.appointmentTime || "");
    content = content.replace(/{ link_anamnese }/g, data.anamnesisLink || "");
    return content.trim();
}; //

const formatDate = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleDateString("pt-BR");
}; //

const formatTime = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}; //

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
  const formattedPhone = recipientPhone;

  let logEntry;
  try {
    // 1. Cria o log local com status SENT_ATTEMPT
    logEntry = await createLogEntry({
      clinic: clinicId,
      patient: patientId,
      template: templateId,
      settingType: settingType,
      messageContent: finalMessage,
      recipientPhone: formattedPhone,
      status: LOG_STATUS.SENT_ATTEMPT,
      actionType:
        settingType === "PATIENT_BIRTHDAY"
          ? ACTION_TYPES.AUTOMATIC_BIRTHDAY
          : ACTION_TYPES.AUTOMATIC_REMINDER,
    });

    if (!logEntry) {
        // Adiciona log de erro se a criação do log falhar
        console.error(`[SCHEDULER ${settingType}] Falha crítica ao criar entrada de log inicial para Paciente ${patientId}. Abortando envio.`);
        captureException(new Error("Falha ao criar entrada de log inicial no scheduler"), {
             tags: { severity: 'scheduler_log_failure', clinic_id: clinicId.toString(), setting_type: settingType },
             extra: { patient_id: patientId.toString(), phone: recipientPhone }
        });
        return; // Impede a tentativa de envio se o log não puder ser criado
    }

    // 2. Chama o serviço WhatsApp dedicado para realizar o envio
    // console.log(`[SCHEDULER ${clinicId}] Solicitando envio para ${formattedPhone} via serviço... Log ID: ${logEntry._id}`);
    const response = await whatsappServiceClient.sendMessage(clinicId, formattedPhone, finalMessage);
    // console.log(`[SCHEDULER ${clinicId}] Resposta do serviço para ${formattedPhone} (Log ID: ${logEntry._id}): Status ${response.status}`);

    // 3. Atualiza o log local para DELIVERED
    await MessageLog.findByIdAndUpdate(logEntry._id, {
      status: LOG_STATUS.DELIVERED,
      wwebjsMessageId: response.data?.result?.id?.id || null,
    });

    // console.log(`[SCHEDULER ${settingType}] Mensagem enviada para ${formattedPhone} via serviço. Log ID: ${logEntry._id}`);

  } catch (error) {
    // 4. Em caso de erro na comunicação ou erro retornado pelo serviço
    captureException(error, {
        tags: {
            severity: 'whatsapp_automatic_failure',
            clinic_id: clinicId.toString(),
            setting_type: settingType,
            context: 'autoMessageServiceSend'
        },
        extra: {
            patient_id: patientId.toString(),
            phone: recipientPhone,
            log_id: logEntry?._id?.toString() || 'N/A',
            error_details: error.response?.data || error.message || 'Erro desconhecido'
        }
    });

    // Atualiza o log no DB para indicar o erro
    if (logEntry) {
      await MessageLog.findByIdAndUpdate(logEntry._id, {
        status: LOG_STATUS.ERROR_SYSTEM,
        errorMessage: `Erro via serviço: ${error.response?.data?.message || error.message}`,
      }).catch(logUpdateError => { // Adiciona catch para erro ao atualizar o log
          console.error(`[SCHEDULER ${settingType}] Falha ao ATUALIZAR log de erro ${logEntry._id}:`, logUpdateError);
          captureException(logUpdateError, { tags: { severity: 'scheduler_log_update_failure' } });
      });
    }
    console.error(`[SCHEDULER ${settingType}] ERRO ao solicitar envio para ${formattedPhone} (Log ID: ${logEntry?._id || 'N/A'}): ${error.response?.data?.message || error.message}`);
  }
};

// ===================================================================
// LÓGICA DE LEMBRETES DE CONSULTA (Otimizada com p-limit)
// ===================================================================

const checkAndSendAppointmentReminders = async (type, daysOffset) => {
  const limit = pLimit(5); // Limita a 5 chamadas simultâneas (ajuste conforme necessário)
  // console.log(`[SCHEDULER] Iniciando verificação de ${type} com limite de ${limit.concurrency}...`);

  try { // Adiciona try/catch geral para a função
    const activeSettings = await MessageSetting.find({ type: type, isActive: true })
        .select('clinic template') // Busca apenas os IDs necessários inicialmente
        .populate({ path: "template", select: "content" }) // Popula conteúdo do template
        .populate({
          path: "clinic",
          select: "name owner",
          populate: { path: "owner", select: "name" },
        })
        .lean(); // Usa lean() para performance

    if (activeSettings.length === 0) {
      // console.log(`[SCHEDULER] Nenhuma configuração ativa para ${type}.`);
      return;
    }

    const now = new Date();
    let targetStart = new Date(now);
    let targetEnd = new Date(now);

    // Definição da janela de busca
    if (daysOffset > 0) {
      targetStart.setDate(now.getDate() + daysOffset);
      targetEnd.setDate(targetStart.getDate());
      targetStart.setHours(0, 0, 0, 0);
      targetEnd.setHours(23, 59, 59, 999);
    } else if (type === 'APPOINTMENT_1_MIN_BEFORE') {
        targetStart = new Date(now.getTime() + 1 * 60 * 1000);
        targetEnd = new Date(now.getTime() + 2 * 60 * 1000);
    } else {
        console.warn(`[SCHEDULER ${type}] Tipo de offset não tratado. Pulando.`);
        return; // Sai da função se o tipo não for esperado
    }

    if (targetEnd <= now) {
         // console.log(`[SCHEDULER ${type}] Janela de busca no passado. Pulando.`);
         return;
    }

    // Processa cada configuração ativa
    const settingProcessingPromises = activeSettings.map(async (setting) => {
        if (!setting.template || !setting.clinic || !setting.clinic.owner) {
            console.warn(`[SCHEDULER ${type}] Configuração ${setting._id} com dados populados incompletos. Pulando.`);
            return; // Pula esta configuração específica
        }

        const clinicId = setting.clinic._id;
        const clinicName = setting.clinic.name;
        const doctorName = setting.clinic.owner.name;
        const templateContent = setting.template.content;
        const templateId = setting.template._id;

        const appointments = await Appointment.find({
            clinic: clinicId,
            startTime: { $gte: targetStart, $lte: targetEnd },
            status: { $in: ["Agendado", "Confirmado"] },
        }).populate("patient", "name phone").lean(); // Usa lean() aqui também

        if(appointments.length === 0) return; // Se não há agendamentos, não faz nada para esta clínica

        // Mapeia as tarefas de envio usando o limitador
        const sendTasks = appointments.map(appointment => {
          if (!appointment.patient || !appointment.patient.phone) {
              console.warn(`[SCHEDULER ${type}] Agendamento ${appointment._id} sem paciente ou telefone válidos. Pulando.`);
              return Promise.resolve(); // Retorna promessa resolvida para não quebrar o map
          }

          const finalMessage = fillTemplate(templateContent, {
            patientName: appointment.patient.name,
            clinicName: clinicName,
            doctorName: doctorName,
            appointmentDate: formatDate(appointment.startTime),
            appointmentTime: formatTime(appointment.startTime),
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
    const limit = pLimit(10); // Limita a 10 chamadas simultâneas (ajuste)
    const type = "PATIENT_BIRTHDAY";
    // console.log(`[SCHEDULER] Iniciando verificação de ${type} com limite de ${limit.concurrency}...`);

    try { // Adiciona try/catch geral
        const activeSettings = await MessageSetting.find({ type: type, isActive: true })
            .select('clinic template')
            .populate("template", "content")
            .populate({
                path: "clinic",
                select: "name owner",
                populate: { path: "owner", select: "name" },
            })
            .lean();

        if (activeSettings.length === 0) return;

        const today = new Date();
        const todayDay = today.getDate();
        const todayMonth = today.getMonth() + 1;
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // Zera a hora corretamente

        const settingProcessingPromises = activeSettings.map(async (setting) => {
            if (!setting.template || !setting.clinic || !setting.clinic.owner) {
                 console.warn(`[SCHEDULER ${type}] Configuração ${setting._id} com dados incompletos. Pulando.`);
                 return;
            }

            const clinicId = setting.clinic._id;
            const clinicName = setting.clinic.name;
            const doctorName = setting.clinic.owner.name;
            const templateContent = setting.template.content;
            const templateId = setting.template._id;

            const birthdayPatients = await Patient.find({
                clinicId: clinicId,
                $expr: {
                    $and: [
                        { $eq: [{ $dayOfMonth: "$birthDate" }, todayDay] },
                        { $eq: [{ $month: "$birthDate" }, todayMonth] },
                    ],
                },
                deletedAt: { $exists: false }
            }).select("name phone").lean(); // Busca só nome e telefone

            if(birthdayPatients.length === 0) return;

            // Mapeia as tarefas de envio usando o limitador
            const sendTasks = birthdayPatients.map(async (patientData) => {
                if (!patientData.phone) {
                     console.warn(`[SCHEDULER ${type}] Paciente ${patientData._id} (${patientData.name}) sem telefone. Pulando.`);
                     return Promise.resolve();
                }

                // Verifica se já enviou HOJE
                const alreadySentToday = await MessageLog.exists({
                    clinic: clinicId,
                    patient: patientData._id,
                    settingType: type,
                    actionType: ACTION_TYPES.AUTOMATIC_BIRTHDAY,
                    status: { $in: [LOG_STATUS.SENT_ATTEMPT, LOG_STATUS.DELIVERED, LOG_STATUS.READ] },
                    createdAt: { $gte: startOfDay }
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

                // Envolve a chamada a trySendMessageAndLog com o limitador
                return limit(() => trySendMessageAndLog({
                    clinicId: clinicId,
                    patientId: patientData._id,
                    recipientPhone: patientData.phone,
                    finalMessage: finalMessage,
                    settingType: type,
                    templateId: templateId,
                }));
            });

            // Aguarda todas as tarefas *desta clínica* concluírem
            await Promise.all(sendTasks);
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
// INICIALIZAÇÃO DO CRON (Sem alterações na estrutura)
// ===================================================================

exports.startAutoMessageScheduler = () => {
  console.log("--- Iniciando Agendador de Mensagens Automáticas (com p-limit)... ---");

  // CRON JOB 1: A CADA MINUTO
  cron.schedule("*/1 * * * *", () => {
    // console.log("[CRON Minuto] Verificando lembretes..."); // Log opcional
    checkAndSendAppointmentReminders("APPOINTMENT_1_MIN_BEFORE", 0).catch(err => {
        console.error("[CRON Minuto] Erro não capturado em checkAndSendAppointmentReminders:", err);
        captureException(err, { tags: { severity: 'cron_job_failure', schedule: 'minute' }});
    });
  });

  // CRON JOB 2: DIÁRIO (Ex: 1h da manhã)
  cron.schedule("0 1 * * *", () => { // Ajuste o horário conforme necessário
    console.log("[CRON Diário] Iniciando tarefas diárias...");
    // Executa as tarefas diárias sequencialmente ou em paralelo, capturando erros individuais
    Promise.allSettled([
        checkAndSendAppointmentReminders("APPOINTMENT_2_DAYS_BEFORE", 2),
        checkAndSendAppointmentReminders("APPOINTMENT_1_DAY_BEFORE", 1),
        checkAndSendBirthdayWishes()
    ]).then(results => {
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                const taskName = ['2 Days Before', '1 Day Before', 'Birthday'][index];
                console.error(`[CRON Diário] Erro na tarefa '${taskName}':`, result.reason);
                captureException(result.reason, { tags: { severity: 'cron_job_failure', schedule: 'daily', task: taskName }});
            }
        });
        console.log("[CRON Diário] Tarefas diárias concluídas (verificar erros acima se houver).");
    });
  });

  console.log("--- Agendador de Mensagens Automáticas Iniciado. ---");
};