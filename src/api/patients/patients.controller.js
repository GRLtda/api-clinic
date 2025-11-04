// api/patients/patients.controller.js
const Patient = require('./patients.model');
const asyncHandler = require('../../utils/asyncHandler');
// Importa o novo serviço de auditoria
const auditLogService = require('../audit/audit-log.service');

// Helpers
const pickCreateFields = (body) => {
  const { name, gender, birthDate, phone, cpf, address } = body || {};
  return { name, gender, birthDate, phone, cpf, address };
};
const pickUpdateFields = (body) => {
  const { name, gender, birthDate, phone, cpf, address } = body || {};
  return { name, gender, birthDate, phone, cpf, address };
};
// Campos que queremos rastrear no log de update
const fieldsToTrack = [
  'name', 
  'gender', 
  'birthDate', 
  'phone', 
  'cpf', 
  'address.cep', 
  'address.street', 
  'address.number', 
  'address.district', 
  'address.city', 
  'address.state'
];

const notDeleted = { deletedAt: { $exists: false } };

const duplicateKeyMessage = (err) => {
  if (err?.code === 11000 && err?.keyPattern) {
    if (err.keyPattern.cpf) return 'CPF já cadastrado nesta clínica.';
    return 'Registro duplicado para campo único.';
  }
  return null;
};

// CRIAR
exports.createPatient = asyncHandler(async (req, res) => {
  const clinicId = req.clinicId;
  const data = pickCreateFields(req.body);

  if (!data?.name || !data?.birthDate || !data?.phone) {
    return res.status(400).json({ message: 'Nome, data de nascimento e telefone são obrigatórios.' });
  }

  const patient = new Patient({ ...data, clinicId });
  try {
    const savedPatient = await patient.save();

    // --- Log de Auditoria (Criação) ---
    await auditLogService.createLog(
      req.user._id,
      req.clinicId,
      'PATIENT_CREATE',
      'Patient',
      savedPatient._id,
      {
        summary: 'Paciente criado',
        changes: [ // Loga os valores iniciais como "novos"
          { field: 'name', old: null, new: savedPatient.name },
          { field: 'phone', old: null, new: savedPatient.phone },
          { field: 'cpf', old: null, new: savedPatient.cpf },
        ]
      }
    );
    // --- Fim do Log ---

    return res.status(201).json(savedPatient);
  } catch (err) {
    const msg = duplicateKeyMessage(err);
    if (msg) return res.status(400).json({ message: 'Erro ao criar paciente', error: msg });
    return res.status(400).json({ message: 'Erro ao criar paciente', error: err.message });
  }
});

// LISTAR (exclui soft-deletados)
exports.getAllPatients = asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 10 } = req.query;
  const pageNum = Math.max(parseInt(page), 1);
  const limitNum = Math.min(Math.max(parseInt(limit), 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const baseFilter = { clinicId: req.clinicId, ...notDeleted };
  let finalFilter = baseFilter;
  let sort = { name: 1 }; // padrão por nome

  if (search && search.trim() !== '') {
    const s = search.trim();

    if (s.length < 3) {
      // se a pesquisa for muito curta, usa regex (prefixo)
      finalFilter = {
        ...baseFilter,
        $or: [
          { name: new RegExp(`^${s}`, 'i') },
          { cpf: new RegExp(`^${s}`, 'i') },
        ],
      };
    } else {
      // se a pesquisa for uma palavra maior, usa índice de texto
      finalFilter = { ...baseFilter, $text: { $search: s } };
      sort = { score: { $meta: 'textScore' } };
    }
  }

  const [totalPatients, patients] = await Promise.all([
    Patient.countDocuments(finalFilter),
    Patient.find(finalFilter)
      .sort(sort)
      .limit(limitNum)
      .skip(skip)
      .lean(),
  ]);

  return res.status(200).json({
    total: totalPatients,
    page: pageNum,
    pages: Math.ceil(totalPatients / limitNum) || 1,
    limit: limitNum,
    data: patients,
  });
});

// BUSCAR POR ID (exclui soft-deletados)
exports.getPatientById = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({
    _id: req.params.id,
    clinicId: req.clinicId,
    ...notDeleted,
  }).lean();

  if (!patient) {
    return res.status(404).json({ message: 'Paciente não encontrado nesta clínica' });
  }
  return res.status(200).json(patient);
});

// ATUALIZAR (exclui soft-deletados)
exports.updatePatient = asyncHandler(async (req, res) => {
  const updateData = pickUpdateFields(req.body);

  // --- Log de Auditoria (Update) ---
  // 1. Buscar o estado ORIGINAL (antes de atualizar)
  const originalPatient = await Patient.findOne({
    _id: req.params.id,
    clinicId: req.clinicId,
    ...notDeleted
  }).lean();

  if (!originalPatient) {
    return res.status(404).json({ message: 'Paciente não encontrado nesta clínica' });
  }
  // --- Fim da busca original ---

  try {
    // 2. Executar a atualização
    const updatedPatient = await Patient.findOneAndUpdate(
      { _id: req.params.id, clinicId: req.clinicId, ...notDeleted },
      updateData,
      { new: true, runValidators: true, omitUndefined: true }
    ).lean(); // .lean() para pegar o objeto puro para o diff

    // 3. Gerar o diff e salvar o log
    const diffDetails = auditLogService.generateDiffDetails(
      originalPatient,
      updatedPatient,
      fieldsToTrack
    );

    // Só grava o log se realmente houver mudanças
    if (diffDetails.changes.length > 0) {
      await auditLogService.createLog(
        req.user._id,
        req.clinicId,
        'PATIENT_UPDATE',
        'Patient',
        updatedPatient._id,
        diffDetails // Passa o objeto de 'changes'
      );
    }
    // --- Fim do Log ---

    return res.status(200).json(updatedPatient);
  } catch (err) {
    const msg = duplicateKeyMessage(err);
    if (msg) return res.status(400).json({ message: 'Erro ao atualizar paciente', error: msg });
    return res.status(400).json({ message: 'Erro ao atualizar paciente', error: err.message });
  }
});

// SOFT DELETE (marca deletedAt; mantém rota/status 204)
exports.deletePatient = asyncHandler(async (req, res) => {
  const softDeleted = await Patient.findOneAndUpdate(
    { _id: req.params.id, clinicId: req.clinicId, ...notDeleted },
    { deletedAt: new Date() },
    { new: true }
  );

  if (!softDeleted) {
    return res.status(404).json({ message: 'Paciente não encontrado nesta clínica' });
  }

  // --- Log de Auditoria (Deleção) ---
  await auditLogService.createLog(
    req.user._id,
    req.clinicId,
    'PATIENT_DELETE',
    'Patient',
    softDeleted._id,
    {
      summary: 'Paciente excluído (soft delete)',
      changes: [
        { field: 'name', old: softDeleted.name, new: null },
        { field: 'deletedAt', old: null, new: softDeleted.deletedAt }
      ]
    }
  );
  // --- Fim do Log ---

  return res.status(204).send();
});