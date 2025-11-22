// api/employees/employees.controller.js
const EmployeeInvitation = require('./employees.model');
const User = require('../users/users.model');
const Clinic = require('../clinics/clinics.model');
const asyncHandler = require('../../utils/asyncHandler');

// @desc    Convidar um novo funcionário
// @route   POST /api/employees/invite
// @access  Private
exports.inviteEmployee = asyncHandler(async (req, res) => {
  const { email, role } = req.body;
  const clinicId = req.clinicId;

  if (!email || !role) {
    return res.status(400).json({ message: 'Email e cargo são obrigatórios.' });
  }

  const existingUserInClinic = await User.findOne({ email, clinic: clinicId });
  if (existingUserInClinic) {
    return res.status(400).json({ message: 'Já existe um funcionário com este e-mail na clínica.' });
  }

  const existingInvitation = await EmployeeInvitation.findOne({ email, clinic: clinicId, status: 'pending' });
  if (existingInvitation) {
    return res.status(400).json({ message: 'Já existe um convite pendente para este e-mail.' });
  }

  const invitation = new EmployeeInvitation({ email, role, clinic: clinicId });
  const token = invitation.generateToken();
  await invitation.save();

  res.status(201).json({
    message: 'Convite criado com sucesso!',
    invitationToken: token,
    invitation,
  });
});

// @desc    Listar todos os funcionários e o dono da clínica
// @route   GET /api/employees
// @access  Private
exports.listEmployees = asyncHandler(async (req, res) => {
  const clinicId = req.clinicId;
  const currentUserId = req.user._id;

  const clinic = await Clinic.findById(clinicId)
    .populate('owner', 'name email phone role')
    .populate('staff', 'name email phone role')
    .lean();

  if (!clinic) {
    return res.status(404).json({ message: 'Clínica não encontrada.' });
  }

  // Combina o dono e os funcionários em uma única lista
  const allEmployees = [clinic.owner, ...clinic.staff];

  // Filtra para remover o usuário logado da lista e garantir que não hajam nulos
  const employeesList = allEmployees.filter(emp => emp && !emp._id.equals(currentUserId));

  const pendingInvitations = await EmployeeInvitation.find({ clinic: clinicId, status: 'pending' })
    .select('email role status createdAt token')
    .lean();

  res.status(200).json({
    activeEmployees: employeesList,
    pendingInvitations,
  });
});
  
// @desc    Remover (demitir) um funcionário da clínica
// @route   DELETE /api/employees/:id/remove
// @access  Private
exports.removeEmployee = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const clinicId = req.clinicId;

  // 1. Remove o funcionário do array 'staff' da clínica
  const clinicUpdateResult = await Clinic.updateOne(
    { _id: clinicId },
    { $pull: { staff: id } }
  );

  if (clinicUpdateResult.modifiedCount === 0) {
    return res.status(404).json({ message: 'Funcionário não encontrado na equipe desta clínica.' });
  }

  // 2. Desvincula a clínica do perfil do usuário e reseta seu cargo
  await User.updateOne(
    { _id: id, clinic: clinicId },
    { $unset: { clinic: 1 }, $set: { role: 'owner' } } // Reseta para que ele possa criar sua própria clínica
  );

  res.status(200).json({ message: 'Funcionário removido com sucesso.' });
});

// @desc    Cancelar (deletar) um convite pendente
// @route   DELETE /api/employees/invite/:id
// @access  Private
exports.cancelInvitation = asyncHandler(async (req, res) => {
  const { id } = req.params; // ID do documento EmployeeInvitation
  const clinicId = req.clinicId;

  const deletedInvitation = await EmployeeInvitation.findOneAndDelete({
    _id: id,
    clinic: clinicId,
    status: 'pending', // Garante que só estamos excluindo convites pendentes
  });

  if (!deletedInvitation) {
    return res.status(404).json({ message: 'Convite pendente não encontrado.' });
  }

  res.status(200).json({ message: 'Convite cancelado com sucesso.' });
});


// @desc    Atualizar cargo de um funcionário
// @route   PUT /api/employees/:id/role
// @access  Private
exports.updateEmployeeRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  const clinicId = req.clinicId;

  if (!role || !['recepcionista', 'medico', 'gerente'].includes(role)) {
      return res.status(400).json({ message: 'Cargo inválido.' });
  }

  const employee = await User.findOneAndUpdate(
      { _id: id, clinic: clinicId }, // Garante que estamos atualizando um funcionário da clínica
      { role },
      { new: true }
  );

  if (!employee) {
      return res.status(404).json({ message: 'Funcionário não encontrado nesta clínica.' });
  }

  res.status(200).json({ message: 'Cargo atualizado com sucesso.', employee });
});

// @desc    Buscar detalhes de um convite pelo token
// @route   GET /api/employees/invitation/:token
// @access  Public
exports.getInvitationDetailsByToken = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const invitation = await EmployeeInvitation.findOne({
    token,
    tokenExpires: { $gt: new Date() },
    status: 'pending',
  }).select('email role');

  if (!invitation) {
    return res.status(404).json({ message: 'Convite não encontrado, inválido ou expirado.' });
  }

  res.status(200).json(invitation);
});