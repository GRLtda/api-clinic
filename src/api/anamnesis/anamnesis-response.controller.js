// api/anamnesis/anamnesis-response.controller.js
const asyncHandler = require('../../utils/asyncHandler');
const AnamnesisResponse = require('./anamnesis-response.model');
const AnamnesisTemplate = require('./anamnesis-template.model');
const Patient = require('../patients/patients.model');
// --- NOVA IMPORTAÇÃO ---
const { sendAnamnesisNotification } = require('./anamnesis-notification.service');

// Helpers
const ensurePatientInClinic = async (patientId, clinicId) => {
  const exists = await Patient.exists({ _id: patientId, clinicId, deletedAt: { $exists: false } });
  return !!exists;
};

// -----------------------------------------------------------------------------------
// @desc    Atribuir uma anamnese a um paciente (gera token se for paciente preencher)
// @route   POST /patients/:patientId/anamnesis
// @access  Private (isAuthenticated + requireClinic)
// Body: { templateId: string, mode?: 'Paciente' | 'Médico', tokenTtlDays?: number, sendNotification?: boolean } // <-- MODIFICADO
// -----------------------------------------------------------------------------------
exports.createAnamnesisForPatient = asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  // --- sendNotification extraído do body ---
  const { templateId, mode = 'Paciente', tokenTtlDays = 7, sendNotification = false } = req.body || {};
  const clinicId = req.clinicId;

  if (!templateId) {
    return res.status(400).json({ message: 'templateId é obrigatório.' });
  }

  // Checagens de vínculo
  const [patientOk, template] = await Promise.all([
    ensurePatientInClinic(patientId, clinicId),
    AnamnesisTemplate.findOne({ _id: templateId, clinic: clinicId }).lean(),
  ]);

  if (!patientOk) {
    return res.status(404).json({ message: 'Paciente não encontrado nesta clínica.' });
  }
  if (!template) {
    return res.status(404).json({ message: 'Modelo de anamnese não encontrado nesta clínica.' });
  }

  const doc = new AnamnesisResponse({
    patient: patientId,
    clinic: clinicId,
    template: templateId,
    status: 'Pendente',
    answeredBy: mode,
    sendNotification: !!sendNotification,
  });

  if (mode === 'Paciente') {
    const ttlMs = Math.max(parseInt(tokenTtlDays, 10) || 7, 1) * 24 * 60 * 60 * 1000;
    doc.generatePatientToken(ttlMs);
  }

  const saved = await doc.save();

  // --- LÓGICA DE ENVIO DE NOTIFICAÇÃO ---
  if (mode === 'Paciente' && saved.sendNotification && saved.patientAccessToken) {
    sendAnamnesisNotification(saved).catch(err => {
      const { captureException } = require('../../utils/sentry');
      captureException(err, {
        tags: { context: 'createAnamnesisNotificationTrigger' },
        extra: { responseId: saved._id }
      });
    });
  }
  // --- FIM DA LÓGICA ---

  // Retorna o doc; se houver token, ele vem junto
  return res.status(201).json(saved);
});

// -----------------------------------------------------------------------------------
// @desc    Listar anamneses do paciente
// @route   GET /patients/:patientId/anamnesis?status=&page=&limit=
// @access  Private
// -----------------------------------------------------------------------------------
exports.getAnamnesisForPatient = asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const clinicId = req.clinicId;
  const { status } = req.query;

  const ok = await ensurePatientInClinic(patientId, clinicId);
  if (!ok) return res.status(404).json({ message: 'Paciente não encontrado nesta clínica.' });

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const filter = { clinic: clinicId, patient: patientId };
  if (status) filter.status = status;

  const [total, items] = await Promise.all([
    AnamnesisResponse.countDocuments(filter),
    AnamnesisResponse.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      // .populate('template', 'name') // <-- Bug (Linha Antiga)
      .populate({ // <-- CORREÇÃO APLICADA
        path: 'template',
        select: 'name questions' // Popula o nome e o array de perguntas
      })
      .lean(),
  ]);

  return res.status(200).json({
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    limit,
    data: items,
  });
});

// -----------------------------------------------------------------------------------
// @desc    Médico submete as respostas de uma anamnese
// @route   PUT /patients/:patientId/anamnesis/:responseId
// @access  Private
// Body: { answers: Answer[] }
// -----------------------------------------------------------------------------------
exports.submitAnamnesisByDoctor = asyncHandler(async (req, res) => {
  const { responseId, patientId } = req.params;
  const { answers } = req.body || {};
  const clinicId = req.clinicId;

  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ message: 'Respostas inválidas.' });
  }

  const resp = await AnamnesisResponse.findOne({
    _id: responseId,
    patient: patientId,
    clinic: clinicId,
  });

  if (!resp) {
    return res.status(404).json({ message: 'Registro de Anamnese não encontrado.' });
  }
  if (resp.status === 'Preenchido') {
    return res.status(409).json({ message: 'Este formulário já foi respondido.' });
  }

  resp.answers = answers;
  resp.markFilled('Médico');
  await resp.save();

  return res.status(200).json(resp);
});

// -----------------------------------------------------------------------------------
// @desc    Paciente submete as respostas de uma anamnese via link público
// @route   PUT /anamnesis/public/:token
// @access  Public
// Body: { answers: Answer[] }
// -----------------------------------------------------------------------------------
exports.submitAnamnesisByPatient = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { answers } = req.body || {};

  if (!token) {
    return res.status(400).json({ message: 'Token inválido.' });
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ message: 'Respostas inválidas.' });
  }

  const response = await AnamnesisResponse.findOne({ patientAccessToken: token });

  if (!response) {
    return res.status(404).json({ message: 'Formulário não encontrado ou inválido.' });
  }
  if (response.status === 'Preenchido') {
    return res.status(409).json({ message: 'Este formulário já foi respondido.' });
  }
  if (!response.patientAccessTokenExpires || response.patientAccessTokenExpires < new Date()) {
    return res.status(403).json({ message: 'O link para este formulário expirou.' });
  }

  response.answers = answers;
  response.markFilled('Paciente');

  response.lgpdConsent = {
    ipAddress: req.ip, // Captura o IP
    userAgent: req.headers['user-agent'], // Captura o "navegador"
    timestamp: new Date(), // Captura a data/hora exata
  };

  await response.save();

  return res.status(200).json({ message: 'Obrigado por responder!' });
});

// -----------------------------------------------------------------------------------
// @desc    Paciente visualiza o formulário de anamnese via link público
// @route   GET /anamnesis/public/:token
// @access  Public
// -----------------------------------------------------------------------------------
exports.getAnamnesisForPatientByToken = asyncHandler(async (req, res) => {
  const { token } = req.params;

  if (!token) {
    return res.status(400).json({ message: 'Token inválido.' });
  }

  // Encontra a resposta da anamnese pelo token e popula o modelo
  const response = await AnamnesisResponse.findOne({ patientAccessToken: token })
    .populate('template', 'name questions') // Popula o modelo de anamnese
    .populate('patient', 'name gender cpf')   // Popula os dados do paciente
    .populate('clinic', 'name logoUrl')       // Popula os dados da clínica
    .lean(); // Retorna um objeto JavaScript simples

  // Validações de segurança
  if (!response) {
    return res.status(404).json({ message: 'Formulário não encontrado ou inválido.' });
  }
  if (response.status === 'Preenchido') {
    return res.status(409).json({ message: 'Este formulário já foi respondido.' });
  }
  if (!response.patientAccessTokenExpires || response.patientAccessTokenExpires < new Date()) {
    return res.status(403).json({ message: 'O link para este formulário expirou.' });
  }

  // Monta os dados do paciente conforme solicitado
  let patientInfo = null;
  if (response.patient) {
    patientInfo = {
      name: response.patient.name,
      gender: response.patient.gender,
      cpf: response.patient.cpf ? response.patient.cpf.substring(0, 3) : null,
    };
  }

  // Monta os dados da clínica
  let clinicInfo = null;
  if (response.clinic) {
    clinicInfo = {
      name: response.clinic.name,
      logoUrl: response.clinic.logoUrl,
    };
  }

  // Remove os campos completos do response antes de retornar
  const { patient, clinic, ...rest } = response;

  return res.status(200).json({
    ...rest,
    patientInfo,
    clinicInfo, // Adiciona a informação da clínica
  });
});

// -----------------------------------------------------------------------------------
// @desc    Listar todas as anamneses pendentes da clínica
// @route   GET /anamnesis/pending?page=&limit=
// @access  Private (isAuthenticated + requireClinic)
// -----------------------------------------------------------------------------------
exports.getPendingAnamneses = asyncHandler(async (req, res) => {
  const clinicId = req.clinicId;

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const filter = {
    clinic: clinicId,
    status: 'Pendente'
  };

  const [total, items] = await Promise.all([
    AnamnesisResponse.countDocuments(filter),
    AnamnesisResponse.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('patient', 'name phone')
      .populate('template', 'name')
      .lean(),
  ]);

  // Formatar os dados para incluir todas as informações solicitadas
  const formattedItems = items.map(item => {
    const anamnesisLink = item.patientAccessToken
      ? `https://www.agendadoutor.com/anamnese/${item.patientAccessToken}`
      : null;

    return {
      _id: item._id,
      patientId: item.patient?._id,
      patientName: item.patient?.name || 'N/A',
      patientPhone: item.patient?.phone || 'N/A',
      anamnesisLink,
      expirationDate: item.patientAccessTokenExpires,
      assignedDate: item.createdAt,
      whatsappNotified: item.notificationSent || false,
      templateName: item.template?.name || 'N/A',
      status: item.status,
    };
  });

  return res.status(200).json({
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    limit,
    data: formattedItems,
  });
});