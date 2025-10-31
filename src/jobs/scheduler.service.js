// src/jobs/scheduler.service.js
const mongoose = require('mongoose');

// --- IMPORTAÇÃO DOS MODELS ---
// A conexão já foi feita pelo server.js,
// mas precisamos dos models registrados no mongoose.
const Patient = require('../api/patients/patients.model');
const Clinic = require('../api/clinics/clinics.model');
const User = require('../api/users/users.model');
const MessageTemplate = require('../api/crm/modelos/message-template.model');
const MessageSetting = require('../api/crm/message-settings.model');
const Appointment = require('../api/appointments/appointments.model');
const { MessageLog, LOG_STATUS, ACTION_TYPES } = require('../api/crm/logs/message-log.model');
// --- FIM DOS MODELS ---

// Outras dependências
const whatsappServiceClient = require('../services/whatsappServiceClient');
const { createLogEntry } = require('../api/crm/logs/message-log.controller');
const { captureException } = require('../utils/sentry');
const { DateTime } = require('luxon');
const { sendToDiscord } = require('../utils/discordLogger');

// p-limit (carregado dinamicamente)
let pLimit;
(async () => {
    try {
        const module = await import('p-limit');
        pLimit = module.default;
    } catch (err) {
        captureException(err, { tags: { severity: 'critical', context: 'p-limit-main-load' } });
        console.error(`[SCHEDULER SERVICE] Falha crítica ao carregar p-limit.`);
        // Se falhar, as tarefas não rodarão com limite
    }
})();

const BR_TZ = 'America/Sao_Paulo';

// --- FUNÇÕES HELPER (fillTemplate, formatDate, formatTime) ---
// (Exatamente como estavam no seu worker)
const fillTemplate = (templateContent, data) => {
    let content = templateContent || '';
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
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return "";
  return dateObj.toLocaleDateString("pt-BR", { timeZone: BR_TZ });
};

const formatTime = (date) => {
  if (!date) return "";
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return "";
  return dateObj.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BR_TZ
  });
};

// --- LÓGICA DE ENVIO E LOG (Modificada para aceitar taskName) ---
const trySendMessageAndLog = async (taskName, {
    clinicId,
    patientId,
    recipientPhone,
    finalMessage,
    settingType,
    templateId,
    clinicName,
}) => {
    if (!clinicId || !patientId || !recipientPhone || !finalMessage || !settingType) {
        console.warn(`[SCHEDULER ${taskName}] Dados insuficientes para enviar mensagem/log.`);
        sendToDiscord(`Dados insuficientes para enviar ${settingType} para ${recipientPhone}`, 'warn', taskName);
        return;
    }

    const formattedPhone = recipientPhone.replace(/\D/g, '');
    let logEntry;

    try {
        logEntry = await createLogEntry({
            clinic: clinicId,
            patient: patientId,
            template: templateId,
            settingType: settingType,
            messageContent: finalMessage,
            recipientPhone: formattedPhone,
            status: LOG_STATUS.SENT_ATTEMPT,
            actionType: settingType === "PATIENT_BIRTHDAY"
                ? ACTION_TYPES.AUTOMATIC_BIRTHDAY
                : ACTION_TYPES.AUTOMATIC_REMINDER,
        });

        if (!logEntry) throw new Error("Falha ao criar entrada de log inicial.");

        console.log(`[SCHEDULER ${taskName}] Tentando enviar ${settingType} para ${formattedPhone} (Clínica: ${clinicName || clinicId})`);

        const response = await whatsappServiceClient.sendMessage(clinicId, formattedPhone, finalMessage);

        await MessageLog.findByIdAndUpdate(logEntry._id, {
            status: LOG_STATUS.DELIVERED,
            wwebjsMessageId: response.data?.result?.id?.id || null,
        });

        sendToDiscord(
            `Mensagem automática (${settingType}) enviada com sucesso para ${formattedPhone}`,
            'success',
            taskName,
            `Clínica: ${clinicName || clinicId} | Log ID: ${logEntry._id}`
        );
        console.log(`[SCHEDULER ${taskName}] Sucesso ao enviar ${settingType} para ${formattedPhone}. Log ID: ${logEntry._id}`);

    } catch (error) {
        const errorMessage = error.response?.data?.message || error.message || 'Erro desconhecido ao contatar serviço WhatsApp.';
        const logIdForError = logEntry?._id?.toString() || 'N/A';

        console.error(`[SCHEDULER ${taskName}] Falha ao enviar ${settingType} para ${formattedPhone}. Erro: ${errorMessage}. Log ID: ${logIdForError}`);

        captureException(error, {
            tags: { severity: 'whatsapp_automatic_failure', clinic_id: clinicId.toString(), setting_type: settingType, context: 'schedulerServiceSend', workerTask: taskName },
            extra: { patient_id: patientId.toString(), phone: recipientPhone, log_id: logIdForError, error_details: error.response?.data || errorMessage }
        });

        if (logEntry) {
            await MessageLog.findByIdAndUpdate(logEntry._id, {
                status: LOG_STATUS.ERROR_SYSTEM,
                errorMessage: `Erro via serviço (Scheduler ${taskName}): ${errorMessage.substring(0, 1000)}`,
            }).catch(logUpdateError => {
                captureException(logUpdateError, { tags: { severity: 'scheduler_log_update_failure', workerTask: taskName } });
                console.error(`[SCHEDULER ${taskName}] Falha ao atualizar log de erro ${logIdForError}:`, logUpdateError.message);
            });
        }

        sendToDiscord(
            `Falha ao enviar mensagem automática (${settingType}) para ${formattedPhone}\n**Erro:** ${errorMessage.substring(0, 1000)}`,
            'error',
            taskName,
            `Clínica: ${clinicName || clinicId} | Log ID: ${logIdForError}`
        );
    }
};

// --- LÓGICA DE VERIFICAÇÃO (Modificada para aceitar taskName) ---
const checkAndSendAppointmentReminders = async (taskName, daysOffset) => {
  const type = taskName; // O taskName é o tipo (ex: "APPOINTMENT_1_DAY_BEFORE")
  
  if (!pLimit) {
       console.warn(`[SCHEDULER ${taskName}] pLimit não inicializado, abortando lembretes.`);
       sendToDiscord(`pLimit não inicializado, abortando ${type}`, 'warn', taskName);
       return;
  }
  const limit = pLimit(5);
  const nowUtc = DateTime.utc();

  let targetStartUtc, targetEndUtc;
  if (daysOffset > 0) {
      targetStartUtc = nowUtc.plus({ days: daysOffset }).setZone(BR_TZ).startOf('day').toUTC();
      targetEndUtc = nowUtc.plus({ days: daysOffset }).setZone(BR_TZ).endOf('day').toUTC();
  } else if (type === 'APPOINTMENT_3_MINS_BEFORE') {
      targetStartUtc = nowUtc.plus({ minutes: 3 }).startOf('minute');
      targetEndUtc = nowUtc.plus({ minutes: 3 }).endOf('minute');
  } else {
      console.warn(`[SCHEDULER ${taskName}] Tipo de lembrete não suportado para offset 0: ${type}`);
      sendToDiscord(`Tipo de lembrete não suportado p/ offset 0: ${type}`, 'warn', taskName);
      return;
  }

  const targetStartDate = targetStartUtc.toJSDate();
  const targetEndDate = targetEndUtc.toJSDate();

  console.log(`[SCHEDULER ${taskName}] Buscando agendamentos (${type}) entre ${targetStartDate.toISOString()} e ${targetEndDate.toISOString()}`);

  const activeSettings = await MessageSetting.find({ type: type, isActive: true })
      .select('clinic template')
      .populate({ path: "template", select: "content" })
      .populate({ path: "clinic", select: "name owner", populate: { path: "owner", select: "name" }})
      .lean();

  if (!activeSettings || activeSettings.length === 0) {
      console.log(`[SCHEDULER ${taskName}] Nenhuma configuração ativa encontrada para ${type}.`);
      return;
  }
  console.log(`[SCHEDULER ${taskName}] ${activeSettings.length} configurações ativas para ${type}.`);

  const settingProcessingPromises = activeSettings.map(async (setting) => {
      if (!setting.template?.content || !setting.clinic?._id || !setting.clinic.owner?.name) {
           console.warn(`[SCHEDULER ${taskName}] Configuração inválida ou incompleta ignorada para clínica ${setting.clinic?._id}. Template: ${setting.template?._id}, Owner: ${setting.clinic?.owner?._id}`);
           sendToDiscord(`Configuração inválida/incompleta ignorada para ${type}`, 'warn', taskName, `Clínica: ${setting.clinic?._id}`);
           return;
      }

      const { _id: clinicId, name: clinicName, owner } = setting.clinic;
      const doctorName = owner.name;
      const templateContent = setting.template.content;
      const templateId = setting.template._id;

      const appointments = await Appointment.find({
          clinic: clinicId,
          startTime: { $gte: targetStartDate, $lte: targetEndDate },
          status: { $in: ["Agendado", "Confirmado"] },
          sendReminder: true,
      })
      .select('patient startTime _id') 
      .populate({ path: "patient", select: "name phone _id" }) 
      .lean();

      if (!appointments || appointments.length === 0) {
          return;
      }
      console.log(`[SCHEDULER ${taskName}] ${appointments.length} agendamentos encontrados para ${clinicName} (${type}).`);

      const sendTasks = appointments.map(appointment => {
        if (!appointment.patient?._id || !appointment.patient.phone) {
            console.warn(`[SCHEDULER ${taskName}] Agendamento ${appointment._id} ignorado por falta de dados do paciente.`);
            return Promise.resolve();
        }

        const finalMessage = fillTemplate(templateContent, {
          patientName: appointment.patient.name,
          clinicName: clinicName,
          doctorName: doctorName,
          appointmentDate: formatDate(appointment.startTime),
          appointmentTime: formatTime(appointment.startTime),
          anamnesisLink: ""
        });

        // Passa o taskName para a função de log
        return limit(() => trySendMessageAndLog(taskName, {
          clinicId: clinicId,
          patientId: appointment.patient._id,
          recipientPhone: appointment.patient.phone,
          finalMessage: finalMessage,
          settingType: type,
          templateId: templateId,
          clinicName: clinicName,
        }));
      });
      await Promise.all(sendTasks);
  });

  await Promise.all(settingProcessingPromises);
  console.log(`[SCHEDULER ${taskName}] Processamento de lembretes (${type}) concluído.`);
};

const checkAndSendBirthdayWishes = async (taskName) => {
    const type = "PATIENT_BIRTHDAY";
    if (!pLimit) {
         console.warn(`[SCHEDULER ${taskName}] pLimit não inicializado, abortando aniversários.`);
         sendToDiscord(`pLimit não inicializado, abortando ${taskName}`, 'warn', taskName);
         return;
    }
    const limit = pLimit(10);
    
    console.log(`[SCHEDULER ${taskName}] Buscando configurações ativas para ${type}.`);

    const activeSettings = await MessageSetting.find({ type: type, isActive: true })
        .select('clinic template')
        .populate("template", "content")
        .populate({ path: "clinic", select: "name owner", populate: { path: "owner", select: "name" }})
        .lean();

    if (!activeSettings || activeSettings.length === 0) {
        console.log(`[SCHEDULER ${taskName}] Nenhuma configuração ativa encontrada para ${type}.`);
        return;
    }
     console.log(`[SCHEDULER ${taskName}] ${activeSettings.length} configurações ativas para ${type}.`);

    const today = new Date();
    const todayLocal = new Date(today.toLocaleString('en-US', { timeZone: BR_TZ }));
    const todayDay = todayLocal.getDate();
    const todayMonth = todayLocal.getMonth() + 1;
    const startOfDayLocal = new Date(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate());
    const startOfDayUTC = new Date(Date.UTC(startOfDayLocal.getFullYear(), startOfDayLocal.getMonth(), startOfDayLocal.getDate()));

    console.log(`[SCHEDULER ${taskName}] Verificando aniversariantes para ${todayDay}/${todayMonth}.`);

    const settingProcessingPromises = activeSettings.map(async (setting) => {
        if (!setting.template?.content || !setting.clinic?._id || !setting.clinic.owner?.name) {
             console.warn(`[SCHEDULER ${taskName}] Configuração de aniversário inválida ignorada para clínica ${setting.clinic?._id}. Template: ${setting.template?._id}, Owner: ${setting.clinic?.owner?._id}`);
             sendToDiscord(`Configuração de aniversário inválida/incompleta ignorada`, 'warn', taskName, `Clínica: ${setting.clinic?._id}`);
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
                    { $eq: [{ $dayOfMonth: { date: "$birthDate", timezone: BR_TZ } }, todayDay] },
                    { $eq: [{ $month: { date: "$birthDate", timezone: BR_TZ } }, todayMonth] },
                ],
            },
            deletedAt: { $exists: false }
        }).select("_id name phone").lean();

        if (!birthdayPatients || birthdayPatients.length === 0) {
            return;
        }
        console.log(`[SCHEDULER ${taskName}] ${birthdayPatients.length} aniversariantes encontrados para ${clinicName}.`);

        const sendTasks = birthdayPatients.map(async (patientData) => {
            if (!patientData.phone) {
                 console.warn(`[SCHEDULER ${taskName}] Paciente ${patientData._id} (Aniversariante) ignorado por falta de telefone.`);
                 return Promise.resolve();
            }

            const alreadySentToday = await MessageLog.exists({
                clinic: clinicId,
                patient: patientData._id,
                settingType: type,
                actionType: ACTION_TYPES.AUTOMATIC_BIRTHDAY,
                status: { $in: [LOG_STATUS.SENT_ATTEMPT, LOG_STATUS.DELIVERED, LOG_STATUS.READ] },
                createdAt: { $gte: startOfDayUTC }
            });

            if (alreadySentToday) {
                return Promise.resolve();
            }

            const finalMessage = fillTemplate(templateContent, {
                patientName: patientData.name,
                clinicName: clinicName,
                doctorName: doctorName,
            });

            // Passa o taskName para a função de log
            return limit(() => trySendMessageAndLog(taskName, {
                clinicId: clinicId,
                patientId: patientData._id,
                recipientPhone: patientData.phone,
                finalMessage: finalMessage,
                settingType: type,
                templateId: templateId,
                clinicName: clinicName,
            }));
        });
        await Promise.all(sendTasks);
    });

    await Promise.all(settingProcessingPromises);
    console.log(`[SCHEDULER ${taskName}] Processamento de aniversários concluído.`);
};

// --- FUNÇÃO PRINCIPAL (Exportada) ---
exports.runTask = async (taskName) => {
    // 1. Verifica se pLimit está pronto
    if (!pLimit) {
        const err = new Error('p-limit não carregou a tempo para a tarefa.');
        console.error(`[SCHEDULER ${taskName}] Erro fatal: ${err.message}`);
        captureException(err, { tags: { severity: 'critical', context: 'p-limit-run-timeout', workerTask: taskName } });
        sendToDiscord(`pLimit não carregou, tarefa ${taskName} abortada.`, 'error', taskName);
        return; // Aborta a tarefa
    }
    
    // 2. Não precisamos mais conectar ao DB. A conexão é global.
    
    try {
        console.log(`[SCHEDULER ${taskName}] Iniciando execução da tarefa no processo principal.`);
        switch (taskName) {
            case 'APPOINTMENT_3_MINS_BEFORE':
                await checkAndSendAppointmentReminders(taskName, 0);
                break;
            case 'APPOINTMENT_2_DAYS_BEFORE':
                await checkAndSendAppointmentReminders(taskName, 2);
                break;
            case 'APPOINTMENT_1_DAY_BEFORE':
                await checkAndSendAppointmentReminders(taskName, 1);
                break;
            case 'PATIENT_BIRTHDAY':
                await checkAndSendBirthdayWishes(taskName);
                break;
            default:
                 console.warn(`[SCHEDULER ${taskName}] Tarefa desconhecida recebida: ${taskName}`);
                 sendToDiscord(`Tarefa desconhecida recebida: ${taskName}`, 'warn', taskName);
                break;
        }
        console.log(`[SCHEDULER ${taskName}] Tarefa concluída com sucesso.`);
        // Não precisamos mais do parentPort.postMessage
    } catch (error) {
        console.error(`[SCHEDULER ${taskName}] Erro durante a execução da tarefa:`, error.stack || error.message);
        captureException(error, { tags: { severity: 'scheduler_task_failure', task: taskName, context: 'runTaskService' } });
        sendToDiscord(`Erro durante a execução: ${error.message.substring(0, 1000)}`, 'error', taskName);
        throw error;
    }
    // Não desconectamos mais o mongoose
};