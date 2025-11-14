const User = require('../users/users.model');
const Clinic = require('../clinics/clinics.model');
const EmployeeInvitation = require('../employees/employees.model');
const PasswordReset = require('./password-reset.model');
const AdminInvitation = require('../../admin/invitations/admin.invitation.model'); 
const generateToken = require('../../utils/generateToken');
const asyncHandler = require('../../utils/asyncHandler');
const { generateResetCode } = require('../../utils/generateResetCode');
const adminWhatsappService = require('../../services/adminWhatsappServiceClient');
const { formatPhoneNumber } = require('../crm/utils/phone-formatter');

exports.registerUser = asyncHandler(async (req, res) => {
  const { name, email, phone, password, invitationToken } = req.body;

  if (!name || !email || !phone || !password) {
    return res
      .status(400)
      .json({ message: 'Todos os campos são obrigatórios.' });
  }

  if (!invitationToken) {
    return res
      .status(403)
      .json({ message: 'Registro permitido apenas através de um convite válido.' });
  }

  const userExists = await User.findOne({ email }).lean();
  if (userExists) {
    return res
      .status(400)
      .json({ message: 'Usuário com este e-mail já existe.' });
  }

  let userData = { name, email, phone, password };

  const employeeInvite = await EmployeeInvitation.findOne({
    token: invitationToken,
    tokenExpires: { $gt: new Date() },
    status: 'pending',
  });

  if (employeeInvite && employeeInvite.email.toLowerCase() === email.toLowerCase()) {
    userData.clinic = employeeInvite.clinic;
    userData.role = employeeInvite.role;

    const user = await User.create(userData);

    await Clinic.updateOne(
      { _id: employeeInvite.clinic },
      { $addToSet: { staff: user._id } }
    );
    
    employeeInvite.status = 'accepted';
    await employeeInvite.save();

    return res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token: generateToken(user._id),
    });
  }

  const adminInvite = await AdminInvitation.findOne({
    token: invitationToken,
    expiresAt: { $gt: new Date() },
    status: 'pending',
  });

  if (adminInvite && adminInvite.email.toLowerCase() === email.toLowerCase()) {
    const user = await User.create(userData);

    adminInvite.status = 'accepted';
    await adminInvite.save();
    

    return res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token: generateToken(user._id),
    });
  }

  return res
    .status(400)
    .json({ message: 'Token de convite inválido, expirado ou não corresponde ao e-mail.' });
});

exports.loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "E-mail e senha são obrigatórios." });
  }

  const user = await User.findOne({ email, isActive: true }).select(
    "+password"
  ); // Garante que o usuário está ativo
  if (user && (await user.matchPassword(password))) {
    return res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token: generateToken(user._id),
    });
  }

  return res.status(401).json({ message: "E-mail ou senha inválidos." });
});

exports.getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).lean();

  const clinicId = user.role === "owner" ? req.clinicId : user.clinic;
  const clinic = await Clinic.findById(clinicId).lean();

  if (!clinic) {
    return res
      .status(404)
      .json({ message: "Clínica não encontrada para este usuário." });
  }

  return res.status(200).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    clinic: clinic,
  });
});

/**
 * @desc    Solicitar redefinição de senha
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { emailOrPhone } = req.body;

  if (!emailOrPhone) {
    return res
      .status(400)
      .json({ message: "Email ou telefone são obrigatórios." });
  }

  // 1. Encontra o usuário (pelo email ou telefone)
  // Usamos .select() para incluir os campos de reset
  const user = await User.findOne({
    $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
    isActive: true, // Só permite resetar de usuários ativos
  }).select("+passwordResetLastRequest");

  // 2. Resposta genérica (Segurança)
  // Se o usuário não for encontrado, enviamos uma resposta 200 OK
  // para não revelar se um email/telefone está ou não cadastrado.
  if (!user) {
    return res
      .status(200)
      .json({
        message: "Se um usuário for encontrado, um código será enviado.",
      });
  }

  // 3. Rate Limit (30 segundos)
  if (user.passwordResetLastRequest) {
    const thirtySecondsAgo = Date.now() - 30000; // 30s em ms
    if (user.passwordResetLastRequest.getTime() > thirtySecondsAgo) {
      return res
        .status(429)
        .json({
          message: "Aguarde 30 segundos para solicitar um novo código.",
        });
    }
  }

  // 4. Gerar código e datas
  const resetCode = generateResetCode();
  const now = Date.now();

  user.passwordResetToken = resetCode; // (Idealmente, isso deveria ser um hash, mas seguimos o pedido)
  user.passwordResetExpires = now + 3600000; // Expira em 1 hora
  user.passwordResetLastRequest = now; // Define o timestamp do último pedido

  await user.save();

  // 5. Enviar o código via WhatsApp Admin
  try {
    const formattedPhone = formatPhoneNumber(user.phone); // Garante o 55
    const message = `🔑 Seu código de verificação da Back Clinica é: *${resetCode}*\n\nEste código expira em 1 hora ⏳. Não compartilhe com ninguém.`;

    await adminWhatsappService.sendMessage(formattedPhone, message);

    return res
      .status(200)
      .json({
        message: "Se um usuário for encontrado, um código será enviado.",
      });
  } catch (whatsappError) {
    console.error(
      "Falha ao enviar SMS de reset pelo WhatsApp Admin:",
      whatsappError
    );
    // Mesmo se o WhatsApp falhar, retornamos 200 para o usuário
    // (O erro já foi logado no adminWhatsappServiceClient)
    return res
      .status(200)
      .json({
        message: "Se um usuário for encontrado, um código será enviado.",
      });
  }
});

/**
 * @desc    Redefinir a senha com o token
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
exports.resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res
      .status(400)
      .json({ message: "Código e nova senha são obrigatórios." });
  }

  // 1. Encontra o usuário pelo token e se ele não expirou
  const user = await User.findOne({
    passwordResetToken: token,
    passwordResetExpires: { $gt: Date.now() }, // Verifica se a data de expiração é MAIOR que agora
  }).select("+password"); // Precisamos do .select('+password') pois o 'pre-save' do hash será ativado

  if (!user) {
    return res.status(400).json({ message: "Código inválido ou expirado." });
  }

  // 2. Atualiza a senha
  user.password = newPassword; // O 'pre-save' do model vai hashear isso

  // 3. Limpa os campos de reset
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.passwordResetLastRequest = undefined;

  await user.save();

  // 4. (Opcional) Loga o usuário
  const loginToken = generateToken(user._id);

  res.status(200).json({
    message: "Senha redefinida com sucesso.",
    _id: user._id,
    name: user.name,
    email: user.email,
    token: loginToken,
  });
});

/**
 * @desc    Verifica um token de convite de admin e retorna os dados
 * @route   GET /api/auth/verify-invitation/:token
 * @access  Public
 */
exports.getInvitationDetails = asyncHandler(async (req, res) => {
  const { token } = req.params;

  if (!token) {
    return res.status(400).json({ message: 'Token não fornecido.' });
  }

  // Encontra o convite de admin (o único que tem 'plan')
  const invitation = await AdminInvitation.findOne({
    token: token,
    status: 'pending',
    expiresAt: { $gt: new Date() }, // Verifica se não expirou
  }).select('email phone plan').lean();

  if (!invitation) {
    return res.status(404).json({ message: 'Convite inválido, expirado ou já utilizado.' });
  }

  // Retorna os dados para preencher o formulário de registro
  res.status(200).json({
    email: invitation.email,
    phone: invitation.phone,
    plan: invitation.plan,
  });
});