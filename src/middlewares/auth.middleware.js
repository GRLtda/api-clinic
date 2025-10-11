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
    // Buscamos o usuário completo para ter acesso a 'role' e 'clinic'
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

// Middleware 2: clínica obrigatória (CORRIGIDO)
exports.requireClinic = async (req, res, next) => {
  try {
    let clinicId;

    // Se o usuário é o dono, a clínica está vinculada pela propriedade 'owner'
    if (req.user.role === 'owner') {
      const clinic = await Clinic.findOne({ owner: req.user._id }).select('_id').lean();
      if (clinic) {
        clinicId = clinic._id;
      }
    } 
    // Se for um funcionário, o ID da clínica está no próprio documento do usuário
    else if (req.user.clinic) {
      // Verificação de segurança para garantir que a clínica ainda existe
      const clinicExists = await Clinic.exists({ _id: req.user.clinic });
      if (clinicExists) {
        clinicId = req.user.clinic;
      }
    }

    // Se, após as verificações, não encontrarmos um ID de clínica, o acesso é negado.
    if (!clinicId) {
      return res.status(403).json({ message: 'Ação requerida, mas a clínica não foi configurada ou encontrada para este usuário.' });
    }

    req.clinicId = clinicId; // Anexa o ID da clínica à requisição para os controllers usarem
    return next();
  } catch (error) {
    return res.status(500).json({ message: 'Erro ao verificar a clínica do usuário.' });
  }
};