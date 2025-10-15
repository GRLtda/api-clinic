// api/payments/payments.controller.js
const Payment = require('./payments.model');
const User = require('../users/users.model');
const asyncHandler = require('../../utils/asyncHandler');

const PLAN_PRICES = {
  basic: 5990, // R$ 59,90 em centavos
  premium: 9990, // R$ 99,90 em centavos
};

/**
 * @desc    Usuário inicia um pagamento para um plano
 * @route   POST /api/payments
 * @access  Private
 */
exports.createPayment = asyncHandler(async (req, res) => {
  const { plan } = req.body;
  const userId = req.user._id;

  if (!plan || !PLAN_PRICES[plan]) {
    return res.status(400).json({ message: 'Plano inválido ou não fornecido.' });
  }

  // Opcional: Verifica se o usuário já possui um pagamento pendente
  const existingPendingPayment = await Payment.findOne({ user: userId, status: 'pending' });
  if (existingPendingPayment) {
    return res.status(409).json({ message: 'Você já possui um pagamento pendente. Conclua ou cancele-o antes de iniciar um novo.' });
  }

  const amount = PLAN_PRICES[plan];

  const payment = await Payment.create({
    user: userId,
    plan,
    amount,
    status: 'pending',
  });
  
  res.status(201).json({
    message: 'Intenção de pagamento criada com sucesso.',
    paymentId: payment._id,
    plan: payment.plan,
    amount: payment.amount,
    status: payment.status,
  });
});

/**
 * @desc    Aceitar um pagamento manualmente (para admin)
 * @route   POST /api/payments/accept-payment
 * @access  Private
 */
exports.acceptPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.body;

  if (!paymentId) {
    return res.status(400).json({ message: 'paymentId é obrigatório.' });
  }

  const payment = await Payment.findById(paymentId);

  if (!payment) {
    return res.status(404).json({ message: 'Pagamento não encontrado.' });
  }

  if (payment.status === 'paid') {
    return res.status(409).json({ message: 'Este pagamento já foi processado.' });
  }

  const user = await User.findById(payment.user);
  if (!user) {
    return res.status(404).json({ message: 'Usuário associado ao pagamento não encontrado.' });
  }

  // Atualiza o pagamento
  payment.status = 'paid';
  payment.paymentDate = new Date();
  await payment.save();

  // Atualiza o plano do usuário
  user.plan = payment.plan;
  await user.save();

  res.status(200).json({ message: 'Pagamento aceito com sucesso. Plano do usuário atualizado.' });
});