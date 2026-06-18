//server
// route/support-ticket.route.js  (UPDATED)
import { Router } from 'express';
import auth from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';
import { uploadImage } from '../middleware/multer.js';
import {
  getTicketsController,
  getTicketByIdController,
  createTicketController,
  updateTicketStatusController,
  addTicketMessageController,
  addTicketMessageImageController,
  getCategoriesController,
} from '../controllers/support-ticket.controller.js';

const supportTicketRouter = Router();
supportTicketRouter.use(auth);
supportTicketRouter.use(adminAuth);

supportTicketRouter.get('/categories', getCategoriesController);
supportTicketRouter.get('/', getTicketsController);
supportTicketRouter.get('/:id', getTicketByIdController);
supportTicketRouter.post('/', createTicketController);
supportTicketRouter.put('/:id/status', updateTicketStatusController);
supportTicketRouter.post('/:id/message', addTicketMessageController);
supportTicketRouter.post('/:id/message-image', uploadImage.single('image'), addTicketMessageImageController);

export default supportTicketRouter;
