// api/auth/auth.controller.js
const User = require('../users/users.model');
const Clinic = require('../clinics/clinics.model');
const EmployeeInvitation = require('../employees/employees.model');
const generateToken = require('../../utils/generateToken');
const asyncHandler = require('../../utils/asyncHandler');

exports.registerUser = asyncHandler(async (req, res) => {
  const { name, email, phone, password, invitationToken } = req.body;

  if (!name || !email || !phone || !password) {
    return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
  }

  const userExists = await User.findOne({ email }).lean();
  if (userExists) {
    return res.status(400).json({ message: 'Usuário com este e-mail já existe.' });
  }

  let userData = { name, email, phone, password };
  let invitation = null;

  if (invitationToken) {
    invitation = await EmployeeInvitation.findOne({
      token: invitationToken,
      tokenExpires: { $gt: new Date() },
      status: 'pending',
    });

    if (!invitation || invitation.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({ message: 'Token de convite inválido ou expirado.' });
    }

    userData.clinic = invitation.clinic;
    userData.role = invitation.role;
  }

  const user = await User.create(userData);

  // Se o registro foi por convite, adiciona o user ao staff da clínica
  if (invitation) {
    await Clinic.updateOne(
      { _id: invitation.clinic },
      { $addToSet: { staff: user._id } } // $addToSet previne duplicados
    );
    invitation.status = 'accepted';
    await invitation.save();
  }

  return res.status(201).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    token: generateToken(user._id),
  });
});

// ... (o resto do arquivo auth.controller.js permanece o mesmo)
exports.loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
  
    if (!email || !password) {
      return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
    }
  
    const user = await User.findOne({ email, isActive: true }).select('+password'); // Garante que o usuário está ativo
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
  
  exports.getMe = asyncHandler(async (req, res) => {
      const user = await User.findById(req.user._id).lean(); 
    
      const clinicId = user.role === 'owner' ? req.clinicId : user.clinic;
      const clinic = await Clinic.findById(clinicId).lean();
    
      if (!clinic) {
        return res.status(404).json({ message: 'Clínica não encontrada para este usuário.' });
      }
    
      return res.status(200).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        clinic: clinic,
      });
    });