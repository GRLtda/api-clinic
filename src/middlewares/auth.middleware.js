const jwt = require('jsonwebtoken');
const User = require('../api/users/users.model');
const Clinic = require('../api/clinics/clinics.model');

// Middleware 1: Apenas verifica se o token é válido e anexa o usuário à requisição
exports.isAuthenticated = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
      if (!req.user) {
        return res.status(401).json({ message: 'Usuário do token não encontrado.' });
      }
      next();
    } catch (error) {
      return res.status(401).json({ message: 'Não autorizado, token inválido.' });
    }
  }
  if (!token) {
    return res.status(401).json({ message: 'Não autorizado, nenhum token fornecido.' });
  }
};

// Middleware 2: Roda DEPOIS de 'isAuthenticated' e verifica se a clínica existe
exports.requireClinic = async (req, res, next) => {
  try {
    // req.user já foi preenchido pelo middleware anterior
    const clinic = await Clinic.findOne({ owner: req.user._id });
    if (!clinic) {
      return res.status(403).json({ message: 'Ação requerida, mas a clínica não foi configurada.' });
    }
    // Anexa o ID da clínica para ser usado nos controladores (pacientes, agenda, etc)
    req.clinicId = clinic._id;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao verificar a clínica do usuário.' });
  }
};