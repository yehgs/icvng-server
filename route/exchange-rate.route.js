// route/exchangeRate.route.js - Updated with new endpoints
import { Router } from 'express';
import auth from '../middleware/auth.js';
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

// Get all exchange rates with pagination and search
exchangeRateRouter.get('/get', auth, getExchangeRates);

// Get supported currencies list
exchangeRateRouter.get('/currencies', auth, getSupportedCurrencies);

// Get exchange rate statistics
exchangeRateRouter.get('/stats', auth, getStats);

// Get stale rates that need updating
exchangeRateRouter.get('/stale', auth, getStaleRates);

// Get specific exchange rate between two currencies
exchangeRateRouter.get(
  '/rate/:baseCurrency/:targetCurrency',
  auth,
  getSpecificRate
);

// Fetch rates from external API with multiple provider support
exchangeRateRouter.post('/fetch-api-rates', auth, fetchRatesFromAPI);

// Create or update manual exchange rate
exchangeRateRouter.post('/create-update', auth, createOrUpdateRate);

// Convert currency using stored rates
exchangeRateRouter.post('/convert', auth, convertCurrency);

// Bulk update multiple rates
exchangeRateRouter.post('/bulk-update', auth, bulkUpdateRates);

// Delete exchange rate (soft delete)
exchangeRateRouter.delete('/delete', auth, deleteExchangeRate);

export default exchangeRateRouter;
