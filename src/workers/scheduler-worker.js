// src/workers/scheduler-worker.js
const { parentPort, workerData } = require('worker_threads');
const mongoose = require('mongoose'); // Importa o mongoose

// --- CONEXÃO COM O MONGODB DENTRO DO WORKER ---
let dbConnected = false;
const connectDB = async (uri, taskNameForLog) => { // Adiciona taskNameForLog para logs
    if (dbConnected) return;
    try {
        await mongoose.connect(uri, {
            autoIndex: false,
            maxPoolSize: 5,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 30000,
        });
        dbConnected = true;
        console.log(`[SCHEDULER WORKER ${taskNameForLog}] MongoDB Conectado.`);
    } catch (err) {
        console.error(`[SCHEDULER WORKER ${taskNameForLog}] Erro ao conectar MongoDB:`, err.message);
        parentPort.postMessage({ status: 'error', taskName: taskNameForLog, error: `DB Connection Failed: ${err.message}` });
        process.exit(1);
    }
};
// --- FIM DA CONEXÃO ---

// Importe os modelos *depois* do mongoose
const MessageSetting = require('../api/crm/message-settings.model');
const Appointment = require('../api/appointments/appointments.model');
const Patient = require('../api/patients/patients.model');
const whatsappServiceClient = require('../services/whatsappServiceClient');
const { createLogEntry } = require('../api/crm/logs/message-log.controller');
const { MessageLog, LOG_STATUS, ACTION_TYPES } = require('../api/crm/logs/message-log.model');
const { captureException } = require('../utils/sentry');
const { DateTime } = require('luxon');
const axios = require('axios');
const { sendToDiscord } = require('../utils/discordLogger');

let pLimit;
(async () => {
    try {
        const module = await import('p-limit');
        pLimit = module.default;
    } catch (err) {
        captureException(err, { tags: { severity: 'critical', context: 'p-limit-worker-load' } });
        console.error(`[SCHEDULER WORKER ${workerData?.taskName || 'UNKNOWN'}] Falha crítica ao carregar p-limit. Encerrando.`);
        parentPort.postMessage({ status: 'error', taskName: workerData?.taskName || 'UNKNOWN', error: 'Failed to load p-limit' });
        process.exit(1);
    }
})().catch(err => {
     captureException(err, { tags: { severity: 'critical', context: 'p-limit-iife-catch' } });
     console.error(`[SCHEDULER WORKER ${workerData?.taskName || 'UNKNOWN'}] Falha crítica no setup inicial (p-limit IIFE). Encerrando.`);
     parentPort.postMessage({ status: 'error', taskName: workerData?.taskName || 'UNKNOWN', error: 'Critical setup failure (p-limit)' });
     process.exit(1);
});

const BR_TZ = 'America/Sao_Paulo';

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

const DISCORD_WEBHOOK_URL = workerData.discordWebhookUrl || 'https://discord.com/api/webhooks/1432810373244915732/OapA83WGKuWf1rlxbtQGFPkwD_H4K9mIxtO8BaIKrO1ZVyT5u5UNyKLVi_U0u0Ce41D1';

const sendDiscordNotificationInternal = (color, title, fields, footer) => {
    if (!DISCORD_WEBHOOK_URL) return;
    const taskName = workerData?.taskName || 'UNKNOWN'; // Pega taskName do workerData para logs

    const payload = {
        username: 'CRM Worker Bot',
        embeds: [{
            color: color,
            title: title,
            timestamp: new Date().toISOString(),
            fields: fields,
            footer: footer ? { text: footer } : undefined,
        }]
    };

    axios.post(DISCORD_WEBHOOK_URL, payload)
        .catch(err => {
             console.error(`[SCHEDULER WORKER ${taskName}] Erro ao enviar notificação Discord:`, err.message);
        });
};

const trySendMessageAndLog = async ({
    clinicId,
    patientId,
    recipientPhone,
    finalMessage,
    settingType,
    templateId,
    clinicName,
}) => {
    const taskName = workerData?.taskName || 'UNKNOWN'; // Pega taskName do workerData
    if (!clinicId || !patientId || !recipientPhone || !finalMessage || !settingType) {
        console.warn(`[SCHEDULER WORKER ${taskName}] Dados insuficientes para enviar mensagem/log.`);
        return;
    }

    const formattedPhone = recipientPhone.replace(/\D/g, '');

    let logEntry;
    let notificationTitle;
    let notificationColor;
    let notificationFields = [];

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

        const response = await whatsappServiceClient.sendMessage(clinicId, formattedPhone, finalMessage);

        await MessageLog.findByIdAndUpdate(logEntry._id, {
            status: LOG_STATUS.DELIVERED,
            wwebjsMessageId: response.data?.result?.id?.id || null,
        });

        notificationTitle = `✅ Sucesso: Mensagem Automática Enviada (${settingType})`;
        notificationColor = 3066993; // Verde
        notificationFields = [
            { name: 'Clínica', value: clinicName || clinicId.toString(), inline: true },
            { name: 'Tipo', value: settingType, inline: true },
            { name: 'Telefone', value: formattedPhone, inline: true },
            { name: 'Log ID', value: logEntry._id.toString(), inline: false },
        ];

        sendDiscordNotificationInternal(notificationColor, notificationTitle, notificationFields, `Status: ${LOG_STATUS.DELIVERED}`);

    } catch (error) {
        const errorMessage = error.response?.data?.message || error.message || 'Erro desconhecido ao contatar serviço WhatsApp.';
        captureException(error, {
            tags: { severity: 'whatsapp_automatic_failure', clinic_id: clinicId.toString(), setting_type: settingType, context: 'workerServiceSend', workerTask: taskName }, // Adiciona workerTask
            extra: { patient_id: patientId.toString(), phone: recipientPhone, log_id: logEntry?._id?.toString() || 'N/A', error_details: error.response?.data || errorMessage }
        });

        if (logEntry) {
            await MessageLog.findByIdAndUpdate(logEntry._id, {
                status: LOG_STATUS.ERROR_SYSTEM,
                errorMessage: `Erro via serviço (Worker ${taskName}): ${errorMessage}`, // Adiciona workerTask na msg
            }).catch(logUpdateError => {
                captureException(logUpdateError, { tags: { severity: 'worker_log_update_failure', workerTask: taskName } }); // Adiciona workerTask
                console.error(`[SCHEDULER WORKER ${taskName}] Falha ao atualizar log de erro:`, logUpdateError.message);
            });
        }

        const logId = logEntry?._id?.toString() || 'N/A';
        notificationTitle = `❌ ERRO: Falha no Envio Automático (${settingType})`;
        notificationColor = 15158332; // Vermelho
        notificationFields = [
            { name: 'Clínica', value: clinicName || clinicId.toString(), inline: true },
            { name: 'Tipo', value: settingType, inline: true },
            { name: 'Telefone', value: formattedPhone, inline: true },
            { name: 'Erro', value: errorMessage.substring(0, 1020), inline: false }, // Limita tamanho do erro
            { name: 'Log ID', value: logId, inline: false },
        ];

        sendDiscordNotificationInternal(notificationColor, notificationTitle, notificationFields, `Status: ${LOG_STATUS.ERROR_SYSTEM}`);
    }
};

// **Recebe taskName como argumento**
const checkAndSendAppointmentReminders = async (taskName, type, daysOffset) => {
    if (!pLimit) {
         console.warn(`[SCHEDULER WORKER ${taskName}] pLimit não inicializado, abortando lembretes.`);
         return;
    }
    const limit = pLimit(5);
    const nowUtc = DateTime.utc();

    let targetStartUtc, targetEndUtc;
    if (daysOffset > 0) {
        targetStartUtc = nowUtc.plus({ days: daysOffset }).setZone(BR_TZ).startOf('day').toUTC();
        targetEndUtc = nowUtc.plus({ days: daysOffset }).setZone(BR_TZ).endOf('day').toUTC();
    } else if (type === 'APPOINTMENT_3_MINS_BEFORE') {
        targetStartUtc = nowUtc.plus({ minutes: 3 });
        targetEndUtc = nowUtc.plus({ minutes: 4 });
    } else {
        console.warn(`[SCHEDULER WORKER ${taskName}] Tipo de lembrete não suportado para offset 0: ${type}`);
        return;
    }

    const targetStartDate = targetStartUtc.toJSDate();
    const targetEndDate = targetEndUtc.toJSDate();

    console.log(`[SCHEDULER WORKER ${taskName}] Buscando agendamentos (${type}) entre ${targetStartDate.toISOString()} e ${targetEndDate.toISOString()}`);

    const activeSettings = await MessageSetting.find({ type: type, isActive: true })
        .select('clinic template')
        .populate({ path: "template", select: "content" })
        .populate({ path: "clinic", select: "name owner", populate: { path: "owner", select: "name" }})
        .lean();

    if (!activeSettings || activeSettings.length === 0) {
        console.log(`[SCHEDULER WORKER ${taskName}] Nenhuma configuração ativa encontrada para ${type}.`);
        return;
    }
    console.log(`[SCHEDULER WORKER ${taskName}] ${activeSettings.length} configurações ativas para ${type}.`);

    const settingProcessingPromises = activeSettings.map(async (setting) => {
        if (!setting.template?.content || !setting.clinic?._id || !setting.clinic.owner?.name) {
             console.warn(`[SCHEDULER WORKER ${taskName}] Configuração inválida ou incompleta ignorada para clínica ${setting.clinic?._id}`);
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
        .select('patient startTime')
        .populate({ path: "patient", select: "name phone" })
        .lean();

        if (!appointments || appointments.length === 0) {
            return;
        }
        console.log(`[SCHEDULER WORKER ${taskName}] ${appointments.length} agendamentos encontrados para ${clinicName} (${type}).`);

        const sendTasks = appointments.map(appointment => {
          if (!appointment.patient?._id || !appointment.patient.phone) {
              console.warn(`[SCHEDULER WORKER ${taskName}] Agendamento ${appointment._id} ignorado por falta de dados do paciente.`);
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

          return limit(() => trySendMessageAndLog({
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
    console.log(`[SCHEDULER WORKER ${taskName}] Processamento de lembretes (${type}) concluído.`);
};

// **Recebe taskName como argumento**
const checkAndSendBirthdayWishes = async (taskName) => {
    if (!pLimit) {
         console.warn(`[SCHEDULER WORKER ${taskName}] pLimit não inicializado, abortando aniversários.`);
         return;
    }
    const limit = pLimit(10);
    const type = "PATIENT_BIRTHDAY";

    console.log(`[SCHEDULER WORKER ${taskName}] Buscando configurações ativas para ${type}.`);

    const activeSettings = await MessageSetting.find({ type: type, isActive: true })
        .select('clinic template')
        .populate("template", "content")
        .populate({ path: "clinic", select: "name owner", populate: { path: "owner", select: "name" }})
        .lean();

    if (!activeSettings || activeSettings.length === 0) {
        console.log(`[SCHEDULER WORKER ${taskName}] Nenhuma configuração ativa encontrada para ${type}.`);
        return;
    }
     console.log(`[SCHEDULER WORKER ${taskName}] ${activeSettings.length} configurações ativas para ${type}.`);

    const today = new Date();
    const todayLocal = new Date(today.toLocaleString('en-US', { timeZone: BR_TZ }));
    const todayDay = todayLocal.getDate();
    const todayMonth = todayLocal.getMonth() + 1;
    const startOfDayLocal = new Date(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate());
    const startOfDayUTC = new Date(Date.UTC(startOfDayLocal.getFullYear(), startOfDayLocal.getMonth(), startOfDayLocal.getDate()));

    console.log(`[SCHEDULER WORKER ${taskName}] Verificando aniversariantes para ${todayDay}/${todayMonth}.`);

    const settingProcessingPromises = activeSettings.map(async (setting) => {
        if (!setting.template?.content || !setting.clinic?._id || !setting.clinic.owner?.name) {
             console.warn(`[SCHEDULER WORKER ${taskName}] Configuração de aniversário inválida ignorada para clínica ${setting.clinic?._id}`);
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
        console.log(`[SCHEDULER WORKER ${taskName}] ${birthdayPatients.length} aniversariantes encontrados para ${clinicName}.`);

        const sendTasks = birthdayPatients.map(async (patientData) => {
            if (!patientData.phone) {
                 console.warn(`[SCHEDULER WORKER ${taskName}] Paciente ${patientData._id} ignorado por falta de telefone.`);
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

            return limit(() => trySendMessageAndLog({
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
    console.log(`[SCHEDULER WORKER ${taskName}] Processamento de aniversários concluído.`);
};

// --- Função Principal de Execução da Tarefa ---
const runTask = async (taskName, mongoUri, ...args) => {
    // 1. Conecta ao DB, passando taskName para logs de conexão
    await connectDB(mongoUri, taskName);

    // 2. Espera pLimit carregar
    await new Promise(resolve => {
        const checkInterval = setInterval(() => {
            if (pLimit) {
                clearInterval(checkInterval);
                resolve();
            } else {
                console.warn(`[SCHEDULER WORKER ${taskName}] Aguardando p-limit carregar...`);
            }
        }, 100);
    });

    try {
        console.log(`[SCHEDULER WORKER ${taskName}] Iniciando execução da tarefa.`);
        switch (taskName) {
            case 'APPOINTMENT_3_MINS_BEFORE':
                // Passa taskName para a função
                await checkAndSendAppointmentReminders(taskName, taskName, 0);
                break;
            case 'APPOINTMENT_2_DAYS_BEFORE':
                 // Passa taskName para a função
                await checkAndSendAppointmentReminders(taskName, taskName, 2);
                break;
            case 'APPOINTMENT_1_DAY_BEFORE':
                 // Passa taskName para a função
                await checkAndSendAppointmentReminders(taskName, taskName, 1);
                break;
            case 'PATIENT_BIRTHDAY':
                 // Passa taskName para a função
                await checkAndSendBirthdayWishes(taskName);
                break;
            default:
                 console.warn(`[SCHEDULER WORKER ${taskName}] Tarefa desconhecida recebida.`);
                 sendDiscordNotificationInternal(16776960, `⚠️ Tarefa Desconhecida (${taskName})`, [{ name: 'Detalhe', value: 'Nome da tarefa não reconhecido no switch/case.' }], 'Worker'); // Amarelo
                break;
        }
        console.log(`[SCHEDULER WORKER ${taskName}] Tarefa concluída com sucesso.`);
        parentPort.postMessage({ status: 'success', taskName });
    } catch (error) {
        console.error(`[SCHEDULER WORKER ${taskName}] Erro durante a execução da tarefa:`, error.stack || error.message);
        captureException(error, { tags: { severity: 'worker_task_failure', task: taskName, context: 'runTaskWorker' } });
        parentPort.postMessage({ status: 'error', taskName, error: error.message });
        sendDiscordNotificationInternal(15158332, `❌ ERRO no Worker (${taskName})`, [{ name: 'Erro', value: (error.message || 'Erro desconhecido').substring(0,1020) }], 'Worker');
    } finally {
        // Mantenha comentado por enquanto
        // await mongoose.disconnect();
        // console.log(`[SCHEDULER WORKER ${taskName}] MongoDB Desconectado.`);
    }
};

// --- Ponto de Entrada do Worker ---
if (workerData?.taskName && workerData?.mongoUri) {
    const taskNameForInit = workerData.taskName; // Usa uma variável local aqui
    console.log(`[SCHEDULER WORKER ${taskNameForInit}] Iniciado com sucesso.`);
    // Passa os dados recebidos para runTask
    runTask(workerData.taskName, workerData.mongoUri, ...(workerData.args || []));
} else {
    const errorMsg = 'Worker thread iniciado sem taskName ou mongoUri essenciais em workerData.';
    console.error(`[SCHEDULER WORKER] ${errorMsg}`, workerData);
    if (parentPort) {
      parentPort.postMessage({ status: 'error', taskName: workerData?.taskName || 'Desconhecida', error: errorMsg });
    }
    process.exit(1);
}