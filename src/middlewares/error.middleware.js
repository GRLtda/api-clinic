const { Sentry } = require('../utils/sentry');

// Middleware de manipulação de erros para o Express
exports.errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode);

  // 1. Captura o erro no Sentry
  // Ignora erros de status de cliente (4xx), a menos que seja um erro muito específico.
  if (statusCode >= 500) {
    Sentry.withScope((scope) => {
      scope.setTag("error_type", "Express Global Handler");
      scope.setTag("path", req.originalUrl);
      scope.setTag("method", req.method);
      scope.setUser(req.user ? { id: req.user._id, email: req.user.email } : null);
      Sentry.captureException(err);
    });
  }

  // 2. Resposta ao cliente
  res.json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};

// Middleware para rotas não encontradas (404)
exports.notFound = (req, res, next) => {
  const error = new Error(`Não Encontrado - ${req.originalUrl}`);
  res.status(404);
  next(error); // Passa para o errorHandler
};