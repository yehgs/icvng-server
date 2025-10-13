// controllers/exchangeRate.controller.js
import ExchangeRateModel from '../models/exchange-rate.model.js';
import axios from 'axios';

// Free API providers configuration
const API_PROVIDERS = {
  'exchangerate.host': {
    name: 'ExchangeRate.host',
    baseUrl: 'https://api.exchangerate.host',
    requiresKey: false,
    getRatesUrl: (base) => `https://api.exchangerate.host/latest?base=${base}`,
    parseResponse: (data) => data.rates,
  },
  // 'fixer.io': {
  //   name: 'Fixer.io',
  //   baseUrl: 'http://data.fixer.io/api',
  //   requiresKey: true,
  //   getRatesUrl: (base) =>
  //     `http://data.fixer.io/api/latest?access_key=${process.env.FIXER_API_KEY}&base=${base}`,
  //   parseResponse: (data) => data.rates,
  // },
  // 'currencyapi.com': {
  //   name: 'CurrencyAPI.com',
  //   baseUrl: 'https://api.currencyapi.com/v3',
  //   requiresKey: true,
  //   getRatesUrl: (base) =>
  //     `https://api.currencyapi.com/v3/latest?apikey=${process.env.CURRENCYAPI_KEY}&base_currency=${base}`,
  //   parseResponse: (data) => {
  //     // Convert CurrencyAPI format to standard format
  //     const rates = {};
  //     if (data.data) {
  //       Object.keys(data.data).forEach((currency) => {
  //         rates[currency] = data.data[currency].value;
  //       });
  //     }
  //     return rates;
  //   },
  // },
  // 'exchangeratesapi.io': {
  //   name: 'ExchangeRatesAPI.io',
  //   baseUrl: 'https://api.exchangeratesapi.io/v1',
  //   requiresKey: true,
  //   getRatesUrl: (base) =>
  //     `https://api.exchangeratesapi.io/v1/latest?access_key=${process.env.EXCHANGERATES_API_KEY}&base=${base}`,
  //   parseResponse: (data) => data.rates,
  // },
  // 'freecurrencyapi.net': {
  //   name: 'FreeCurrencyAPI.net',
  //   baseUrl: 'https://api.freecurrencyapi.net/v1',
  //   requiresKey: true,
  //   getRatesUrl: (base) =>
  //     `https://api.freecurrencyapi.net/v1/latest?apikey=${process.env.FREECURRENCY_API_KEY}&base_currency=${base}`,
  //   parseResponse: (data) => data.data,
  // },
};

// Fallback rates for common currencies (updated weekly)
const FALLBACK_RATES = {
  USD: {
    EUR: 0.85,
    GBP: 0.73,
    JPY: 110.0,
    CAD: 1.25,
    AUD: 1.35,
    CHF: 0.92,
    CNY: 6.45,
    NGN: 460.0,
    ZAR: 15.0,
    INR: 75.0,
    BRL: 5.2,
  },
  EUR: {
    USD: 1.18,
    GBP: 0.86,
    JPY: 129.5,
    CAD: 1.47,
    AUD: 1.59,
    CHF: 1.08,
    CNY: 7.6,
    NGN: 541.2,
    ZAR: 17.65,
    INR: 88.35,
    BRL: 6.12,
  },
  NGN: {
    USD: 0.00217, // 1 / 460
    EUR: 0.00185, // 1 / 541.2
    GBP: 0.00159,
    JPY: 0.239,
    CAD: 0.00272,
    AUD: 0.00293,
    CHF: 0.00217,
    CNY: 0.014,
    ZAR: 0.0667,
    INR: 0.0173,
    BRL: 0.0121,
  },
};

// Fetch rates from external API with multiple provider support
export const fetchRatesFromAPI = async (request, response) => {
  try {
    const { baseCurrency = 'NGN', provider = 'exchangerate.host' } =
      request.body;
    const base = baseCurrency.toUpperCase();

    // List of providers to try in order
    const providersToTry = [
      provider,
      'exchangerate.host', // Always try this as primary fallback
      // 'fixer.io',
      // 'currencyapi.com',
      // 'exchangeratesapi.io',
      // 'freecurrencyapi.net',
    ].filter((p, index, arr) => arr.indexOf(p) === index); // Remove duplicates

    let rates = null;
    let usedProvider = null;
    let errors = [];

    // Try each provider until one works
    for (const providerKey of providersToTry) {
      const apiConfig = API_PROVIDERS[providerKey];

      if (!apiConfig) {
        errors.push(`Unknown provider: ${providerKey}`);
        continue;
      }

      // Skip providers that require API keys if not configured
      if (apiConfig.requiresKey) {
        const keyNames = {
          'fixer.io': 'FIXER_API_KEY',
          'currencyapi.com': 'CURRENCYAPI_KEY',
          'exchangeratesapi.io': 'EXCHANGERATES_API_KEY',
          'freecurrencyapi.net': 'FREECURRENCY_API_KEY',
        };

        const keyName = keyNames[providerKey];
        if (!process.env[keyName]) {
          errors.push(`${apiConfig.name}: API key not configured (${keyName})`);
          continue;
        }
      }

      try {
        console.log(`Trying ${apiConfig.name}...`);
        const apiUrl = apiConfig.getRatesUrl(base);

        const apiResponse = await axios.get(apiUrl, {
          timeout: 10000, // 10 second timeout
          headers: {
            'User-Agent': 'Exchange Rate Service/1.0',
          },
        });

        if (apiResponse.data && apiResponse.data.success !== false) {
          rates = apiConfig.parseResponse(apiResponse.data);

          if (rates && Object.keys(rates).length > 0) {
            usedProvider = providerKey;
            console.log(`Successfully fetched rates from ${apiConfig.name}`);
            break;
          } else {
            errors.push(`${apiConfig.name}: Empty or invalid rates data`);
          }
        } else {
          errors.push(
            `${apiConfig.name}: API returned error - ${
              apiResponse.data?.error?.info || 'Unknown error'
            }`
          );
        }
      } catch (error) {
        const errorMsg =
          error.response?.data?.error?.info ||
          error.response?.data?.message ||
          error.message ||
          'Unknown error';
        errors.push(`${apiConfig.name}: ${errorMsg}`);
        console.error(`Error fetching from ${apiConfig.name}:`, errorMsg);
      }
    }

    // If all APIs failed, use fallback rates
    // if (!rates && FALLBACK_RATES[base]) {
    //   rates = FALLBACK_RATES[base];
    //   usedProvider = 'fallback';
    //   console.log('Using fallback rates');
    // }

    if (!rates) {
      return response.status(500).json({
        message: 'All exchange rate providers failed',
        errors: errors,
        error: true,
        success: false,
      });
    }

    const updatedRates = [];

    // Update database with fetched rates
    for (const [currency, rate] of Object.entries(rates)) {
      if (currency.toUpperCase() !== base) {
        try {
          const updatedRate = await ExchangeRateModel.findOneAndUpdate(
            {
              baseCurrency: base,
              targetCurrency: currency.toUpperCase(),
            },
            {
              rate: parseFloat(rate),
              source: 'API',
              lastUpdated: new Date(),
              apiProvider: usedProvider,
              isActive: true,
            },
            {
              upsert: true,
              new: true,
            }
          );

          updatedRates.push(updatedRate);
        } catch (dbError) {
          console.error(
            `Error updating rate for ${currency}:`,
            dbError.message
          );
        }
      }
    }

    return response.json({
      message: `Successfully updated ${
        updatedRates.length
      } exchange rates from ${
        usedProvider === 'fallback'
          ? 'fallback data'
          : API_PROVIDERS[usedProvider]?.name
      }`,
      data: updatedRates,
      provider: usedProvider,
      errors: errors.length > 0 ? errors : undefined,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Error in fetchRatesFromAPI:', error.message);
    return response.status(500).json({
      message: error.message || 'Failed to fetch rates from API',
      error: true,
      success: false,
    });
  }
};

// Get all exchange rates
export const getExchangeRates = async (request, response) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      baseCurrency,
      targetCurrency,
      source,
    } = request.query;

    const query = { isActive: true };

    if (search) {
      query.$or = [
        { baseCurrency: { $regex: search, $options: 'i' } },
        { targetCurrency: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } },
      ];
    }

    if (baseCurrency) {
      query.baseCurrency = baseCurrency.toUpperCase();
    }

    if (targetCurrency) {
      query.targetCurrency = targetCurrency.toUpperCase();
    }

    if (source) {
      query.source = source.toUpperCase();
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [rates, totalCount] = await Promise.all([
      ExchangeRateModel.find(query)
        .populate('updatedBy', 'name email')
        .sort({ lastUpdated: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ExchangeRateModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Exchange rates retrieved successfully',
      data: rates,
      totalCount,
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Failed to retrieve exchange rates',
      error: true,
      success: false,
    });
  }
};

// Create or update manual exchange rate
export const createOrUpdateRate = async (request, response) => {
  try {
    const { baseCurrency, targetCurrency, rate, notes } = request.body;

    if (!baseCurrency || !targetCurrency || !rate) {
      return response.status(400).json({
        message: 'Base currency, target currency, and rate are required',
        error: true,
        success: false,
      });
    }

    if (baseCurrency.toUpperCase() === targetCurrency.toUpperCase()) {
      return response.status(400).json({
        message: 'Base currency and target currency cannot be the same',
        error: true,
        success: false,
      });
    }

    if (parseFloat(rate) <= 0) {
      return response.status(400).json({
        message: 'Rate must be greater than 0',
        error: true,
        success: false,
      });
    }

    const exchangeRate = await ExchangeRateModel.findOneAndUpdate(
      {
        baseCurrency: baseCurrency.toUpperCase(),
        targetCurrency: targetCurrency.toUpperCase(),
      },
      {
        rate: parseFloat(rate),
        source: 'MANUAL',
        lastUpdated: new Date(),
        updatedBy: request.user._id,
        notes: notes || '',
        isActive: true,
        apiProvider: 'manual',
      },
      {
        upsert: true,
        new: true,
      }
    ).populate('updatedBy', 'name email');

    return response.json({
      message: 'Exchange rate updated successfully',
      data: exchangeRate,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Failed to update exchange rate',
      error: true,
      success: false,
    });
  }
};

// Get specific exchange rate
export const getSpecificRate = async (request, response) => {
  try {
    const { baseCurrency, targetCurrency } = request.params;

    const rate = await ExchangeRateModel.getRate(baseCurrency, targetCurrency);

    if (!rate) {
      return response.status(404).json({
        message: 'Exchange rate not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Exchange rate retrieved successfully',
      data: {
        rate,
        from: baseCurrency.toUpperCase(),
        to: targetCurrency.toUpperCase(),
      },
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Failed to retrieve exchange rate',
      error: true,
      success: false,
    });
  }
};

// Delete exchange rate
export const deleteExchangeRate = async (request, response) => {
  try {
    const { rateId } = request.body;

    if (!rateId) {
      return response.status(400).json({
        message: 'Rate ID is required',
        error: true,
        success: false,
      });
    }

    const deletedRate = await ExchangeRateModel.findByIdAndUpdate(
      rateId,
      { isActive: false },
      { new: true }
    );

    if (!deletedRate) {
      return response.status(404).json({
        message: 'Exchange rate not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Exchange rate deleted successfully',
      data: deletedRate,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Failed to delete exchange rate',
      error: true,
      success: false,
    });
  }
};

// Get supported currencies
export const getSupportedCurrencies = async (request, response) => {
  try {
    // Extended list of common currencies
    const supportedCurrencies = [
      { code: 'USD', name: 'US Dollar', symbol: '$' },
      { code: 'EUR', name: 'Euro', symbol: '€' },
      { code: 'GBP', name: 'British Pound', symbol: '£' },
      { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
      { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
      { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
      { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
      { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
      { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
      { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
      { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
      { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
      { code: 'RUB', name: 'Russian Ruble', symbol: '₽' },
      { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
      { code: 'MXN', name: 'Mexican Peso', symbol: '$' },
      { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
      { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
      { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
      { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
      { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
      { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
      { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
      { code: 'ILS', name: 'Israeli Shekel', symbol: '₪' },
      { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
      { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
    ];

    return response.json({
      message: 'Supported currencies retrieved successfully',
      data: supportedCurrencies,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Failed to retrieve supported currencies',
      error: true,
      success: false,
    });
  }
};

// Convert amount between currencies
export const convertCurrency = async (request, response) => {
  try {
    const { amount, fromCurrency, toCurrency } = request.body;

    if (!amount || !fromCurrency || !toCurrency) {
      return response.status(400).json({
        message: 'Amount, from currency, and to currency are required',
        error: true,
        success: false,
      });
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return response.status(400).json({
        message: 'Amount must be a positive number',
        error: true,
        success: false,
      });
    }

    if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) {
      return response.json({
        message: 'Currency conversion completed',
        data: {
          originalAmount: numAmount,
          convertedAmount: numAmount,
          fromCurrency: fromCurrency.toUpperCase(),
          toCurrency: toCurrency.toUpperCase(),
          rate: 1,
        },
        error: false,
        success: true,
      });
    }

    const rate = await ExchangeRateModel.getRate(fromCurrency, toCurrency);

    if (!rate) {
      return response.status(404).json({
        message: `Exchange rate not found for ${fromCurrency.toUpperCase()} to ${toCurrency.toUpperCase()}`,
        error: true,
        success: false,
      });
    }

    const convertedAmount = numAmount * rate;

    return response.json({
      message: 'Currency conversion completed',
      data: {
        originalAmount: numAmount,
        convertedAmount: parseFloat(convertedAmount.toFixed(2)),
        fromCurrency: fromCurrency.toUpperCase(),
        toCurrency: toCurrency.toUpperCase(),
        rate: rate,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Failed to convert currency',
      error: true,
      success: false,
    });
  }
};

// Additional methods to add to your exchangeRate.controller.js

// Get exchange rate statistics
export const getStats = async (request, response) => {
  try {
    const stats = await ExchangeRateModel.getRateStats();

    return response.json({
      message: 'Statistics retrieved successfully',
      data: stats,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Failed to retrieve statistics',
      error: true,
      success: false,
    });
  }
};

// Get stale rates that need updating
export const getStaleRates = async (request, response) => {
  try {
    const { hours = 24 } = request.query;

    const staleRates = await ExchangeRateModel.getStaleRates(parseInt(hours));

    return response.json({
      message: 'Stale rates retrieved successfully',
      data: staleRates,
      count: staleRates.length,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Failed to retrieve stale rates',
      error: true,
      success: false,
    });
  }
};

// Bulk update multiple rates
export const bulkUpdateRates = async (request, response) => {
  try {
    const { rates } = request.body;

    if (!rates || !Array.isArray(rates) || rates.length === 0) {
      return response.status(400).json({
        message: 'Rates array is required and must not be empty',
        error: true,
        success: false,
      });
    }

    const updatedRates = [];
    const errors = [];

    for (const rateData of rates) {
      try {
        const {
          baseCurrency,
          targetCurrency,
          rate,
          source = 'MANUAL',
          notes = '',
        } = rateData;

        if (!baseCurrency || !targetCurrency || !rate) {
          errors.push(
            `Missing required fields for ${baseCurrency}-${targetCurrency}`
          );
          continue;
        }

        const updatedRate = await ExchangeRateModel.findOneAndUpdate(
          {
            baseCurrency: baseCurrency.toUpperCase(),
            targetCurrency: targetCurrency.toUpperCase(),
          },
          {
            rate: parseFloat(rate),
            source: source,
            lastUpdated: new Date(),
            updatedBy: request.user._id,
            notes: notes,
            isActive: true,
          },
          {
            upsert: true,
            new: true,
          }
        );

        updatedRates.push(updatedRate);
      } catch (error) {
        errors.push(
          `Error updating ${rateData.baseCurrency}-${rateData.targetCurrency}: ${error.message}`
        );
      }
    }

    return response.json({
      message: `Successfully updated ${updatedRates.length} rates`,
      data: updatedRates,
      errors: errors.length > 0 ? errors : undefined,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Failed to bulk update rates',
      error: true,
      success: false,
    });
  }
};
