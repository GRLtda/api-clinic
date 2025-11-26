// api/records/records.controller.js
const mongoose = require('mongoose');
const asyncHandler = require('../../utils/asyncHandler');
const MedicalRecordEntry = require('./records.model');
const Upload = require('../uploads/uploads.model');
const Patient = require('../patients/patients.model');

// ---------- Helpers ----------
const ensurePatientInClinic = async (patientId, clinicId) => {
  const exists = await Patient.exists({ _id: patientId, clinicId, deletedAt: { $exists: false } });
  return !!exists;
};

// ---------- Mantidos: usados por patients.routes ----------
exports.createRecordEntry = asyncHandler(async (req, res) => {
  const { patientId, content, appointmentId, attachments = [] } = req.body;
  const clinicId = req.clinicId;
  const authorId = req.user._id;

  if (!patientId || !content) {
    return res.status(400).json({ message: 'patientId e content são obrigatórios.' });
  }
  const ok = await ensurePatientInClinic(patientId, clinicId);
  if (!ok) return res.status(404).json({ message: 'Paciente não encontrado nesta clínica.' });

  const record = await MedicalRecordEntry.create({
    patient: patientId,
    clinic: clinicId,
    author: authorId,
    appointment: appointmentId || undefined,
    content,
    attachments, // array de Upload._id (opcional)
  });

  return res.status(201).json(record);
});

exports.getRecordByAppointmentId = asyncHandler(async (req, res) => {
  const { appointmentId } = req.params;
  const clinicId = req.clinicId;

  console.log('[DEBUG] getRecordByAppointmentId - Início');
  console.log('[DEBUG] appointmentId recebido:', appointmentId);
  console.log('[DEBUG] appointmentId tipo:', typeof appointmentId);
  console.log('[DEBUG] clinicId:', clinicId);

  // Validar se appointmentId é um ObjectId válido
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    console.log('[DEBUG] appointmentId inválido - não é um ObjectId válido');
    return res.status(400).json({
      message: 'ID de agendamento inválido.'
    });
  }

  // Converter explicitamente para ObjectId
  const appointmentObjectId = new mongoose.Types.ObjectId(appointmentId);
  console.log('[DEBUG] appointmentId convertido para ObjectId:', appointmentObjectId);

  // Busca o prontuário que corresponde ao agendamento e à clínica
  console.log('[DEBUG] Iniciando busca no banco de dados...');
  console.log('[DEBUG] Query:', { appointment: appointmentObjectId, clinic: clinicId });

  const record = await MedicalRecordEntry.findOne({
    appointment: appointmentObjectId,
    clinic: clinicId,
  })
    .populate('attachments', 'url fileType uploadedBy createdAt attachments') // Popula anexos, se houver
    .lean();

  console.log('[DEBUG] Resultado da busca:', record ? 'Registro encontrado' : 'Nenhum registro encontrado');
  if (record) {
    console.log('[DEBUG] Record ID:', record._id);
    console.log('[DEBUG] Record appointment:', record.appointment);
    console.log('[DEBUG] Record clinic:', record.clinic);
  }

  // Se não encontrar, retorna 404
  if (!record) {
    console.log('[DEBUG] Retornando 404 - Prontuário não encontrado');
    return res.status(404).json({ message: 'Nenhum registro de prontuário encontrado para este agendamento.' });
  }

  // Se encontrar, retorna o registro
  console.log('[DEBUG] Retornando prontuário encontrado');
  return res.status(200).json(record);
});



exports.getRecordEntriesForPatient = asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const clinicId = req.clinicId;

  const ok = await ensurePatientInClinic(patientId, clinicId);
  if (!ok) return res.status(404).json({ message: 'Paciente não encontrado nesta clínica.' });

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const filter = { patient: patientId, clinic: clinicId };
  const [total, entries] = await Promise.all([
    MedicalRecordEntry.countDocuments(filter),
    MedicalRecordEntry.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('attachments', 'url fileType uploadedBy createdAt') // só o necessário
      .lean(),
  ]);

  return res.status(200).json({
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    limit,
    data: entries,
  });
});

// ---------- Novos (opcionais): attach lifecycle ----------

// Anexar uploads existentes (IDs) a um prontuário
exports.addAttachments = asyncHandler(async (req, res) => {
  const { recordId } = req.params;
  const { uploadIds = [] } = req.body;
  const clinicId = req.clinicId;

  if (!Array.isArray(uploadIds) || uploadIds.length === 0) {
    return res.status(400).json({ message: 'uploadIds deve ser um array não vazio.' });
  }

  // Garante que todos os uploads pertencem à mesma clínica
  const owned = await Upload.countDocuments({ _id: { $in: uploadIds }, clinic: clinicId });
  if (owned !== uploadIds.length) {
    return res.status(403).json({ message: 'Alguns uploads não pertencem a esta clínica.' });
  }

  const updated = await MedicalRecordEntry.findOneAndUpdate(
    { _id: recordId, clinic: clinicId },
    { $addToSet: { attachments: { $each: uploadIds } } },
    { new: true }
  ).populate('attachments', 'url fileType uploadedBy createdAt');

  if (!updated) return res.status(404).json({ message: 'Prontuário não encontrado.' });
  return res.status(200).json(updated);
});

// Remover 1 anexo do prontuário (não deleta o upload em si)
exports.removeAttachment = asyncHandler(async (req, res) => {
  const { recordId, uploadId } = req.params;
  const clinicId = req.clinicId;

  const updated = await MedicalRecordEntry.findOneAndUpdate(
    { _id: recordId, clinic: clinicId },
    { $pull: { attachments: uploadId } },
    { new: true }
  ).populate('attachments', 'url fileType uploadedBy createdAt');

  if (!updated) return res.status(404).json({ message: 'Prontuário não encontrado.' });
  return res.status(200).json(updated);
});

// Upload + anexar em UMA chamada (transação)
exports.uploadAndAttachImage = asyncHandler(async (req, res) => {
  const { recordId } = req.params;
  const clinicId = req.clinicId;
  const userId = req.user._id;

  if (!req.file) {
    return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
  }

  const record = await MedicalRecordEntry.findOne({ _id: recordId, clinic: clinicId }).lean();
  if (!record) return res.status(404).json({ message: 'Prontuário não encontrado.' });

  // Valida tipo de arquivo simples (imagem)
  if (!/^image\/(png|jpe?g|webp)$/i.test(req.file.mimetype)) {
    return res.status(400).json({ message: 'Tipo de arquivo não suportado. Use PNG/JPG/WEBP.' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // 1) Sobe para cloudinary via stream
    const cloudinary = require('../../config/cloudinary');
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'prontuarios', resource_type: 'image' },
      async (error, result) => {
        if (error) {
          await session.abortTransaction();
          session.endSession();
          return res.status(500).json({ message: 'Erro no upload da imagem.', error: error.message });
        }

        try {
          // 2) Cria Upload no Mongo
          const uploadDoc = await Upload.create(
            [
              {
                url: result.secure_url,
                public_id: result.public_id,
                fileType: 'image',
                clinic: clinicId,
                uploadedBy: userId,
                patient: record.patient, // liga ao paciente do prontuário
              },
            ],
            { session }
          );

          // 3) Liga ao prontuário
          const updated = await MedicalRecordEntry.findOneAndUpdate(
            { _id: recordId, clinic: clinicId },
            { $addToSet: { attachments: uploadDoc[0]._id } },
            { new: true, session }
          ).populate('attachments', 'url fileType uploadedBy createdAt');

          await session.commitTransaction();
          session.endSession();

          return res.status(201).json({
            imageUrl: uploadDoc[0].url,
            uploadId: uploadDoc[0]._id,
            record: updated,
          });
        } catch (err) {
          await session.abortTransaction();
          session.endSession();
          return res.status(500).json({ message: 'Erro ao anexar o upload ao prontuário.', error: err.message });
        }
      }
    );

    // Envia buffer para o stream
    stream.end(req.file.buffer);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ message: 'Erro ao processar upload/anexo.', error: err.message });
  }
});

exports.updateRecordEntry = asyncHandler(async (req, res) => {
  const { recordId } = req.params;
  const { content, appointmentId } = req.body;
  const clinicId = req.clinicId;

  if (!content) {
    return res.status(400).json({ message: 'content é obrigatório.' });
  }

  const updated = await MedicalRecordEntry.findOneAndUpdate(
    { _id: recordId, clinic: clinicId },
    {
      $set: {
        content,
        appointment: appointmentId || undefined,
      },
    },
    { new: true }
  ).populate('attachments', 'url fileType uploadedBy createdAt');

  if (!updated) {
    return res.status(404).json({ message: 'Prontuário não encontrado.' });
  }

  return res.status(200).json(updated);
});
