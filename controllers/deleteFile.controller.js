// controllers/deleteFile.controller.js
import { v2 as cloudinary } from 'cloudinary';

const deleteFileController = async (request, response) => {
  try {
    console.log('Delete file request received');
    console.log('Request body:', request.body);
    console.log('User:', request.user?.name);

    const { public_id } = request.body;

    if (!public_id) {
      console.log('No public_id provided');
      return response.status(400).json({
        message: 'Public ID is required for file deletion',
        error: true,
        success: false,
      });
    }

    console.log('Attempting to delete file with public_id:', public_id);

    // Delete from Cloudinary
    const deleteResult = await cloudinary.uploader.destroy(public_id, {
      resource_type: 'auto', // This handles both images and raw files (PDFs)
    });

    console.log('Cloudinary delete result:', deleteResult);

    if (deleteResult.result === 'ok') {
      return response.json({
        message: 'File deleted successfully',
        success: true,
        error: false,
        data: {
          public_id: public_id,
          result: deleteResult.result,
        },
      });
    } else if (deleteResult.result === 'not found') {
      return response.status(404).json({
        message: 'File not found in cloud storage',
        error: true,
        success: false,
        data: {
          public_id: public_id,
          result: deleteResult.result,
        },
      });
    } else {
      return response.status(500).json({
        message: 'Failed to delete file from cloud storage',
        error: true,
        success: false,
        data: {
          public_id: public_id,
          result: deleteResult.result,
        },
      });
    }
  } catch (error) {
    console.error('Delete file error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to delete file',
      error: true,
      success: false,
    });
  }
};

export default deleteFileController;
