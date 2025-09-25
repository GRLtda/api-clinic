// api/auth/auth.controller.js
const User = require('../users/users.model');
const Clinic = require('../clinics/clinics.model');
const generateToken = require('../../utils/generateToken');
const asyncHandler = require('../../utils/asyncHandler');

// @desc    Registrar um novo usuário (APENAS O USUÁRIO)
// @route   POST /api/auth/register
// @access  Public
exports.registerUser = asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body;

  // Validações mínimas sem mudar contrato de resposta
  if (!name || !email || !phone || !password) {
    return res.status(400).json({ message: 'Dados obrigatórios ausentes.' });
  }

  const userExists = await User.findOne({ email }).lean();
  if (userExists) {
    return res.status(400).json({ message: 'Usuário com este e-mail já existe.' });
  }

  const user = await User.create({ name, email, phone, password });

  return res.status(201).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    token: generateToken(user._id),
  });
});

// @desc    Autenticar usuário e obter token
// @route   POST /api/auth/login
// @access  Public
exports.loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
  }

  const user = await User.findOne({ email }).select('+password');
  if (user && (await user.matchPassword(password))) {
    return res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token: generateToken(user._id),
    });
  }

  return res.status(401).json({ message: 'E-mail ou senha inválidos.' });
});

// @desc    Retornar dados do usuário autenticado + clínica
// @route   GET /api/auth/me
// @access  Private (isAuthenticated + requireClinic)
exports.getMe = asyncHandler(async (req, res) => {
  const user = req.user; // setado pelo isAuthenticated
  const clinic = await Clinic.findOne({ owner: user._id }).lean();

  if (!clinic) {
    return res.status(404).json({ message: 'Clínica não encontrada para este usuário.' });
  }

  return res.status(200).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    clinic: clinic,
    role: 'owner',
  });
});
