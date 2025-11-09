// src/api/anamnesis/anamnesis-notification.service.js
const MessageSetting = require("../crm/message-settings.model");
const Clinic = require("../clinics/clinics.model");
const Patient = require("../patients/patients.model");
const AnamnesisResponse = require("./anamnesis-response.model");
const whatsappServiceClient = require("../../services/whatsappServiceClient");

// --- CORREÇÃO DE IMPORTAÇÃO ---
const { createLogEntry } = require("../crm/logs/message-log.controller");
// Importar LOG_STATUS, ACTION_TYPES e MessageLog (necessário para o catch) do MODEL
const { MessageLog, LOG_STATUS, ACTION_TYPES } = require("../crm/logs/message-log.model");
// --- FIM DA CORREÇÃO ---

const { captureException } = require("../../utils/sentry");
const { sendToDiscord } = require("../../utils/discordLogger");

// Helper local para preencher o template (mantendo o padrão de outros serviços)
const fillTemplate = (templateContent, data) => {
  let content = templateContent || "";
  content = content.replace(/{ ?paciente ?}/g, data.patientName || "Paciente");
  content = content.replace(/{ ?clinica ?}/g, data.clinicName || "Clínica");
  content = content.replace(/{ ?nome_medico ?}/g, data.doctorName || "Dr(a).");
  // Variáveis de consulta não se aplicam aqui
  content = content.replace(/{ ?data_consulta ?}/g, "");
  content = content.replace(/{ ?hora_consulta ?}/g, "");
  // Variável principal
  content = content.replace(/{ ?link_anamnese ?}/g, data.anamnesisLink || "");
  return content.trim();
};

/**
 * Tenta enviar a notificação de anamnese para o paciente.
 * @param {import('mongoose').Document<AnamnesisResponse>} anamnesisResponseDoc - O documento da anamnese recém-criado.
 */
exports.sendAnamnesisNotification = async (anamnesisResponseDoc) => {
  const GATILHO = "ANAMNESIS_ASSIGNMENT";
  const { clinic, patient, template, patientAccessToken, _id: responseId } = anamnesisResponseDoc;

  if (!patientAccessToken) {
    sendToDiscord(`Tentativa de enviar notificação de anamnese (${responseId}) sem token.`, "warn", GATILHO);
    return;
  }

  let logEntry;
  const settingType = GATILHO;
  const taskName = GATILHO; // Usado para logs do Discord

  try {
    // 1. Buscar a configuração (template) que a clínica definiu para este gatilho
    const setting = await MessageSetting.findOne({
      clinic,
      type: settingType,
      isActive: true,
    })
      .populate("template", "content")
      .populate({
        path: "clinic",
        select: "name owner",
        populate: { path: "owner", select: "name" },
      })
      .lean();
    
    // Se não houver configuração ativa, não faz nada
    if (!setting || !setting.template?.content || !setting.clinic?.name) {
      sendToDiscord(`Clínica ${clinic} não possui template ativo para ${settingType}.`, "info", taskName);
      return;
    }

    // 2. Buscar dados do paciente
    const patientDoc = await Patient.findById(patient).select("name phone").lean();
    if (!patientDoc || !patientDoc.phone) {
      sendToDiscord(`Paciente ${patient} sem telefone, impossível notificar anamnese.`, "warn", taskName);
      return;
    }

    // 3. Montar dados
    const clinicName = setting.clinic.name;
    const doctorName = setting.clinic.owner?.name || clinicName;
    const templateContent = setting.template.content;
    const templateId = setting.template._id;
    // IMPORTANTE: Monta o link público
    const anamnesisLink = `https://crm-clinica-sigma.vercel.app/anamnese/${patientAccessToken}`;

    const finalMessage = fillTemplate(templateContent, {
      patientName: patientDoc.name,
      clinicName,
      doctorName,
      anamnesisLink,
    });

    const formattedPhone = patientDoc.phone.replace(/\D/g, "");

    // 4. Criar log de tentativa (Agora LOG_STATUS e ACTION_TYPES estão definidos)
    logEntry = await createLogEntry({
      clinic,
      patient,
      template: templateId,
      settingType,
      messageContent: finalMessage,
      recipientPhone: formattedPhone,
      status: LOG_STATUS.SENT_ATTEMPT,
      actionType: ACTION_TYPES.MANUAL_SEND, // É disparado por uma ação manual (atribuir)
    });

    // 5. Enviar via serviço
    const response = await whatsappServiceClient.sendMessage(
      clinic,
      formattedPhone,
      finalMessage
    );
    const wId = response?.data?.result?.id?.id;

    // 6. Atualizar log com sucesso
    await MessageLog.findByIdAndUpdate(
      logEntry._id,
      { $set: { status: LOG_STATUS.DELIVERED, wwebjsMessageId: wId || undefined } }
    );
    
    // 7. ATUALIZAR O IDENTIFICADOR (Flag)
    await AnamnesisResponse.updateOne({ _id: responseId }, { notificationSent: true });

    sendToDiscord(`Notificação de Anamnese (${settingType}) enviada para ${formattedPhone}`, "success", taskName);

  } catch (error) {
    const errMsg = error?.response?.data?.message || error?.message || "Erro desconhecido.";
    const logId = logEntry?._id?.toString() || "N/A";

    captureException(error, {
      tags: { severity: "whatsapp_automatic_failure", clinic_id: clinic.toString(), setting_type: settingType, context: "anamnesisNotificationService" },
      extra: { patient_id: patient.toString(), log_id: logId },
    });

    if (logEntry) {
      // (Agora MessageLog está importado e LOG_STATUS está definido)
      await MessageLog.findByIdAndUpdate(logEntry._id, {
        status: LOG_STATUS.ERROR_SYSTEM,
        errorMessage: `Erro (Anamnesis ${taskName}): ${String(errMsg).substring(0, 500)}`,
      });
    }

    // Corrigindo o log do Discord para incluir o logId
    sendToDiscord(`Falha ao enviar (${settingType}) para ${formattedPhone} (Log: ${logId})\n**Erro:** ${String(errMsg).substring(0, 1000)}`, "error", taskName);
  }
};