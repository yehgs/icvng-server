// route/address.route.js - Enhanced with Nigerian location endpoints
import { Router } from 'express';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/roleAuth.js';
import {
  addAddressController,
  getAddressController,
  updateAddressController,
  deleteAddressController,
  setPrimaryAddressController,
  verifyAddressController,
  getAddressesByZoneController,
  getAddressStatsController,
  getNigerianLocationData,
} from '../controllers/address.controller.js';

const addressRouter = Router();

// ===== PUBLIC ROUTES =====
// Get Nigerian location data (states, LGAs)
addressRouter.get('/nigeria-locations', getNigerianLocationData);

// ===== USER ROUTES =====
// CRUD operations for user addresses
addressRouter.post('/create', auth, addAddressController);
addressRouter.get('/get', auth, getAddressController);
addressRouter.put('/update', auth, updateAddressController);
addressRouter.delete('/disable', auth, deleteAddressController);
addressRouter.put('/set-primary', auth, setPrimaryAddressController);

// ===== ADMIN ROUTES =====
const adminRoles = ['IT', 'DIRECTOR', 'LOGISTICS', 'MANAGER'];

// Address verification (admin only)
addressRouter.put(
  '/verify',
  auth,
  requireRole(adminRoles),
  verifyAddressController
);

// Get addresses by shipping zone (admin only)
addressRouter.get(
  '/by-zone',
  auth,
  requireRole(adminRoles),
  getAddressesByZoneController
);

// Get address statistics (admin only)
addressRouter.get(
  '/stats',
  auth,
  requireRole(adminRoles),
  getAddressStatsController
);

export default addressRouter;
