// src/admin/invitations/admin.invitations.controller.js
const AdminInvitation = require('./admin.invitation.model');
const User = require('../../api/users/users.model');
const asyncHandler = require('../../utils/asyncHandler');

/**
 * @desc    Criar um novo convite de registro
 * @route   POST /api/admin/users/registro
 * @access  Private (Admin)
 */
exports.createInvitation = asyncHandler(async (req, res) => {
  const { email, phone, plan = 'basic' } = req.body;

  if (!email || !phone) {
    return res.status(400).json({ message: 'E-mail e telefone são obrigatórios.' });
  }

  // 1. Verifica se já existe um usuário com este e-mail
  const userExists = await User.exists({ email });
  if (userExists) {
    return res.status(409).json({ message: 'Um usuário com este e-mail já está cadastrado.' });
  }

  // 2. Verifica se já existe um convite pendente
  const invitationExists = await AdminInvitation.exists({ email, status: 'pending' });
  if (invitationExists) {
    return res.status(409).json({ message: 'Já existe um convite pendente para este e-mail.' });
  }

  // 3. Cria o novo convite
  const invitation = new AdminInvitation({
    email,
    phone,
    plan,
  });

  // 4. Gera token
  invitation.generateToken();

  // 5. Salva no banco
  await invitation.save();

  res.status(201).json({
    message: 'Convite criado com sucesso.',
    invitation,
  });
});

/**
 * @desc    Listar todos os convites
 * @route   GET /api/admin/users/registro
 * @access  Private (Admin)
 */
exports.listInvitations = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;

  const pageNum = Math.max(parseInt(page), 1);
  const limitNum = Math.min(Math.max(parseInt(limit), 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const filter = {};
  if (status) filter.status = status;

  const [total, invitations] = await Promise.all([
    AdminInvitation.countDocuments(filter),
    AdminInvitation.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
  ]);

  res.status(200).json({
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum) || 1,
    limit: limitNum,
    data: invitations,
  });
});

/**
 * @desc    Excluir um convite
 * @route   DELETE /api/admin/users/registro/:id
 * @access  Private (Admin)
 */
exports.deleteInvitation = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const invitation = await AdminInvitation.findById(id);

  if (!invitation) {
    return res.status(404).json({ message: 'Convite não encontrado.' });
  }

  // Impede a exclusão de convites já aceitos (opcional, mas boa prática)
  if (invitation.status === 'accepted') {
    return res.status(400).json({ message: 'Não é possível excluir um convite que já foi aceito.' });
  }

  await invitation.deleteOne();

  res.status(204).send();
});