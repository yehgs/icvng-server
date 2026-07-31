//server
import { Router } from 'express';
import auth from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';
import { countryScope } from '../middleware/countryScope.js';
import { uploadImage } from '../middleware/multer.js';
import {
  getFinanceMetaController,
  getLiveExchangeRateController,
  getEntriesController,
  createEntryController,
  updateEntryController,
  deleteEntryController,
  addAttachmentController,
  removeAttachmentController,
} from '../controllers/finance-entry.controller.js';

const financeRouter = Router();
financeRouter.use(auth);
financeRouter.use(adminAuth);
// The finance-entry model carries its own countryCode (countryScopedPlugin)
// so a country-scoped Accountant only ever sees/writes their own country's
// entries — but that auto-filter only activates once req.countryScope is
// resolved and published into the request context, which is this
// middleware's job. Without it, enforcement silently never engages.
financeRouter.use(countryScope);

financeRouter.get('/meta', getFinanceMetaController);
financeRouter.get('/exchange-rate/:currency', getLiveExchangeRateController);
financeRouter.get('/', getEntriesController);
financeRouter.post('/', createEntryController);
financeRouter.put('/:id', updateEntryController);
financeRouter.delete('/:id', deleteEntryController);
financeRouter.post('/:id/attachment', uploadImage.single('image'), addAttachmentController);
financeRouter.delete('/:id/attachment/:pubId', removeAttachmentController);

export default financeRouter;
