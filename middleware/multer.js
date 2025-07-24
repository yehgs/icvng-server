import multer from 'multer';

const storage = multer.memoryStorage();

export const uploadImage = multer({ storage: storage });

export const uploadFile = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    fieldSize: 10 * 1024 * 1024, // 10MB field size limit
  },
  fileFilter: (req, file, cb) => {
    console.log('Multer fileFilter - File received:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });

    // Allow images and PDFs
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      console.log('File type allowed:', file.mimetype);
      cb(null, true);
    } else {
      console.log('File type rejected:', file.mimetype);
      cb(
        new Error('Invalid file type. Only images and PDF files are allowed.'),
        false
      );
    }
  },
});
