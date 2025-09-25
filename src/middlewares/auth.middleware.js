// middlewares/auth.middleware.js
const jwt = require('jsonwebtoken');
const User = require('../api/users/users.model');
const Clinic = require('../api/clinics/clinics.model');

// Middleware 1: autenticação
exports.isAuthenticated = async (req, res, next) => {
  let token;

  const authHeader = req.headers.authorization || '';
  const [scheme, value] = authHeader.split(' ');
  if (scheme && /^Bearer$/i.test(scheme) && value) {
    token = value;
  }

  if (!token) {
    return res.status(401).json({ message: 'Não autorizado, nenhum token fornecido.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'Usuário do token não encontrado.' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Não autorizado, token inválido.' });
  }
};

// Middleware 2: clínica obrigatória
exports.requireClinic = async (req, res, next) => {
  try {
    const clinic = await Clinic.findOne({ owner: req.user._id }).select('_id').lean();
    if (!clinic) {
      return res.status(403).json({ message: 'Ação requerida, mas a clínica não foi configurada.' });
    }
    req.clinicId = clinic._id;
    return next();
  } catch (error) {
    return res.status(500).json({ message: 'Erro ao verificar a clínica do usuário.' });
  }
};
