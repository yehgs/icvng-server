// Add this to your route/upload.route.js

import { Router } from 'express';
import auth from '../middleware/auth.js';
import uploadImageController from '../controllers/uploadImage.controller.js';
import uploadFileController from '../controllers/uploadFile.controller.js';
import deleteFileController from '../controllers/deleteFile.controller.js'; // New import
import { uploadImage, uploadFile } from '../middleware/multer.js';

const uploadRouter = Router();

// Existing routes
uploadRouter.post(
  '/upload',
  auth,
  uploadImage.single('image'),
  uploadImageController
);

uploadRouter.post(
  '/upload-file',
  auth,
  uploadFile.single('file'),
  uploadFileController
);

// New delete route - using URL parameter instead of request body
uploadRouter.delete('/delete-file/:public_id', auth, deleteFileController);

export default uploadRouter;
