// src/workers/scheduler-worker.js
const { parentPort, workerData } = require('worker_threads');
const { DateTime } = require('luxon');
const mongoose = require('mongoose'); // Importar mongoose se precisar conectar DB aqui
const path = require('path');
const axios = require('axios'); // Para Discord

// Importações dos Módulos da API (ajuste os caminhos se necessário)
const MessageSetting = require('../api/crm/message-settings.model');
const Appointment = require('../api/appointments/appointments.model');
const Patient = require('../api/patients/patients.model');
const whatsappServiceClient = require('../services/whatsappServiceClient');
const { createLogEntry } = require('../api/crm/logs/message-log.controller');
const { MessageLog, LOG_STATUS, ACTION_TYPES } = require('../api/crm/logs/message-log.model');
const { captureException } = require('../utils/sentry');
// const connectDB = require('../config/database'); // Descomente se precisar conectar o DB aqui

let pLimit;
(async () => {
    // Carrega o p-limit dinamicamente (ES Module)
    try {
        const module = await import('p-limit');
        pLimit = module.default;
        console.log('[SCHEDULER WORKER] p-limit carregado com sucesso.');
    } catch (err) {
        console.error('[SCHEDULER WORKER] Erro ao carregar p-limit:', err);
        captureException(err, { tags: { severity: 'critical', context: 'p-limit-worker-load' } });
        process.exit(1); // Encerra o worker se não conseguir carregar a dependência essencial
    }
})();

// --- Constantes ---
const BR_TZ = 'America/Sao_Paulo'; // Fuso horário do Brasil (São Paulo)
// Janela de tolerância em minutos. 2 significa +/- 2 minutos em torno do alvo.
// Para o alvo de 3 minutos, buscará entre 1 e 5 minutos.
const WINDOW_MINUTES = 2;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL; // Carrega do .env

// --- Funções Utilitárias ---

// Preenche variáveis no template (igual à anterior)
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

// Formata data (igual à anterior)
const formatDate = (date) => {
  if (!date) return "";
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return "";
  // Usa Luxon para garantir a formatação correta no fuso horário
  return DateTime.fromJSDate(dateObj).setZone(BR_TZ).toFormat('dd/LL/yyyy');
};

// Formata hora (igual à anterior)
const formatTime = (date) => {
  if (!date) return "";
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return "";
  // Usa Luxon para garantir a formatação correta no fuso horário
  return DateTime.fromJSDate(dateObj).setZone(BR_TZ).toFormat('HH:mm');
};

// Envia notificação para o Discord (igual à anterior)
const sendDiscordNotification = (color, title, fields, footer) => {
    if (!DISCORD_WEBHOOK_URL) return;

    const payload = {
        username: 'CRM Scheduler Bot',
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
            console.error('[SCHEDULER WORKER] Erro ao enviar notificação Discord:', err.message);
            // Captura no Sentry, mas não impede a execução
            captureException(err, { tags: { severity: 'warning', context: 'sendDiscordNotification' } });
        });
};

// Tenta enviar mensagem via serviço WhatsApp e registra o log (igual à anterior)
const trySendMessageAndLog = async ({
    clinicId,
    patientId,
    recipientPhone,
    finalMessage,
    settingType,
    templateId,
    clinicName, // Nome da clínica para notificação
}) => {
    // Validação de entrada
    if (!clinicId || !patientId || !recipientPhone || !finalMessage || !settingType) {
        console.error('[SCHEDULER WORKER] Dados insuficientes para enviar mensagem/log.', { clinicId, patientId, recipientPhone: '***', settingType });
        return; // Não prossegue se faltar dados essenciais
    }

    const formattedPhone = recipientPhone.replace(/\D/g, '');
    if (!formattedPhone) {
        console.error(`[SCHEDULER WORKER] Número de telefone inválido após formatação para paciente ${patientId}`);
        return;
    }

    let logEntry = null;
    let notificationTitle = `Tarefa Automática (${settingType})`;
    let notificationColor = 3447003; // Azul (Info) por padrão
    let notificationFields = [
        { name: 'Clínica', value: clinicName || clinicId.toString(), inline: true },
        { name: 'Tipo', value: settingType, inline: true },
        { name: 'Telefone', value: formattedPhone, inline: true },
    ];
    let statusLog = LOG_STATUS.SENT_ATTEMPT; // Status inicial assumido

    try {
        // 1. Cria log de tentativa
        logEntry = await createLogEntry({
            clinic: clinicId,
            patient: patientId,
            template: templateId || null, // templateId pode ser null para lógicas futuras
            settingType: settingType,
            messageContent: finalMessage,
            recipientPhone: formattedPhone,
            status: LOG_STATUS.SENT_ATTEMPT, // Marca como tentativa inicial
            actionType: settingType === "PATIENT_BIRTHDAY"
                ? ACTION_TYPES.AUTOMATIC_BIRTHDAY
                : ACTION_TYPES.AUTOMATIC_REMINDER, // Assume lembrete para outros tipos
        });

        // Verifica se o log foi criado com sucesso
        if (!logEntry?._id) {
             throw new Error("Falha ao criar entrada de log inicial no banco de dados.");
        }

        notificationFields.push({ name: 'Log ID', value: logEntry._id.toString(), inline: false });

        // 2. Chama o serviço WhatsApp para enviar a mensagem
        const response = await whatsappServiceClient.sendMessage(clinicId.toString(), formattedPhone, finalMessage);

        // 3. Atualiza o log com sucesso (ou status retornado pelo serviço)
        statusLog = LOG_STATUS.DELIVERED; // Assume entregue se não houver erro
        const messageId = response.data?.result?.id?.id || null; // Pega ID da mensagem se disponível

        await MessageLog.findByIdAndUpdate(logEntry._id, {
            status: statusLog,
            wwebjsMessageId: messageId,
        });

        // Prepara notificação de sucesso
        notificationTitle = `✅ Sucesso: Mensagem Automática Enviada (${settingType})`;
        notificationColor = 3066993; // Verde

    } catch (error) {
        // 4. Lida com erros e atualiza o log
        statusLog = LOG_STATUS.ERROR_SYSTEM; // Assume erro do sistema por padrão
        const errorMessage = error.response?.data?.message || error.message || 'Erro desconhecido ao contatar serviço WhatsApp.';

        // Captura a exceção no Sentry para análise
        captureException(error, {
            tags: { severity: 'error', context: 'workerServiceSend', clinic_id: clinicId.toString(), setting_type: settingType },
            extra: { patient_id: patientId.toString(), phone: formattedPhone, log_id: logEntry?._id?.toString() || 'N/A', error_details: error.response?.data || errorMessage }
        });

        // Tenta atualizar o log com o erro, mesmo que o envio tenha falhado
        if (logEntry?._id) {
            try {
                await MessageLog.findByIdAndUpdate(logEntry._id, {
                    status: statusLog,
                    errorMessage: `Erro via serviço (Worker): ${errorMessage.substring(0, 500)}`, // Limita tamanho da msg de erro
                });
            } catch (logUpdateError) {
                console.error(`[SCHEDULER WORKER] Falha ao atualizar log de erro ${logEntry._id}:`, logUpdateError.message);
                captureException(logUpdateError, { tags: { severity: 'warning', context: 'worker_log_update_failure' } });
            }
        } else {
            // Se nem o log inicial foi criado, registra no Sentry
             captureException(new Error(`Falha crítica: Não foi possível criar log inicial para ${settingType}`), {
                tags: { severity: 'critical', context: 'workerLogCreationFailure', clinic_id: clinicId.toString(), setting_type: settingType },
                extra: { patient_id: patientId.toString(), phone: formattedPhone, error_details: errorMessage }
             });
        }

        // Prepara notificação de erro
        notificationTitle = `❌ ERRO: Falha no Envio Automático (${settingType})`;
        notificationColor = 15158332; // Vermelho
        notificationFields.push({ name: 'Erro', value: errorMessage.substring(0, 1024), inline: false }); // Limita tamanho da msg de erro

    } finally {
        // Envia notificação para o Discord (sucesso ou erro)
        sendDiscordNotification(notificationColor, notificationTitle, notificationFields, `Status Final: ${statusLog}`);
    }
};

// --- Funções de Verificação e Envio ---

// Verifica e envia lembretes de agendamento (Refatorada)
const checkAndSendAppointmentReminders = async (type) => {
    if (!pLimit) {
        console.error('[SCHEDULER WORKER] p-limit não está carregado. Abortando tarefa.');
        sendDiscordNotification(15158332, `ERRO CRÍTICO (${type})`, [{ name: 'Detalhe', value: 'p-limit não carregado no worker.' }]);
        return;
    }
    const limit = pLimit(5); // Limita a 5 chamadas concorrentes ao serviço WhatsApp
    const nowUtc = DateTime.utc(); // Horário atual em UTC

    let targetStartUtc, targetEndUtc;
    let daysOffset = 0;
    const minutesOffset = 3; // Alvo central para APPOINTMENT_3_MINS_BEFORE

    // Define o intervalo de tempo UTC para buscar agendamentos
    try {
        switch (type) {
            case 'APPOINTMENT_3_MINS_BEFORE':
                const targetTimeUtc = nowUtc.plus({ minutes: minutesOffset });
                targetStartUtc = targetTimeUtc.minus({ minutes: WINDOW_MINUTES });
                targetEndUtc = targetTimeUtc.plus({ minutes: WINDOW_MINUTES });
                break;
            case 'APPOINTMENT_1_DAY_BEFORE':
                daysOffset = 1;
                targetStartUtc = nowUtc.setZone(BR_TZ).plus({ days: daysOffset }).startOf('day').toUTC();
                targetEndUtc = nowUtc.setZone(BR_TZ).plus({ days: daysOffset }).endOf('day').toUTC();
                break;
            case 'APPOINTMENT_2_DAYS_BEFORE':
                daysOffset = 2;
                targetStartUtc = nowUtc.setZone(BR_TZ).plus({ days: daysOffset }).startOf('day').toUTC();
                targetEndUtc = nowUtc.setZone(BR_TZ).plus({ days: daysOffset }).endOf('day').toUTC();
                break;
            default:
                console.error(`[SCHEDULER WORKER] Tipo de lembrete desconhecido recebido: ${type}`);
                return; // Sai se o tipo não for reconhecido
        }
    } catch (err) {
         console.error(`[SCHEDULER WORKER - ${type}] Erro ao calcular datas:`, err.message);
         captureException(err, { tags: { severity: 'error', context: 'workerDateCalculation', type: type }});
         return;
    }


    const targetStartDate = targetStartUtc.toJSDate();
    const targetEndDate = targetEndUtc.toJSDate();

    console.log(`[SCHEDULER WORKER - ${type}] Buscando agendamentos entre ${targetStartUtc.toISO()} e ${targetEndUtc.toISO()} UTC`);

    try {
        // Busca configurações ativas para este tipo
        const activeSettings = await MessageSetting.find({ type: type, isActive: true })
            .select('clinic template') // Seleciona apenas campos necessários + populados
            .populate({ path: "template", select: "content" }) // Popula conteúdo do template
            .populate({ // Popula clínica e nome do dono (médico padrão)
                path: "clinic",
                select: "name owner",
                populate: { path: "owner", select: "name" }
            })
            .lean(); // Usa lean() para performance

        if (!activeSettings || activeSettings.length === 0) {
            // console.log(`[SCHEDULER WORKER - ${type}] Nenhuma configuração ativa encontrada.`);
            return; // Nada a fazer
        }

        console.log(`[SCHEDULER WORKER - ${type}] Encontradas ${activeSettings.length} configurações ativas.`);

        // Processa cada configuração em paralelo (dentro dos limites do p-limit para chamadas externas)
        const settingProcessingPromises = activeSettings.map(async (setting) => {
            // Validações essenciais da configuração
            if (!setting.template?.content || !setting.clinic?._id || !setting.clinic.name || !setting.clinic.owner?.name) {
                console.warn(`[SCHEDULER WORKER - ${type}] Configuração inválida/incompleta para clínica ${setting.clinic?._id || 'desconhecida'}. Pulando.`);
                captureException(new Error('Configuração de mensagem inválida/incompleta'), {
                   tags: { severity: 'warning', context: 'workerConfigValidation', clinic_id: setting.clinic?._id?.toString() || 'N/A', type: type }
                });
                return; // Pula esta configuração
            }

            const { _id: clinicId, name: clinicName, owner } = setting.clinic;
            const doctorName = owner.name; // Assume o dono como médico padrão
            const templateContent = setting.template.content;
            const templateId = setting.template._id;

            // Busca agendamentos relevantes DENTRO da janela de tempo definida
            const appointments = await Appointment.find({
                clinic: clinicId,
                startTime: { $gte: targetStartDate, $lte: targetEndDate }, // Filtra pela janela de tempo
                status: { $in: ["Agendado", "Confirmado"] }, // Apenas estes status
                sendReminder: true, // Se o lembrete está ativo no agendamento
                // Adicionar aqui a lógica para evitar reenvio se necessário
                // Ex: `[`remindersSent.${getReminderFlagName(type)}`]`: false
            })
            .select('patient startTime _id') // Seleciona campos necessários (+ _id para debug/marcar)
            .populate({ path: "patient", select: "name phone" }) // Dados do paciente
            .lean();

            if (!appointments || appointments.length === 0) {
                // console.log(`[SCHEDULER WORKER - ${type}] Nenhum agendamento encontrado para ${clinicName} (${clinicId}) neste intervalo.`);
                return; // Sem agendamentos para esta clínica/intervalo
            }

            console.log(`[SCHEDULER WORKER - ${type}] Encontrados ${appointments.length} agendamentos para ${clinicName} (${clinicId}).`);

            // Mapeia cada agendamento para uma promessa de envio (limitada por p-limit)
            const sendTasks = appointments.map(appointment => {
                if (!appointment.patient?._id || !appointment.patient.phone) {
                    console.warn(`[SCHEDULER WORKER - ${type}] Agendamento ${appointment._id} sem paciente/telefone. Pulando.`);
                    return Promise.resolve(); // Pula se dados do paciente estiverem faltando
                }

                // Monta a mensagem final
                const finalMessage = fillTemplate(templateContent, {
                    patientName: appointment.patient.name,
                    clinicName: clinicName,
                    doctorName: doctorName,
                    appointmentDate: formatDate(appointment.startTime),
                    appointmentTime: formatTime(appointment.startTime),
                    anamnesisLink: "" // Adicionar lógica se relevante
                });

                // Adiciona a tarefa de envio à fila do p-limit
                return limit(() => trySendMessageAndLog({
                    clinicId: clinicId,
                    patientId: appointment.patient._id,
                    recipientPhone: appointment.patient.phone,
                    finalMessage: finalMessage,
                    settingType: type, // O tipo de gatilho
                    templateId: templateId,
                    clinicName: clinicName, // Para notificação Discord
                }));
            });

            // Aguarda a conclusão de todos os envios para esta configuração
            await Promise.all(sendTasks);

            // TODO: Opcional - Marcar agendamentos como enviados
            // const successfulAppointmentIds = ... // Obtenha os IDs dos agendamentos enviados com sucesso
            // if (successfulAppointmentIds.length > 0) {
            //    await Appointment.updateMany(
            //        { _id: { $in: successfulAppointmentIds } },
            //        { $set: { [`remindersSent.${getReminderFlagName(type)}`]: true } }
            //    );
            // }

        }); // Fim do map de activeSettings

        // Aguarda o processamento de todas as configurações
        await Promise.all(settingProcessingPromises);
        console.log(`[SCHEDULER WORKER - ${type}] Processamento concluído.`);

    } catch (error) {
        console.error(`[SCHEDULER WORKER - ${type}] Erro geral durante a verificação:`, error.message);
        captureException(error, { tags: { severity: 'error', context: 'checkAndSendAppointmentRemindersMain', type: type } });
        // Informa o processo pai sobre o erro
        if (parentPort) {
            parentPort.postMessage({ status: 'error', taskName: type, error: error.message });
        }
    }
};

// Verifica e envia felicitações de aniversário (igual à anterior, mas com validações e logs)
const checkAndSendBirthdayWishes = async () => {
    if (!pLimit) {
        console.error('[SCHEDULER WORKER] p-limit não está carregado. Abortando tarefa de aniversário.');
         sendDiscordNotification(15158332, `ERRO CRÍTICO (PATIENT_BIRTHDAY)`, [{ name: 'Detalhe', value: 'p-limit não carregado no worker.' }]);
        return;
    }
    const limit = pLimit(10); // Limite diferente para aniversários, talvez?
    const type = "PATIENT_BIRTHDAY";

    const nowInBrazil = DateTime.now().setZone(BR_TZ);
    const todayDay = nowInBrazil.day;
    const todayMonth = nowInBrazil.month;
    const startOfDayUTC = nowInBrazil.startOf('day').toUTC().toJSDate(); // Para verificar se já enviou hoje

     console.log(`[SCHEDULER WORKER - ${type}] Verificando aniversariantes para ${nowInBrazil.toFormat('dd/LL')}`);

    try {
        const activeSettings = await MessageSetting.find({ type: type, isActive: true })
            .select('clinic template')
            .populate("template", "content")
            .populate({ path: "clinic", select: "name owner", populate: { path: "owner", select: "name" }})
            .lean();

        if (!activeSettings || activeSettings.length === 0) {
            // console.log(`[SCHEDULER WORKER - ${type}] Nenhuma configuração ativa encontrada.`);
            return;
        }

        console.log(`[SCHEDULER WORKER - ${type}] Encontradas ${activeSettings.length} configurações ativas.`);

        const settingProcessingPromises = activeSettings.map(async (setting) => {
             if (!setting.template?.content || !setting.clinic?._id || !setting.clinic.name || !setting.clinic.owner?.name) {
                console.warn(`[SCHEDULER WORKER - ${type}] Configuração inválida/incompleta para clínica ${setting.clinic?._id || 'desconhecida'}. Pulando.`);
                 captureException(new Error('Configuração de aniversário inválida/incompleta'), {
                   tags: { severity: 'warning', context: 'workerBirthdayConfigValidation', clinic_id: setting.clinic?._id?.toString() || 'N/A', type: type }
                });
                return;
            }

            const clinicId = setting.clinic._id;
            const clinicName = setting.clinic.name;
            const doctorName = setting.clinic.owner.name;
            const templateContent = setting.template.content;
            const templateId = setting.template._id;

            // Busca pacientes aniversariando HOJE no fuso BR_TZ
            // Usando $expr para comparar componentes da data com timezone
            const birthdayPatients = await Patient.find({
                clinicId: clinicId,
                $expr: {
                    $and: [
                        { $eq: [{ $dayOfMonth: { date: "$birthDate", timezone: BR_TZ } }, todayDay] },
                        { $eq: [{ $month: { date: "$birthDate", timezone: BR_TZ } }, todayMonth] },
                    ],
                },
                deletedAt: { $exists: false } // Ignora pacientes deletados
            }).select("_id name phone").lean();

            if (!birthdayPatients || birthdayPatients.length === 0) {
                // console.log(`[SCHEDULER WORKER - ${type}] Nenhum aniversariante encontrado para ${clinicName} (${clinicId}).`);
                return;
            }

             console.log(`[SCHEDULER WORKER - ${type}] Encontrados ${birthdayPatients.length} aniversariantes para ${clinicName} (${clinicId}).`);

            const sendTasks = birthdayPatients.map(async (patientData) => {
                if (!patientData.phone) {
                    console.warn(`[SCHEDULER WORKER - ${type}] Paciente ${patientData._id} sem telefone. Pulando.`);
                    return Promise.resolve();
                }

                // Verifica se já foi enviado HOJE para este paciente/tipo
                const alreadySentToday = await MessageLog.exists({
                    clinic: clinicId,
                    patient: patientData._id,
                    settingType: type,
                    actionType: ACTION_TYPES.AUTOMATIC_BIRTHDAY,
                    status: { $in: [LOG_STATUS.SENT_ATTEMPT, LOG_STATUS.DELIVERED, LOG_STATUS.READ] }, // Considera tentativa ou sucesso
                    createdAt: { $gte: startOfDayUTC } // Verifica logs criados desde o início do dia UTC
                });

                if (alreadySentToday) {
                    // console.log(`[SCHEDULER WORKER - ${type}] Mensagem já enviada hoje para paciente ${patientData._id}. Pulando.`);
                    return Promise.resolve(); // Já enviou hoje
                }

                const finalMessage = fillTemplate(templateContent, {
                    patientName: patientData.name,
                    clinicName: clinicName,
                    doctorName: doctorName,
                    // Outras variáveis não são geralmente usadas em mensagens de aniversário
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
        console.log(`[SCHEDULER WORKER - ${type}] Processamento concluído.`);

    } catch (error) {
        console.error(`[SCHEDULER WORKER - ${type}] Erro geral durante a verificação:`, error.message);
        captureException(error, { tags: { severity: 'error', context: 'checkAndSendBirthdayWishesMain', type: type } });
         if (parentPort) {
            parentPort.postMessage({ status: 'error', taskName: type, error: error.message });
        }
    }
};


// --- Função Principal do Worker ---
const runTask = async (taskName) => {
    // Espera p-limit carregar (import dinâmico no início)
    await new Promise(resolve => {
        const checkInterval = setInterval(() => {
            if (pLimit) {
                clearInterval(checkInterval);
                resolve();
            } else {
                 console.log('[SCHEDULER WORKER] Aguardando p-limit carregar...');
            }
        }, 200); // Verifica a cada 200ms
    });

    console.log(`[SCHEDULER WORKER] Executando tarefa: ${taskName}`);
    const startTime = Date.now();

    try {
        // Opcional: Conectar ao DB se necessário
        // await connectDB();
        // console.log('[SCHEDULER WORKER] Conectado ao MongoDB.');

        switch (taskName) {
            case 'APPOINTMENT_3_MINS_BEFORE': // Nome atualizado
                await checkAndSendAppointmentReminders(taskName);
                break;
            case 'APPOINTMENT_1_DAY_BEFORE':
                await checkAndSendAppointmentReminders(taskName);
                break;
            case 'APPOINTMENT_2_DAYS_BEFORE':
                await checkAndSendAppointmentReminders(taskName);
                break;
            case 'PATIENT_BIRTHDAY':
                await checkAndSendBirthdayWishes();
                break;
            default:
                console.warn(`[SCHEDULER WORKER] Tarefa desconhecida recebida: ${taskName}`);
                break;
        }
        const duration = Date.now() - startTime;
        console.log(`[SCHEDULER WORKER] Tarefa ${taskName} concluída em ${duration}ms.`);
        // Informa sucesso ao processo principal
        if (parentPort) {
           parentPort.postMessage({ status: 'success', taskName });
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[SCHEDULER WORKER] Erro crítico na execução da tarefa ${taskName} após ${duration}ms:`, error);
        captureException(error, { tags: { severity: 'critical', context: 'runTaskMain', task: taskName } });
        // Informa erro ao processo principal
         if (parentPort) {
            parentPort.postMessage({ status: 'error', taskName, error: error.message || 'Erro desconhecido no worker' });
         }
    } finally {
        // Opcional: Desconectar do DB se conectado aqui
        // await mongoose.disconnect();
        // console.log('[SCHEDULER WORKER] Desconectado do MongoDB.');
        // Não é necessário process.exit() aqui, o worker termina naturalmente
    }
};

// --- Ponto de Entrada do Worker ---
if (parentPort && workerData?.taskName) {
    runTask(workerData.taskName);
} else if (!parentPort) {
     console.error('[SCHEDULER WORKER] Erro: Executando fora de um ambiente de worker thread.');
     // process.exit(1); // Pode sair se não for um worker
} else {
    console.error('[SCHEDULER WORKER] Erro: taskName não fornecida em workerData.');
     parentPort.postMessage({ status: 'error', taskName: 'unknown', error: 'taskName não fornecida' });
     // process.exit(1); // Pode sair se não receber a tarefa
}