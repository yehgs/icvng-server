// route/exchangeRate.route.js
// PHASE 1 SECURITY: exchange-rate management is HQ-only.
// `GET /get` stays PUBLIC — the storefront CurrencyContext depends on it for
// price display (read-only, non-sensitive published rates).
// Every other endpoint (create/update/delete/fetch/convert/stats) was `auth`
// alone; now ADMIN-only, role-restricted, blocked for country-scoped admins.
import { Router } from 'express';
import auth from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { countryScope, blockCountryScopedAdmins } from '../middleware/countryScope.js';
import {
  fetchRatesFromAPI,
  getExchangeRates,
  createOrUpdateRate,
  getSpecificRate,
  deleteExchangeRate,
  getSupportedCurrencies,
  convertCurrency,
  getStats,
  getStaleRates,
  bulkUpdateRates,
} from '../controllers/exchangeRate.controller.js';

const exchangeRateRouter = Router();

// Get all exchange rates (PUBLIC — client storefront currency display)
exchangeRateRouter.get('/get', getExchangeRates);

// Everything below is HQ admin territory
exchangeRateRouter.use(
  auth,
  adminAuth,
  countryScope,
  blockCountryScopedAdmins,
  requirePermission(["exchangeRates.view", "exchangeRates.manage"])
);

// Get supported currencies list
exchangeRateRouter.get('/currencies', getSupportedCurrencies);

// Get exchange rate statistics
exchangeRateRouter.get('/stats', getStats);

// Get stale rates that need updating
exchangeRateRouter.get('/stale', getStaleRates);

// Get specific exchange rate between two currencies
exchangeRateRouter.get('/rate/:baseCurrency/:targetCurrency', getSpecificRate);

// Fetch rates from external API with multiple provider support
exchangeRateRouter.post('/fetch-api-rates', fetchRatesFromAPI);

// Create or update manual exchange rate
exchangeRateRouter.post('/create-update', createOrUpdateRate);

// Convert currency using stored rates
exchangeRateRouter.post('/convert', convertCurrency);

// Bulk update multiple rates
exchangeRateRouter.post('/bulk-update', bulkUpdateRates);

// Delete exchange rate (soft delete)
exchangeRateRouter.delete('/delete', deleteExchangeRate);

export default exchangeRateRouter;
