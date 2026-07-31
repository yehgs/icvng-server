//server
// route/support-ticket.route.js  (UPDATED)
import { Router } from 'express';
import auth from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';
import { countryScope } from '../middleware/countryScope.js';
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
// Tickets carry their own countryCode (countryScopedPlugin) so a
// country-scoped admin only sees their own country's tickets — that
// auto-filter needs req.countryScope resolved first, hence this middleware.
supportTicketRouter.use(countryScope);

supportTicketRouter.get('/categories', getCategoriesController);
supportTicketRouter.get('/', getTicketsController);
supportTicketRouter.get('/:id', getTicketByIdController);
supportTicketRouter.post('/', createTicketController);
supportTicketRouter.put('/:id/status', updateTicketStatusController);
supportTicketRouter.post('/:id/message', addTicketMessageController);
supportTicketRouter.post('/:id/message-image', uploadImage.single('image'), addTicketMessageImageController);

export default supportTicketRouter;
