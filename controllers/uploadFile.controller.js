// controllers/uploadFile.controller.js
import uploadFileCloudinary from '../utils/uploadFileCloudinary.js';

const uploadFileController = async (request, response) => {
  try {
    console.log('Upload request received');
    console.log('Request files:', request.files);
    console.log('Request file:', request.file);
    console.log('Request body:', request.body);

    const file = request.file;

    if (!file) {
      console.log('No file found in request');
      return response.status(400).json({
        message: 'Please provide a file',
        error: true,
        success: false,
      });
    }

    console.log('File details:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.buffer?.length || 0,
    });

    // Validate file type
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return response.status(400).json({
        message: 'Invalid file type. Only images and PDF files are allowed.',
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
    const upload = await uploadFileCloudinary(file);
    console.log('Cloudinary upload successful:', upload);

    // Make sure we return all necessary fields
    const responseData = {
      secure_url: upload.secure_url,
      public_id: upload.public_id,
      resource_type: upload.resource_type,
      format: upload.format,
      bytes: upload.bytes,
      original_filename: file.originalname,
      width: upload.width,
      height: upload.height,
      created_at: upload.created_at,
    };

    console.log('Sending response data:', responseData);

    return response.json({
      message: 'File uploaded successfully',
      success: true,
      error: false,
      data: responseData,
    });
  } catch (error) {
    console.error('File upload error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to upload file',
      error: true,
      success: false,
    });
  }
};

export default uploadFileController;
