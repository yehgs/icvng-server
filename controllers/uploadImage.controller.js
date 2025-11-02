// controllers/uploadImage.controller.js
import uploadImageCloudinary from '../utils/uploadImageCloudinary.js';

const uploadImageController = async (request, response) => {
  try {
    console.log('Upload request received');
    console.log('Request file:', request.file);

    const file = request.file;
   
    if (!file) {
      console.log('No file found in request');
      return response.status(400).json({
        message: 'Please provide an image',
        error: true,
        success: false,
      });
    }

    // console.log('File details:', {
    //   originalname: file.originalname,
    //   mimetype: file.mimetype,
    //   size: file.buffer?.length || 0,
    // });

    // Validate file type
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return response.status(400).json({
        message: 'Invalid file type. Only images are allowed.',
        error: true,
        success: false,
      });
    }

    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    const fileSize = file.buffer?.length || 0;
    if (fileSize > maxSize) {
      return response.status(400).json({
        message: 'File too large. Maximum size is 10MB.',
        error: true,
        success: false,
      });
    }

    console.log('Starting Cloudinary upload...');
    const upload = await uploadImageCloudinary(file);
    console.log('Cloudinary upload successful:', upload);

    // ✅ RETURN THE IMAGE DATA PROPERLY
    return response.json({
      message: 'Upload done',
      success: true,
      error: false,
      data: {
        url: upload.secure_url,
        secure_url: upload.secure_url,
        public_id: upload.public_id,
        resource_type: upload.resource_type,
        format: upload.format,
        width: upload.width,
        height: upload.height,
        bytes: upload.bytes,
        created_at: upload.created_at,    
      }, 
    });
  } catch (error) {
    console.error('Image upload error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to upload image',
      error: true,
      success: false,
    });
  }
};

export default uploadImageController;