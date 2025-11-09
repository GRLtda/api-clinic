// src/admin/clinics/admin.clinics.controller.js
const Clinic = require('../../api/clinics/clinics.model');
const Patient = require('../../api/patients/patients.model'); // <-- ADICIONADO
const Appointment = require('../../api/appointments/appointments.model'); // <-- ADICIONADO
const asyncHandler = require('../../utils/asyncHandler');
const mongoose = require('mongoose'); // <-- ADICIONADO (para a busca por ID)

/**
 * @desc    Listar todas as clínicas (Admin)
 * @route   GET /api/admin/clinics
 * @access  Private (Admin)
 */
exports.getAllClinics = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search } = req.query;
  
  const pageNum = Math.max(parseInt(page), 1);
  const limitNum = Math.min(Math.max(parseInt(limit), 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const filter = {};

  // Filtro de busca (Nome, Responsável, CNPJ, ID da Clínica, ID do Dono)
  if (search && search.trim() !== '') {
    const s = search.trim();
    const searchRegex = new RegExp(s, 'i');

    filter.$or = [
      { name: searchRegex },
      { responsibleName: searchRegex },
      { cnpj: searchRegex }
    ];

    if (mongoose.Types.ObjectId.isValid(s)) {
      filter.$or.push({ _id: s });
      filter.$or.push({ owner: s });
    }
  }

  const [total, clinics] = await Promise.all([
    Clinic.countDocuments(filter),
    Clinic.find(filter)
      .populate('owner', 'name email phone') 
      .populate('staff', 'name email phone role') 
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip(skip)
      .lean(),
  ]);

  res.status(200).json({
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum) || 1,
    limit: limitNum,
    data: clinics,
  });
});

/**
 * @desc    Obter uma clínica específica por ID (Admin)
 * @route   GET /api/admin/clinics/:id
 * @access  Private (Admin)
 */
exports.getClinicById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // 1. Busca a clínica e popula os dados do dono e da equipe
  const clinicPromise = Clinic.findById(id)
    .populate('owner', 'name email phone role')
    .populate('staff', 'name email phone role')
    .lean();

  // 2. Conta o total de pacientes (não deletados)
  const patientCountPromise = Patient.countDocuments({ 
    clinicId: id, 
    deletedAt: { $exists: false } 
  });

  // 3. Conta o total de agendamentos
  const appointmentCountPromise = Appointment.countDocuments({ 
    clinic: id 
  });

  // Executa tudo em paralelo
  const [clinic, totalPatients, totalAppointments] = await Promise.all([
    clinicPromise,
    patientCountPromise,
    appointmentCountPromise
  ]);

  // Verifica se a clínica foi encontrada
  if (!clinic) {
    return res.status(404).json({ message: 'Clínica não encontrada.' });
  }

  // Retorna a clínica com os dados de resumo aninhados
  res.status(200).json({
    ...clinic,
    summaryStats: {
      totalPatients,
      totalAppointments,
      totalStaff: clinic.staff?.length || 0
    }
  });
});