// utils/uploadFileCloudinary.js
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET_KEY,
});

const uploadFileCloudinary = async (file) => {
  // For multer memoryStorage, use file.buffer directly
  const buffer = file.buffer;

  if (!buffer) {
    throw new Error('No file buffer found');
  }

  // Determine resource type based on file type
  const resourceType = file.mimetype === 'application/pdf' ? 'raw' : 'image';

  const uploadFile = await new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: 'icv-ng/receipts',
          resource_type: resourceType,
          // For PDFs, we need to specify format
          ...(file.mimetype === 'application/pdf' && { format: 'pdf' }),
        },
        (error, uploadResult) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            return reject(error);
          }
          return resolve(uploadResult);
        }
      )
      .end(buffer);
  });

  return uploadFile;
};

export default uploadFileCloudinary;
