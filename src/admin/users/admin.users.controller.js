// src/admin/users/admin.users.controller.js
const User = require('../../api/users/users.model');
const Clinic = require('../../api/clinics/clinics.model'); // <-- IMPORTAR O MODEL DE CLÍNICA
const asyncHandler = require('../../utils/asyncHandler');
const mongoose = require('mongoose');

/**
 * @desc    Listar todos os usuários (Admin)
 * @route   GET /api/admin/users
 * @access  Private (Admin)
 */
exports.getAllUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, role, search } = req.query;
  
  const pageNum = Math.max(parseInt(page), 1);
  const limitNum = Math.min(Math.max(parseInt(limit), 1), 100);
  const skip = (pageNum - 1) * limitNum;

  // --- Construção do Filtro Dinâmico ---
  const filter = {};
  
  if (role) {
    filter.role = role;
  }

  if (search && search.trim() !== '') {
    const s = search.trim();
    const searchRegex = new RegExp(s, 'i');

    filter.$or = [
      { name: searchRegex },
      { email: searchRegex },
      { phone: searchRegex }
    ];

    if (mongoose.Types.ObjectId.isValid(s)) {
      filter.$or.push({ _id: s });
    }
  }
  // --- Fim do Filtro ---

  // --- Busca e População (Etapa 1: Staff) ---
  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      // Popula 'clinic' para staff (médicos, recepcionistas, etc.)
      .populate('clinic', 'name responsibleName') 
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip(skip)
      .lean(), // .lean() é crucial para podermos modificar os objetos
  ]);

  // --- Lógica Adicional para 'Owners' (Etapa 2) ---
  
  // 1. Identificar 'owners' na lista que não têm clínica (o que é esperado)
  const ownerIds = users
    .filter(user => user.role === 'owner' && !user.clinic)
    .map(user => user._id);

  if (ownerIds.length > 0) {
    // 2. Buscar as clínicas desses 'owners'
    const ownerClinics = await Clinic.find({ owner: { $in: ownerIds } })
      .select('name responsibleName owner') // Seleciona o 'owner' para fazer o link
      .lean();

    // 3. Criar um mapa para acesso rápido (OwnerID -> Clínica)
    const clinicMap = new Map();
    ownerClinics.forEach(clinic => {
      // Converte o ObjectId do 'owner' para string para ser uma chave de mapa
      const ownerIdString = clinic.owner.toString();
      clinicMap.set(ownerIdString, clinic);
    });

    // 4. Injetar os dados da clínica nos usuários 'owner'
    users.forEach(user => {
      if (user.role === 'owner') {
        const userJsonId = user._id.toString();
        if (clinicMap.has(userJsonId)) {
          // Remove o campo 'owner' da clínica para evitar redundância
          const { owner, ...clinicData } = clinicMap.get(userJsonId);
          user.clinic = clinicData;
        }
      }
    });
  }
  // --- Fim da Lógica Adicional ---

  res.status(200).json({
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum) || 1,
    limit: limitNum,
    data: users,
  });
});