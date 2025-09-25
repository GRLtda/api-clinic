// api/uploads/uploads.controller.js
const Upload = require('./uploads.model');
const cloudinary = require('../../config/cloudinary');

exports.uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
    }

    // Limite simples de 10MB e MIME type
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ message: 'Arquivo excede o limite de 10MB.' });
    }
    if (!/^image\/(png|jpe?g|webp)$/i.test(req.file.mimetype)) {
      return res.status(400).json({ message: 'Tipo de arquivo não suportado. Use PNG/JPG/WEBP.' });
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: 'prontuarios', resource_type: 'image' },
      async (error, result) => {
        if (error) {
          return res.status(500).json({ message: 'Erro ao fazer upload da imagem.', error: error.message });
        }

        const newUpload = await Upload.create({
          url: result.secure_url,
          public_id: result.public_id,
          fileType: 'image',
          clinic: req.clinicId,       // vem do requireClinic
          uploadedBy: req.user._id,   // vem do isAuthenticated
          patient: req.body.patientId || null,
        });

        return res.status(201).json({
          imageUrl: newUpload.url,
          uploadId: newUpload._id,
        });
      }
    );

    uploadStream.end(req.file.buffer);
  } catch (error) {
    return res.status(500).json({ message: 'Erro ao fazer upload da imagem.', error: error.message });
  }
};
