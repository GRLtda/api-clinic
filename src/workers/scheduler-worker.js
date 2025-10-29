// src/workers/scheduler-worker.js
const { parentPort, workerData } = require('worker_threads');
const mongoose = require('mongoose');

// --- VARIÁVEL GLOBAL PARA taskName ---
// Definida aqui para garantir acesso em todos os escopos do worker
const taskName = workerData?.taskName || 'UNKNOWN_TASK';

// --- CONEXÃO COM O MONGODB DENTRO DO WORKER ---
let dbConnected = false;
const connectDB = async (uri) => {
    if (dbConnected) return;
    try {
        await mongoose.connect(uri, {
            autoIndex: false,
            maxPoolSize: 5,
            serverSelectionTimeoutMS: 15000, // Aumentado um pouco
            socketTimeoutMS: 45000,      // Aumentado um pouco
        });
        dbConnected = true;
        console.log(`[SCHEDULER WORKER ${taskName}] MongoDB Conectado.`);
    } catch (err) {
        console.error(`[SCHEDULER WORKER ${taskName}] Erro ao conectar MongoDB:`, err.message);
        if (parentPort) {
            parentPort.postMessage({ status: 'error', taskName: taskName, error: `DB Connection Failed: ${err.message}` });
        }
        process.exit(1);
    }
};
// --- FIM DA CONEXÃO ---

// --- ORDEM CORRIGIDA DOS REQUIRES ---
// Modelos que são referenciados por outros devem vir primeiro
const Patient = require('../api/patients/patients.model');
const Clinic = require('../api/clinics/clinics.model'); // Necessário para populate
const User = require('../api/users/users.model');       // Necessário para populate
const MessageTemplate = require('../api/crm/modelos/message-template.model'); // <-- **REGISTRA MessageTemplate PRIMEIRO**

// Agora os modelos que usam 'ref' para os anteriores
const MessageSetting = require('../api/crm/message-settings.model');
const Appointment = require('../api/appointments/appointments.model');
const { MessageLog, LOG_STATUS, ACTION_TYPES } = require('../api/crm/logs/message-log.model');
// --- FIM DA ORDEM CORRIGIDA ---

// Outras dependências
const whatsappServiceClient = require('../services/whatsappServiceClient');
const { createLogEntry } = require('../api/crm/logs/message-log.controller'); // Assumindo que esta função não depende diretamente de um modelo não registrado
const { captureException } = require('../utils/sentry');
const { DateTime } = require('luxon');
const axios = require('axios');
const { sendToDiscord } = require('../utils/discordLogger'); // Importa o logger do Discord

let pLimit;
(async () => {
    try {
        const module = await import('p-limit');
        pLimit = module.default;
    } catch (err) {
        captureException(err, { tags: { severity: 'critical', context: 'p-limit-worker-load', workerTask: taskName } }); // Adiciona taskName
        console.error(`[SCHEDULER WORKER ${taskName}] Falha crítica ao carregar p-limit. Encerrando.`);
        if (parentPort) {
            parentPort.postMessage({ status: 'error', taskName: taskName, error: 'Failed to load p-limit' });
        }
        process.exit(1);
    }
})().catch(err => {
     captureException(err, { tags: { severity: 'critical', context: 'p-limit-iife-catch', workerTask: taskName } }); // Adiciona taskName
     console.error(`[SCHEDULER WORKER ${taskName}] Falha crítica no setup inicial (p-limit IIFE). Encerrando.`);
     if (parentPort) {
         parentPort.postMessage({ status: 'error', taskName: taskName, error: 'Critical setup failure (p-limit)' });
     }
     process.exit(1);
});

const BR_TZ = 'America/Sao_Paulo';

// Funções utilitárias (fillTemplate, formatDate, formatTime) - sem alterações
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

const DISCORD_WEBHOOK_URL = workerData.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1432810373244915732/OapA83WGKuWf1rlxbtQGFPkwD_H4K9mIxtO8BaIKrO1ZVyT5u5UNyKLVi_U0u0Ce41D1'; // Tenta pegar do env também

// Usa a função sendToDiscord importada diretamente
// Removida sendDiscordNotificationInternal para evitar duplicação

// Função trySendMessageAndLog (usa a variável taskName global)
const trySendMessageAndLog = async ({
    clinicId,
    patientId,
    recipientPhone,
    finalMessage,
    settingType,
    templateId,
    clinicName,
}) => {
    // taskName é acessível globalmente neste escopo
    if (!clinicId || !patientId || !recipientPhone || !finalMessage || !settingType) {
        console.warn(`[SCHEDULER WORKER ${taskName}] Dados insuficientes para enviar mensagem/log.`);
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

        // Log antes de chamar o serviço externo
        console.log(`[SCHEDULER WORKER ${taskName}] Tentando enviar ${settingType} para ${formattedPhone} (Clínica: ${clinicName || clinicId})`);

        const response = await whatsappServiceClient.sendMessage(clinicId, formattedPhone, finalMessage);

        await MessageLog.findByIdAndUpdate(logEntry._id, {
            status: LOG_STATUS.DELIVERED, // Assumindo sucesso na entrega baseado na resposta do serviço
            wwebjsMessageId: response.data?.result?.id?.id || null,
        });

        // Notificação Discord de sucesso
        sendToDiscord(
            `Mensagem automática (${settingType}) enviada com sucesso para ${formattedPhone}`,
            'success',
            taskName,
            `Clínica: ${clinicName || clinicId} | Log ID: ${logEntry._id}` // Adiciona detalhes no footer
        );
        console.log(`[SCHEDULER WORKER ${taskName}] Sucesso ao enviar ${settingType} para ${formattedPhone}. Log ID: ${logEntry._id}`);


    } catch (error) {
        const errorMessage = error.response?.data?.message || error.message || 'Erro desconhecido ao contatar serviço WhatsApp.';
        const logIdForError = logEntry?._id?.toString() || 'N/A';

        // Log detalhado no console do worker
        console.error(`[SCHEDULER WORKER ${taskName}] Falha ao enviar ${settingType} para ${formattedPhone}. Erro: ${errorMessage}. Log ID: ${logIdForError}`);

        // Captura no Sentry
        captureException(error, {
            tags: { severity: 'whatsapp_automatic_failure', clinic_id: clinicId.toString(), setting_type: settingType, context: 'workerServiceSend', workerTask: taskName },
            extra: { patient_id: patientId.toString(), phone: recipientPhone, log_id: logIdForError, error_details: error.response?.data || errorMessage }
        });

        // Atualiza o log no DB com erro
        if (logEntry) {
            await MessageLog.findByIdAndUpdate(logEntry._id, {
                status: LOG_STATUS.ERROR_SYSTEM,
                errorMessage: `Erro via serviço (Worker ${taskName}): ${errorMessage.substring(0, 1000)}`, // Limita tamanho da msg de erro
            }).catch(logUpdateError => {
                captureException(logUpdateError, { tags: { severity: 'worker_log_update_failure', workerTask: taskName } });
                console.error(`[SCHEDULER WORKER ${taskName}] Falha ao atualizar log de erro ${logIdForError}:`, logUpdateError.message);
            });
        }

        // Notificação Discord de erro
        sendToDiscord(
            `Falha ao enviar mensagem automática (${settingType}) para ${formattedPhone}\n**Erro:** ${errorMessage.substring(0, 1000)}`, // Limita erro
            'error',
            taskName,
            `Clínica: ${clinicName || clinicId} | Log ID: ${logIdForError}`
        );
    }
};

// Função checkAndSendAppointmentReminders (usa taskName global)
const checkAndSendAppointmentReminders = async (type, daysOffset) => {
    // taskName é acessível globalmente
    if (!pLimit) {
         console.warn(`[SCHEDULER WORKER ${taskName}] pLimit não inicializado, abortando lembretes.`);
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
        targetStartUtc = nowUtc.plus({ minutes: 3 });
        targetEndUtc = nowUtc.plus({ minutes: 4 });
    } else {
        console.warn(`[SCHEDULER WORKER ${taskName}] Tipo de lembrete não suportado para offset 0: ${type}`);
        sendToDiscord(`Tipo de lembrete não suportado p/ offset 0: ${type}`, 'warn', taskName);
        return;
    }

    const targetStartDate = targetStartUtc.toJSDate();
    const targetEndDate = targetEndUtc.toJSDate();

    console.log(`[SCHEDULER WORKER ${taskName}] Buscando agendamentos (${type}) entre ${targetStartDate.toISOString()} e ${targetEndDate.toISOString()}`);

    // **A ORDEM CORRETA DOS REQUIRES DEVE RESOLVER O ERRO DE SCHEMA**
    const activeSettings = await MessageSetting.find({ type: type, isActive: true })
        .select('clinic template')
        // **POPULATE DEVE FUNCIONAR AGORA**
        .populate({ path: "template", select: "content" })
        .populate({ path: "clinic", select: "name owner", populate: { path: "owner", select: "name" }})
        .lean();

    if (!activeSettings || activeSettings.length === 0) {
        console.log(`[SCHEDULER WORKER ${taskName}] Nenhuma configuração ativa encontrada para ${type}.`);
        return;
    }
    console.log(`[SCHEDULER WORKER ${taskName}] ${activeSettings.length} configurações ativas para ${type}.`);

    const settingProcessingPromises = activeSettings.map(async (setting) => {
        // Verifica se o populate funcionou e se os dados essenciais existem
        if (!setting.template?.content || !setting.clinic?._id || !setting.clinic.owner?.name) {
             console.warn(`[SCHEDULER WORKER ${taskName}] Configuração inválida ou incompleta ignorada para clínica ${setting.clinic?._id}. Template: ${setting.template?._id}, Owner: ${setting.clinic?.owner?._id}`);
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
        .select('patient startTime _id') // Seleciona _id do agendamento para logs
        .populate({ path: "patient", select: "name phone _id" }) // Seleciona _id do paciente
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

          // Chama trySendMessageAndLog (que agora usa taskName global)
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

// Função checkAndSendBirthdayWishes (usa taskName global)
const checkAndSendBirthdayWishes = async () => {
    // taskName é acessível globalmente
    if (!pLimit) {
         console.warn(`[SCHEDULER WORKER ${taskName}] pLimit não inicializado, abortando aniversários.`);
         sendToDiscord(`pLimit não inicializado, abortando ${taskName}`, 'warn', taskName);
         return;
    }
    const limit = pLimit(10);
    const type = "PATIENT_BIRTHDAY";

    console.log(`[SCHEDULER WORKER ${taskName}] Buscando configurações ativas para ${type}.`);

    const activeSettings = await MessageSetting.find({ type: type, isActive: true })
        .select('clinic template')
        .populate("template", "content") // **POPULATE DEVE FUNCIONAR AGORA**
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
             console.warn(`[SCHEDULER WORKER ${taskName}] Configuração de aniversário inválida ignorada para clínica ${setting.clinic?._id}. Template: ${setting.template?._id}, Owner: ${setting.clinic?.owner?._id}`);
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
        console.log(`[SCHEDULER WORKER ${taskName}] ${birthdayPatients.length} aniversariantes encontrados para ${clinicName}.`);

        const sendTasks = birthdayPatients.map(async (patientData) => {
            if (!patientData.phone) {
                 console.warn(`[SCHEDULER WORKER ${taskName}] Paciente ${patientData._id} (Aniversariante) ignorado por falta de telefone.`);
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

            // Chama trySendMessageAndLog (que agora usa taskName global)
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
const runTask = async (receivedTaskName, mongoUri, ...args) => {
    // Usa a taskName global definida no início do script para consistência
    // const taskName = workerData?.taskName || 'UNKNOWN_TASK'; // Já definida globalmente

    // 1. Conecta ao DB
    await connectDB(mongoUri, taskName); // Passa taskName para logs de conexão

    // 2. Espera pLimit carregar
    await new Promise((resolve, reject) => {
        let checks = 0;
        const maxChecks = 100; // ~10 segundos
        const checkInterval = setInterval(() => {
            if (pLimit) {
                clearInterval(checkInterval);
                resolve();
            } else {
                checks++;
                 console.warn(`[SCHEDULER WORKER ${taskName}] Aguardando p-limit carregar... (${checks}/${maxChecks})`);
                 if(checks >= maxChecks) {
                    clearInterval(checkInterval);
                    reject(new Error('Timeout esperando p-limit carregar.'));
                 }
            }
        }, 100);
    }).catch(err => {
        // Captura o erro do timeout do p-limit
        console.error(`[SCHEDULER WORKER ${taskName}] Erro fatal: ${err.message}`);
        captureException(err, { tags: { severity: 'critical', context: 'p-limit-load-timeout', workerTask: taskName } });
        if (parentPort) {
            parentPort.postMessage({ status: 'error', taskName, error: err.message });
        }
        process.exit(1); // Encerra se p-limit não carregar
    });


    try {
        console.log(`[SCHEDULER WORKER ${taskName}] Iniciando execução da tarefa.`);
        switch (taskName) { // Usa a taskName global
            case 'APPOINTMENT_3_MINS_BEFORE':
                await checkAndSendAppointmentReminders(taskName, 0); // Passa type e offset
                break;
            case 'APPOINTMENT_2_DAYS_BEFORE':
                await checkAndSendAppointmentReminders(taskName, 2); // Passa type e offset
                break;
            case 'APPOINTMENT_1_DAY_BEFORE':
                await checkAndSendAppointmentReminders(taskName, 1); // Passa type e offset
                break;
            case 'PATIENT_BIRTHDAY':
                await checkAndSendBirthdayWishes(); // Não precisa de type/offset extras
                break;
            default:
                 console.warn(`[SCHEDULER WORKER ${taskName}] Tarefa desconhecida recebida: ${taskName}`);
                 sendToDiscord(`Tarefa desconhecida recebida: ${taskName}`, 'warn', taskName);
                break;
        }
        console.log(`[SCHEDULER WORKER ${taskName}] Tarefa concluída com sucesso.`);
        if(parentPort) parentPort.postMessage({ status: 'success', taskName });
    } catch (error) {
        console.error(`[SCHEDULER WORKER ${taskName}] Erro durante a execução da tarefa:`, error.stack || error.message);
        captureException(error, { tags: { severity: 'worker_task_failure', task: taskName, context: 'runTaskWorker' } });
        if(parentPort) parentPort.postMessage({ status: 'error', taskName, error: error.message });
        sendToDiscord(`Erro durante a execução: ${error.message.substring(0, 1000)}`, 'error', taskName);
    } finally {
        // Manter desconexão comentada por enquanto
        // await mongoose.disconnect();
        // console.log(`[SCHEDULER WORKER ${taskName}] MongoDB Desconectado.`);
    }
};

// --- Ponto de Entrada do Worker ---
if (taskName !== 'UNKNOWN_TASK' && workerData?.mongoUri) {
    console.log(`[SCHEDULER WORKER ${taskName}] Iniciado com sucesso.`);
    // Passa os dados recebidos para runTask
    runTask(taskName, workerData.mongoUri, ...(workerData.args || []));
} else {
    const errorMsg = 'Worker thread iniciado sem taskName ou mongoUri essenciais em workerData.';
    console.error(`[SCHEDULER WORKER] ${errorMsg}`, workerData);
    if (parentPort) {
      parentPort.postMessage({ status: 'error', taskName: taskName, error: errorMsg });
    }
    process.exit(1);
}