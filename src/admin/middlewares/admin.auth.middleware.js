// src/admin/middlewares/admin.auth.middleware.js
const jwt = require('jsonwebtoken');

/**
 * @desc    Middleware para verificar se o usuário é um admin autenticado
 */
exports.isAdminAuthenticated = async (req, res, next) => {
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
    // Verifica o token com o mesmo segredo da sua aplicação principal
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verifica se o token decodificado tem a 'role' de admin
    if (decoded.role !== 'admin') {
      return res.status(403).json({ message: 'Acesso negado. Rota exclusiva para administradores.' });
    }

    // Anexa um objeto de usuário admin à requisição
    req.user = {
      _id: decoded.id,
      role: decoded.role,
    };
    
    return next();

  } catch (error) {
    return res.status(401).json({ message: 'Não autorizado, token inválido.' });
  }
};