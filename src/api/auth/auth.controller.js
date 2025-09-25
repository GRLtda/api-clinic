const User = require('../users/users.model');
const Clinic = require('../clinics/clinics.model');
const generateToken = require('../../utils/generateToken'); // Criaremos este arquivo

// ...
// A função de login permanece a mesma

// @desc    Registrar um novo usuário (APENAS O USUÁRIO)
// @route   POST /api/auth/register
// @access  Public
exports.registerUser = async (req, res) => {
  // Agora só precisamos dos dados do usuário
  const { name, email, phone, password } = req.body;

  try {
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'Usuário com este e-mail já existe.' });
    }

    // Cria apenas o usuário
    const user = await User.create({ name, email, phone, password });

    // Retorna os dados do usuário e um token para ele prosseguir para o próximo passo (configurar a clínica)
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token: generateToken(user._id), // Token para autenticar no próximo passo
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro no servidor ao registrar usuário.', error: error.message });
  }
};

// @desc    Autenticar usuário e obter token
// @route   POST /api/auth/login
// @access  Public
exports.loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Encontra o usuário pelo e-mail
    // Usamos .select('+password') porque no model definimos para não vir por padrão
    const user = await User.findOne({ email }).select('+password');

    // 2. Verifica se o usuário existe E se a senha bate
    if (user && (await user.matchPassword(password))) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'E-mail ou senha inválidos.' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Erro no servidor ao fazer login.', error: error.message });
  }
};