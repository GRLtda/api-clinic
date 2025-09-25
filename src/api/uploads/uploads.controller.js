const cloudinary = require('../../config/cloudinary');
const DatauriParser = require('datauri/parser');
const path = require('path');
const Upload = require('./uploads.model');

exports.uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
    }
    const parser = new DatauriParser();
    const fileDataUri = parser.format(path.extname(req.file.originalname).toString(), req.file.buffer);
    const result = await cloudinary.uploader.upload(fileDataUri.content, { folder: 'prontuarios' });
    
    // Cria o registro do upload no nosso banco de dados
    const newUpload = await Upload.create({
      url: result.secure_url,
      public_id: result.public_id,
      clinic: req.clinicId,
      uploadedBy: req.user._id,
      patient: req.body.patientId || null,
    });

    res.status(201).json({ 
        imageUrl: newUpload.url,
        uploadId: newUpload._id // Retorna o ID do nosso registro
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao fazer upload da imagem.', error: error.message });
  }
};