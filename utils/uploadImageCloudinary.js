// utils/uploadImageCloudinary.js
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET_KEY,
  timeout: 120000,
});

const uploadImageCloudinary = async (image) => {    
  try {
    // Get buffer from multer file
    const buffer = image?.buffer;

    if (!buffer) {
      throw new Error('No image buffer found');
    }

    // console.log('Starting Cloudinary image upload...');
    // console.log('Buffer size:', buffer.length);

    // Upload to Cloudinary
    const uploadImage = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { 
            folder: 'icv-ng',
            resource_type: 'image', // ✅ Explicitly set as image
            timeout: 120000
          },
          (error, uploadResult) => {
            if (error) {
              console.error('Cloudinary upload error:', error);
              return reject(error); // ✅ Handle errors properly
            }
            console.log('Cloudinary upload success:', {
              public_id: uploadResult.public_id,
              secure_url: uploadResult.secure_url,
            });
            return resolve(uploadResult); 
          },
        )
        .end(buffer);
    });

    return uploadImage;
  } catch (error) {
    console.error('Upload image Cloudinary error:', error);
    throw error;
  }
};

export default uploadImageCloudinary;                     