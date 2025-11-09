// src/api/crm/conexao/crm.controller.js
const expressAsyncHandler = require("express-async-handler");
// Importa o cliente HTTP para comunicar com o serviço WhatsApp dedicado
const whatsappServiceClient = require('../../../services/whatsappServiceClient');
// Mantém imports necessários para lógica que permanece na API Principal (logs, dados, templates)
const { createLogEntry } = require("../logs/message-log.controller");
const { MessageLog, LOG_STATUS, ACTION_TYPES } = require("../logs/message-log.model"); //
const Patient = require("../../patients/patients.model");
const MessageTemplate = require("../modelos/message-template.model");
const Clinic = require("../../clinics/clinics.model");
const Appointment = require("../../appointments/appointments.model");
const { captureException } = require("../../../utils/sentry");

// ===================================================================
// UTILS DE FORMATAÇÃO E BUSCA DE DADOS (Permanecem na API Principal)
// ===================================================================

// Função para preencher variáveis no template
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
};

// Função para formatar data
const formatDate = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleDateString("pt-BR");
};

// Função para formatar hora
const formatTime = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

// Função para buscar dados necessários para preencher o template
const getTemplateData = async (clinicId, patientId) => {
  const patient = await Patient.findById(patientId);
  if (!patient) throw new Error("Paciente não encontrado.");

  const clinic = await Clinic.findById(clinicId).populate("owner", "name email");
  if (!clinic) throw new Error("Clínica não encontrada.");

  const nextAppointment = await Appointment.findOne({
    patient: patientId,
    clinic: clinicId,
    startTime: { $gte: new Date() },
    status: { $in: ["Agendado", "Confirmado"] },
  }).sort({ startTime: 1 });

  return {
    patient,
    clinic,
    doctor: clinic.owner,
    nextAppointment,
  };
};

// ===================================================================
// ROTAS DE GERENCIAMENTO (Delegadas ao Serviço WhatsApp)
// ===================================================================

/**
 * @desc    Rota para obter o QR Code (via serviço dedicado).
 * @route   GET /api/crm/qrcode
 * @access  Private (Requer clínica)
 */
exports.generateQRCode = expressAsyncHandler(async (req, res) => {
  const clinicId = req.clinicId;
  try {
    const response = await whatsappServiceClient.getQRCode(clinicId);
    res.status(response.status).json(response.data);
  } catch (error) {
    captureException(error, { tags: { context: 'getQRCodeService' } });
    const status = error.response?.status || 500;
    const data = error.response?.data || { message: 'Erro ao comunicar com o serviço WhatsApp para obter QR code.' };
    res.status(status).json(data);
  }
});

/**
 * @desc    Rota para obter o status da conexão WhatsApp (via serviço dedicado).
 * @route   GET /api/crm/status
 * @access  Private (Requer clínica)
 */
exports.getConnectionStatus = expressAsyncHandler(async (req, res) => {
  const clinicId = req.clinicId;
  try {
    const response = await whatsappServiceClient.getStatus(clinicId);
    res.status(response.status).json(response.data);
  } catch (error) {
    captureException(error, { tags: { context: 'getStatusService' } });
    const status = error.response?.status || 500;
    const data = error.response?.data || { message: 'Erro ao comunicar com o serviço WhatsApp para obter status.' };
    res.status(status).json(data);
  }
});

/**
 * @desc    Rota para desconectar o WhatsApp (via serviço dedicado).
 * @route   POST /api/crm/logout
 * @access  Private (Requer clínica)
 */
exports.logoutClient = expressAsyncHandler(async (req, res) => {
  const clinicId = req.clinicId;
  try {
    const response = await whatsappServiceClient.logout(clinicId);
    res.status(response.status).json(response.data);
  } catch (error) {
    captureException(error, { tags: { context: 'logoutService' } });
    const status = error.response?.status || 500;
    const data = error.response?.data || { message: 'Erro ao comunicar com o serviço WhatsApp para desconectar.' };
    res.status(status).json(data);
  }
});

// ===================================================================
// ROTAS DE ENVIO (Delegadas ao Serviço WhatsApp, com lógica de log local)
// ===================================================================

/**
 * @desc    Envia uma mensagem de texto (funcionalidade CRM) via serviço dedicado
 * @route   POST /api/crm/send-message
 * @access  Private (Requer clínica)
 */
exports.sendMessageToPatient = expressAsyncHandler(async (req, res) => {
  // MODIFICADO: Extrai 'footer' e 'buttons' do body
  const { number, message, patientId, templateId, footer, buttons } = req.body;
  const clinicId = req.clinicId;

  if (!number || !message || !patientId) {
    return res.status(400).json({ message: "Número, paciente e mensagem são obrigatórios." });
  }

  // Validação de segurança
  const patientExistsInClinic = await Patient.exists({ _id: patientId, clinicId: clinicId });
  if (!patientExistsInClinic) {
    return res.status(404).json({ message: "Paciente não encontrado nesta clínica." });
  }

  let logEntry;
  try {
    // 1. Criar log de tentativa
    logEntry = await createLogEntry({
      clinic: clinicId,
      patient: patientId,
      template: templateId || null,
      settingType: "MANUAL_SEND",
      messageContent: message,
      recipientPhone: number,
      status: LOG_STATUS.SENT_ATTEMPT,
      actionType: ACTION_TYPES.MANUAL_SEND,
    });

    // 2. Chamar o serviço WhatsApp (MODIFICADO)
    const response = await whatsappServiceClient.sendMessage(
      clinicId, 
      number, 
      message, 
      { footer, buttons } // Passa as opções
    );
    const responseData = response.data;

    // ... (lógica de atualização de log permanece a mesma) ...
    let finalStatus = LOG_STATUS.DELIVERED;
    let messageId = responseData.result?.id?.id || responseData.result?.id || null;
    if (responseData.message === "Mensagem enviada para a fila.") {
      finalStatus = LOG_STATUS.PENDING;
    }
    await MessageLog.findByIdAndUpdate(logEntry._id, {
      status: finalStatus,
      wwebjsMessageId: messageId,
    });

    res.status(response.status || 200).json(responseData);

  } catch (error) {
    captureException(error, {
      tags: { severity: "manual_whatsapp_send_failure", clinic_id: clinicId.toString(), context: 'sendMessageService' },
      extra: { patient_id: patientId, phone: number },
    });
    if (logEntry) {
      await MessageLog.findByIdAndUpdate(logEntry._id, {
        status: LOG_STATUS.ERROR_SYSTEM,
        errorMessage: error.response?.data?.message || error.message,
      });
    }
    const status = error.response?.status || 500;
    const data = error.response?.data || { message: 'Erro ao solicitar envio de mensagem ao serviço WhatsApp.' };
    res.status(status).json(data);
  }
});

/**
 * @desc    Rota de Teste: Preenche o template e envia via serviço dedicado
 * @route   POST /api/crm/send-test
 * @access  Private (Requer clínica)
 */
exports.sendTestMessage = expressAsyncHandler(async (req, res) => {
  const clinicId = req.clinicId;
  const { patientId, templateId } = req.body;

  if (!patientId || !templateId) {
    return res.status(400).json({ message: "ID do paciente e ID do template são obrigatórios." });
  }

  const template = await MessageTemplate.findOne({ _id: templateId, clinic: clinicId });
  if (!template) {
    return res.status(404).json({ message: "Template não encontrado nesta clínica." });
  }

  let logEntry;
  let data;

  try {
    // 1. Busca Dados Dinâmicos
    data = await getTemplateData(clinicId, patientId);

    // 2. Prepara a mensagem
    const finalMessage = fillTemplate(template.content, {
        patientName: data.patient.name,
        clinicName: data.clinic.name,
        doctorName: data.doctor.name,
        appointmentDate: data.nextAppointment ? formatDate(data.nextAppointment.startTime) : "N/A",
        appointmentTime: data.nextAppointment ? formatTime(data.nextAppointment.startTime) : "N/A",
        anamnesisLink: "" // Adicionar lógica se aplicável
    });
    const testMessageContent = `[TESTE] ${finalMessage}`;

    // 3. Cria o log de tentativa
    logEntry = await createLogEntry({
      clinic: clinicId,
      patient: patientId,
      template: templateId,
      settingType: null, // Teste manual não tem um 'settingType'
      messageContent: testMessageContent,
      recipientPhone: data.patient.phone,
      status: LOG_STATUS.SENT_ATTEMPT, //
      actionType: ACTION_TYPES.MANUAL_SEND, //
    });

    // 4. Envia a mensagem via serviço dedicado
    const response = await whatsappServiceClient.sendMessage(clinicId, data.patient.phone, testMessageContent);
    const responseData = response.data;

    // --- LÓGICA DE ATUALIZAÇÃO DO LOG (MODIFICADA) ---
    let finalStatus = LOG_STATUS.DELIVERED; //
    let messageId = responseData.result?.id?.id || responseData.result?.id || null;

    if (responseData.message === "Mensagem enviada para a fila.") {
      finalStatus = LOG_STATUS.PENDING; //
    }
    // --- FIM DA MODIFICAÇÃO ---

    // 5. Atualiza o log de sucesso
    await MessageLog.findByIdAndUpdate(logEntry._id, {
      status: finalStatus,
      wwebjsMessageId: messageId,
    });

    // Retorna a resposta original do serviço
    res.status(response.status || 200).json(responseData);

  } catch (error) {
    captureException(error, {
      tags: { severity: "manual_whatsapp_test_failure", clinic_id: clinicId.toString(), context: 'sendTestMessageService' },
      extra: { patient_id: patientId, phone: data?.patient?.phone || 'N/A' },
    });

    // 6. Atualiza o log de erro
    if (logEntry) {
      await MessageLog.findByIdAndUpdate(logEntry._id, {
        status: LOG_STATUS.ERROR_SYSTEM, //
        errorMessage: error.response?.data?.message || error.message,
      });
    }

    const status = error.response?.status || 500;
    const data = error.response?.data || { message: 'Erro ao enviar mensagem de teste via serviço WhatsApp.' };
    res.status(status).json(data);
  }
});