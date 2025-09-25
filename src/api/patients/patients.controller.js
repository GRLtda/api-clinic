// api/patients/patients.controller.js
const Patient = require('./patients.model');
const asyncHandler = require('../../utils/asyncHandler');

// Helpers
const pickCreateFields = (body) => {
  const { name, gender, birthDate, phone, cpf, address } = body || {};
  return { name, gender, birthDate, phone, cpf, address };
};
const pickUpdateFields = (body) => {
  const { name, gender, birthDate, phone, cpf, address } = body || {};
  return { name, gender, birthDate, phone, cpf, address };
};
const notDeleted = { deletedAt: { $exists: false } };

const duplicateKeyMessage = (err) => {
  if (err?.code === 11000 && err?.keyPattern) {
    if (err.keyPattern.phone) return 'Telefone já cadastrado nesta clínica.';
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
    return res.status(201).json(savedPatient);
  } catch (err) {
    const msg = duplicateKeyMessage(err);
    if (msg) return res.status(400).json({ message: 'Erro ao criar paciente', error: msg });
    return res.status(400).json({ message: 'Erro ao criar paciente', error: err.message });
  }
});

// LISTAR (exclui soft-deletados)
exports.getAllPatients = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
  const skip = (page - 1) * limit;

  const filter = { clinicId: req.clinicId, ...notDeleted };

  const [totalPatients, patients] = await Promise.all([
    Patient.countDocuments(filter),
    Patient.find(filter).limit(limit).skip(skip).sort({ name: 1 }).lean(),
  ]);

  return res.status(200).json({
    total: totalPatients,
    page,
    pages: Math.ceil(totalPatients / limit) || 1,
    limit,
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

  try {
    const updatedPatient = await Patient.findOneAndUpdate(
      { _id: req.params.id, clinicId: req.clinicId, ...notDeleted },
      updateData,
      { new: true, runValidators: true, omitUndefined: true }
    );

    if (!updatedPatient) {
      return res.status(404).json({ message: 'Paciente não encontrado nesta clínica' });
    }

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

  return res.status(204).send();
});
