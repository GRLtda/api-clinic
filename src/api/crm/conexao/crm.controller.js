// src/api/crm/crm.controller.js

const expressAsyncHandler = require('express-async-handler');
const { captureException } = require('../../utils/sentry');
const Patient = require('../../api/patients/patients.model');
const Clinic = require('../../api/clinics/clinics.model');
const MessageTemplate = require('./modelos/message-template.model');
const Appointment = require('../../api/appointments/appointments.model');
const { createLogEntry } = require('./logs/message-log.controller');
const {
    MessageLog,
    LOG_STATUS,
    ACTION_TYPES,
} = require('./logs/message-log.model');
const { 
    initializeClient, 
    sendMessage,
    logoutAndRemoveClient,
    clients,
    qrCodes
} = require('./conexao/whatsapp.client'); 


// ===================================================================
// UTILS DE FORMATAÇÃO (Mínimo Necessário)
// ===================================================================

const fillTemplate = (templateContent, data) => {
  let content = templateContent;

  // CORREÇÃO: Substitui com e sem espaços
  content = content.replace(/{ paciente }/g, data.patientName || "Paciente");
  content = content.replace(/{paciente}/g, data.patientName || "Paciente");
  content = content.replace(/{ clinica }/g, data.clinicName || "Clínica");
  content = content.replace(/{ nome_medico }/g, data.doctorName || "Dr(a).");
  content = content.replace(/{ data_consulta }/g, data.appointmentDate || "");
  content = content.replace(/{ hora_consulta }/g, data.appointmentTime || "");
  content = content.replace(/{ link_anamnese }/g, data.anamnesisLink || "");

  return content.trim();
};

const formatDate = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString("pt-BR");
};

const formatTime = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
};


// ===================================================================
// HELPER: Busca dados necessários para o preenchimento do template
// ===================================================================

const getTemplateData = async (clinicId, patientId) => {
    const patient = await Patient.findById(patientId);
    if (!patient) throw new Error('Paciente não encontrado.');

    const clinic = await Clinic.findById(clinicId).populate('owner', 'name email');
    if (!clinic) throw new Error('Clínica não encontrada.');
    
    // Busca agendamento futuro mais próximo
    const nextAppointment = await Appointment.findOne({
        patient: patientId,
        clinic: clinicId,
        startTime: { $gte: new Date() },
        status: { $in: ['Agendado', 'Confirmado'] }
    }).sort({ startTime: 1 });

    return {
        patient,
        clinic,
        doctor: clinic.owner,
        nextAppointment,
    };
};


// ===================================================================
// ROTAS DE GERENCIAMENTO DE CONEXÃO
// ===================================================================

/**
 * @desc    Rota para gerar o QR Code, forçando reset se necessário.
 * @route   GET /api/crm/qrcode
 * @access  Private (Requer clínica)
 */
exports.generateQRCode = expressAsyncHandler(async (req, res) => {
    // req.clinicId é populado pelo auth.middleware
    const clinicId = req.clinicId; 
    const id = clinicId.toString();

    const currentClient = clients.get(id);
    
    // Se o cliente está preso em 'INITIALIZING' sem QR, força o reset.
    if (currentClient && currentClient.state === 'INITIALIZING' && !qrCodes.has(id)) {
        console.log(`[QR-ROUTE] Cliente ${id} preso em INITIALIZING sem QR. Forçando RESET.`);
        await logoutAndRemoveClient(clinicId); 
    }
    
    const client = await initializeClient(clinicId); 

    // Cliente CONECTADO (Ready)
    if (client.info && client.info.wid) {
        return res.status(200).json({ 
            status: "connected", 
            message: "WhatsApp já está conectado." 
        });
    }

    // QR CODE DISPONÍVEL
    if (qrCodes.has(id)) {
        const qr = qrCodes.get(id);
        return res.status(200).json({ 
            status: "qrcode", 
            message: "Leia o QR Code para conectar.",
            qrCode: qr 
        });
    }
    
    // Inicialização em progresso
    return res.status(202).json({
        status: "initializing",
        message: "Conexão em progresso. Tente buscar o QR code novamente em 5 segundos."
    });
});

/**
 * @desc    Rota para obter o status da conexão WhatsApp.
 * @route   GET /api/crm/status
 * @access  Private (Requer clínica)
 */
exports.getConnectionStatus = expressAsyncHandler(async (req, res) => {
    const clinicId = req.clinicId;
    const id = clinicId.toString();

    if (!clients.has(id)) {
        return res.status(200).json({
            status: "disconnected",
            message: "WhatsApp desconectado. Gere um novo QR code para conectar."
        });
    }

    const client = clients.get(id);

    if (client.info && client.info.wid) {
        return res.status(200).json({
            status: "connected",
            message: "WhatsApp conectado."
        });
    }
    
    if (qrCodes.has(id)) {
        return res.status(200).json({
            status: "qrcode_pending",
            message: "QR Code gerado. Aguardando leitura."
        });
    }

    if (client.state === 'INITIALIZING') {
        return res.status(200).json({
            status: "initializing",
            message: "Conexão em progresso."
        });
    }

    return res.status(200).json({
        status: "disconnected",
        message: "WhatsApp desconectado. Gere um novo QR code para conectar."
    });
});

/**
 * @desc    Rota para desconectar o WhatsApp.
 * @route   POST /api/crm/logout
 * @access  Private (Requer clínica)
 */
exports.logoutClient = expressAsyncHandler(async (req, res) => {
    const clinicId = req.clinicId;

    if (!clients.has(clinicId.toString())) {
        return res.status(404).json({ 
            status: "disconnected", 
            message: "O cliente já estava desconectado." 
        });
    }

    await logoutAndRemoveClient(clinicId);
    
    res.status(200).json({ 
        status: "success", 
        message: "Cliente WhatsApp desconectado com sucesso." 
    });
});


// ===================================================================
// ROTA DE TESTE E ENVIO MANUAL
// ===================================================================

/**
 * @desc    Rota de Teste: Preenche o template e envia a mensagem para o próprio paciente
 * @route   POST /api/crm/send-test
 * @access  Private (Requer clínica)
 */
exports.sendTestMessage = expressAsyncHandler(async (req, res) => {
    const clinicId = req.clinicId;
    const { patientId, templateId } = req.body;

    if (!patientId || !templateId) {
        res.status(400);
        throw new Error("ID do paciente e ID do template são obrigatórios.");
    }

    const template = await MessageTemplate.findOne({ _id: templateId, clinic: clinicId });
    if (!template) {
        res.status(404);
        throw new Error("Template não encontrado nesta clínica.");
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
            appointmentDate: data.nextAppointment ? formatDate(data.nextAppointment.startTime) : 'N/A (Nenhum agendamento futuro)',
            appointmentTime: data.nextAppointment ? formatTime(data.nextAppointment.startTime) : 'N/A',
        });
        
        // 3. Cria o log de tentativa
        logEntry = await createLogEntry({
            clinic: clinicId,
            patient: patientId,
            template: templateId,
            settingType: 'MANUAL_TEST',
            messageContent: `[TESTE] ${finalMessage}`,
            recipientPhone: data.patient.phone,
            status: LOG_STATUS.SENT_ATTEMPT,
            actionType: ACTION_TYPES.MANUAL_SEND,
        });

        // 4. Envia a mensagem
        await initializeClient(clinicId);
        const result = await sendMessage(clinicId, data.patient.phone, `[TESTE] ${finalMessage}`);

        // 5. Atualiza o log de sucesso
        await MessageLog.findByIdAndUpdate(logEntry._id, {
            status: LOG_STATUS.DELIVERED,
            wwebjsMessageId: result.id.id,
        });

        res.status(200).json({ 
            message: "Mensagem de teste enviada com sucesso.", 
            logId: logEntry._id 
        });

    } catch (error) {
        
        // LOG SENTRY: Captura o erro específico do Teste Manual
        captureException(error, {
            tags: {
                severity: 'manual_whatsapp_test_failure',
                clinic_id: clinicId.toString(),
                template_id: templateId,
            },
            extra: {
                patient_id: patientId,
                phone: data ? data.patient.phone : 'N/A',
                error_source: 'Manual Test Route',
            }
        });
        
        // 6. Atualiza o log de erro no DB
        if (logEntry) {
            await MessageLog.findByIdAndUpdate(logEntry._id, {
                status: LOG_STATUS.ERROR_WHATSAPP,
                errorMessage: error.message,
            });
        }
        
        // 7. Retorna o erro ao cliente
        res.status(400);
        throw new Error(`Erro ao enviar mensagem de teste: ${error.message}`);
    }
});


/**
 * @desc    Envia uma mensagem de texto (funcionalidade CRM)
 * @route   POST /api/crm/send-message
 * @access  Private (Requer clínica)
 */
exports.sendMessageToPatient = expressAsyncHandler(async (req, res) => {
    const { number, message, patientId, templateId } = req.body; 
    const clinicId = req.clinicId;

    if (!number || !message || !patientId) {
        res.status(400);
        throw new Error('Número, paciente e mensagem são obrigatórios.');
    }

    let logEntry;
    
    // Verificação de segurança: checa se o paciente pertence à clínica
    const patientExistsInClinic = await Patient.findOne({ _id: patientId, clinicId: clinicId });
    if (!patientExistsInClinic) {
        res.status(404);
        throw new Error('Paciente não encontrado nesta clínica.');
    }

    try {
        // 1. Criar um log de tentativa de envio (SENT_ATTEMPT)
        logEntry = await createLogEntry({
            clinic: clinicId,
            patient: patientId,
            template: templateId || null,
            settingType: 'MANUAL_SEND',
            messageContent: message,
            recipientPhone: number,
            status: LOG_STATUS.SENT_ATTEMPT,
            actionType: ACTION_TYPES.MANUAL_SEND,
        });
        
        // 2. Tentar enviar a mensagem pelo WhatsApp
        await initializeClient(clinicId);
        const result = await sendMessage(clinicId, number, message);

        // 3. Atualizar o log com o sucesso
        await MessageLog.findByIdAndUpdate(logEntry._id, {
            status: LOG_STATUS.DELIVERED,
            wwebjsMessageId: result.id.id,
        });

        res.status(200).json({ message: 'Mensagem enviada com sucesso.', result });
    } catch (error) {
        
        // LOG SENTRY: Captura o erro específico de envio manual
        captureException(error, {
            tags: {
                severity: 'manual_whatsapp_send_failure',
                clinic_id: clinicId.toString(),
            },
            extra: {
                patient_id: patientId,
                phone: number,
                error_source: 'Manual Send Route',
            }
        });

        // 4. Atualizar o log com o erro
        if (logEntry) {
            await MessageLog.findByIdAndUpdate(logEntry._id, {
                status: LOG_STATUS.ERROR_WHATSAPP,
                errorMessage: error.message,
            });
        }
        
        res.status(400);
        throw new Error(error.message); // Retorna a mensagem de erro original
    }
});