// controllers/shipping.controller.js - Updated with simplified table shipping and LGA coverage
import ShippingZoneModel from '../models/shipping-zone.model.js';
import ShippingMethodModel from '../models/shipping-method.model.js';
import ShippingTrackingModel from '../models/shipping-tracking.model.js';
import OrderModel from '../models/order.model.js';
import ProductModel from '../models/product.model.js';
import { nigeriaStatesLgas } from '../data/nigeria-states-lgas.js';
import mongoose from 'mongoose';

// Helper function to generate unique zone code
const generateZoneCode = async (name) => {
  const baseCode = name.substring(0, 3).toUpperCase();
  let code = baseCode;
  let counter = 1;

  while (await ShippingZoneModel.findOne({ code })) {
    code = baseCode + counter.toString().padStart(2, '0');
    counter++;
  }

  return code;
};

// Helper function to generate unique method code
const generateMethodCode = async (name, type) => {
  const typePrefix = {
    flat_rate: 'FR',
    table_shipping: 'TS',
    pickup: 'PU',
  };

  const nameCode = name.substring(0, 2).toUpperCase();
  const baseCode = `${typePrefix[type] || 'SM'}-${nameCode}`;
  let code = baseCode;
  let counter = 1;

  while (await ShippingMethodModel.findOne({ code })) {
    code = baseCode + counter.toString().padStart(2, '0');
    counter++;
  }

  return code;
};
// ===== SHIPPING ZONES =====

export const createShippingZone = async (request, response) => {
  try {
    const userId = request.user._id;
    const { name, description, states, isActive, sortOrder } = request.body;

    if (!name || !states || states.length === 0) {
      return response.status(400).json({
        message: 'Name and states are required',
        error: true,
        success: false,
      });
    }

    // Auto-generate unique code if not provided
    const code = await generateZoneCode(name);

    const existingZone = await ShippingZoneModel.findOne({ name });
    if (existingZone) {
      return response.status(400).json({
        message: 'Shipping zone with this name already exists',
        error: true,
        success: false,
      });
    }

    // Process states with LGA coverage using Nigeria data
    const processedStates = states.map((state) => {
      // Find state in Nigeria data
      const nigeriaState = nigeriaStatesLgas.find(
        (s) => s.state.toLowerCase() === state.name.toLowerCase()
      );

      if (!nigeriaState) {
        throw new Error(`Invalid state: ${state.name}`);
      }

      return {
        name: nigeriaState.state,
        code: state.code || nigeriaState.state.substring(0, 2).toUpperCase(),
        coverage_type: state.coverage_type || 'all',
        available_lgas: nigeriaState.lga, // Use actual LGA data
        covered_lgas:
          state.coverage_type === 'specific'
            ? state.covered_lgas || []
            : nigeriaState.lga,
      };
    });

    const newZone = new ShippingZoneModel({
      name,
      code,
      description,
      states: processedStates,
      isActive: isActive !== undefined ? isActive : true,
      sortOrder: sortOrder || 0,
      createdBy: userId,
      updatedBy: userId,
    });

    const savedZone = await newZone.save();

    return response.json({
      message: 'Shipping zone created successfully',
      data: savedZone,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getShippingZones = async (request, response) => {
  try {
    const { page = 1, limit = 10, search, isActive } = request.query;

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { 'states.name': { $regex: search, $options: 'i' } },
      ];
    }
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const skip = (page - 1) * limit;

    const [zones, totalCount] = await Promise.all([
      ShippingZoneModel.find(query)
        .populate('createdBy', 'name email')
        .populate('updatedBy', 'name email')
        .sort({ sortOrder: 1, name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ShippingZoneModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Shipping zones retrieved successfully',
      data: zones,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const updateShippingZone = async (request, response) => {
  try {
    const userId = request.user._id;
    const { zoneId } = request.params;
    const { name, code, description, states, isActive, sortOrder } =
      request.body;

    const zone = await ShippingZoneModel.findById(zoneId);
    if (!zone) {
      return response.status(404).json({
        message: 'Shipping zone not found',
        error: true,
        success: false,
      });
    }

    const updateData = { updatedBy: userId };
    if (name) updateData.name = name;
    if (code) updateData.code = code.toUpperCase();
    if (description !== undefined) updateData.description = description;
    if (states) {
      // Process states with LGA coverage
      updateData.states = states.map((state) => ({
        ...state,
        code: state.code || state.name.substring(0, 2).toUpperCase(),
        coverage_type: state.coverage_type || 'all',
        available_lgas: state.available_lgas || [],
        covered_lgas:
          state.coverage_type === 'specific' ? state.covered_lgas || [] : [],
      }));
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const updatedZone = await ShippingZoneModel.findByIdAndUpdate(
      zoneId,
      updateData,
      { new: true }
    ).populate('createdBy updatedBy', 'name email');

    return response.json({
      message: 'Shipping zone updated successfully',
      data: updatedZone,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const deleteShippingZone = async (request, response) => {
  try {
    const { zoneId } = request.params;

    const methodsUsingZone = await ShippingMethodModel.findOne({
      'tableShipping.zoneRates.zone': zoneId,
    });

    if (methodsUsingZone) {
      return response.status(400).json({
        message: 'Cannot delete zone that is being used by shipping methods',
        error: true,
        success: false,
      });
    }

    const deletedZone = await ShippingZoneModel.findByIdAndDelete(zoneId);
    if (!deletedZone) {
      return response.status(404).json({
        message: 'Shipping zone not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Shipping zone deleted successfully',
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// ===== SHIPPING METHODS =====
export const createShippingMethod = async (request, response) => {
  try {
    const userId = request.user._id;
    const methodData = request.body;

    if (!methodData.name || !methodData.code || !methodData.type) {
      return response.status(400).json({
        message: 'Name, code, and type are required',
        error: true,
        success: false,
      });
    }

    // Validate type is one of the three allowed
    if (!['flat_rate', 'table_shipping', 'pickup'].includes(methodData.type)) {
      return response.status(400).json({
        message:
          'Invalid shipping method type. Must be flat_rate, table_shipping, or pickup',
        error: true,
        success: false,
      });
    }

    const existingMethod = await ShippingMethodModel.findOne({
      code: methodData.code.toUpperCase(),
    });

    if (existingMethod) {
      return response.status(400).json({
        message: 'Shipping method with this code already exists',
        error: true,
        success: false,
      });
    }

    // Clean up data based on type to prevent validation errors
    const processedMethodData = {
      ...methodData,
      code: methodData.code.toUpperCase(),
      createdBy: userId,
      updatedBy: userId,
    };

    // Remove unused configurations based on type
    if (methodData.type !== 'pickup') {
      delete processedMethodData.pickup;
    }
    if (methodData.type !== 'flat_rate') {
      delete processedMethodData.flatRate;
    }
    if (methodData.type !== 'table_shipping') {
      delete processedMethodData.tableShipping;
    }

    // Special handling for pickup method
    if (methodData.type === 'pickup' && processedMethodData.pickup) {
      const pickupConfig = processedMethodData.pickup;

      // Clean up zoneLocations - remove empty zones and invalid locations
      if (pickupConfig.zoneLocations) {
        pickupConfig.zoneLocations = pickupConfig.zoneLocations.filter(
          (zoneLocation) => {
            // Remove if no zone selected
            if (!zoneLocation.zone || zoneLocation.zone.trim() === '') {
              return false;
            }

            // Filter out invalid locations within this zone
            if (zoneLocation.locations) {
              zoneLocation.locations = zoneLocation.locations.filter(
                (location) => {
                  return (
                    location.name &&
                    location.name.trim() !== '' &&
                    location.address &&
                    location.address.trim() !== '' &&
                    location.city &&
                    location.city.trim() !== '' &&
                    location.state &&
                    location.state.trim() !== ''
                  );
                }
              );
            }

            // Keep zone location only if it has valid locations
            return zoneLocation.locations && zoneLocation.locations.length > 0;
          }
        );
      }

      // Clean up defaultLocations - remove invalid ones
      if (pickupConfig.defaultLocations) {
        pickupConfig.defaultLocations = pickupConfig.defaultLocations.filter(
          (location) => {
            return (
              location.name &&
              location.name.trim() !== '' &&
              location.address &&
              location.address.trim() !== '' &&
              location.city &&
              location.city.trim() !== '' &&
              location.state &&
              location.state.trim() !== ''
            );
          }
        );
      }

      // Ensure at least one valid location exists (either zone-specific or default)
      const hasZoneLocations =
        pickupConfig.zoneLocations && pickupConfig.zoneLocations.length > 0;
      const hasDefaultLocations =
        pickupConfig.defaultLocations &&
        pickupConfig.defaultLocations.length > 0;

      if (!hasZoneLocations && !hasDefaultLocations) {
        return response.status(400).json({
          message:
            'At least one valid pickup location is required with name, address, city, and state',
          error: true,
          success: false,
        });
      }

      // If no assignment specified, default to all products
      if (!pickupConfig.assignment) {
        pickupConfig.assignment = 'all_products';
      }

      // Clean up categories and products arrays if not using them
      if (pickupConfig.assignment !== 'categories') {
        pickupConfig.categories = [];
      }
      if (pickupConfig.assignment !== 'specific_products') {
        pickupConfig.products = [];
      }
    }

    // Handle flat_rate method
    if (methodData.type === 'flat_rate' && processedMethodData.flatRate) {
      const flatRateConfig = processedMethodData.flatRate;

      // If no assignment specified, default to all products
      if (!flatRateConfig.assignment) {
        flatRateConfig.assignment = 'all_products';
      }

      // Clean up categories and products arrays if not using them
      if (flatRateConfig.assignment !== 'categories') {
        flatRateConfig.categories = [];
      }
      if (flatRateConfig.assignment !== 'specific_products') {
        flatRateConfig.products = [];
      }

      // Clean up zone rates - remove empty zones
      if (flatRateConfig.zoneRates) {
        flatRateConfig.zoneRates = flatRateConfig.zoneRates.filter(
          (zoneRate) => {
            return zoneRate.zone && zoneRate.zone.trim() !== '';
          }
        );
      }
    }

    // Handle table_shipping method
    if (
      methodData.type === 'table_shipping' &&
      processedMethodData.tableShipping
    ) {
      const tableShippingConfig = processedMethodData.tableShipping;

      // If no assignment specified, default to all products
      if (!tableShippingConfig.assignment) {
        tableShippingConfig.assignment = 'all_products';
      }

      // Clean up categories and products arrays if not using them
      if (tableShippingConfig.assignment !== 'categories') {
        tableShippingConfig.categories = [];
      }
      if (tableShippingConfig.assignment !== 'specific_products') {
        tableShippingConfig.products = [];
      }

      // Clean up zone rates - remove empty zones
      if (tableShippingConfig.zoneRates) {
        tableShippingConfig.zoneRates = tableShippingConfig.zoneRates.filter(
          (zoneRate) => {
            return zoneRate.zone && zoneRate.zone.trim() !== '';
          }
        );
      }

      // Validate that at least one zone rate exists for table shipping
      if (
        !tableShippingConfig.zoneRates ||
        tableShippingConfig.zoneRates.length === 0
      ) {
        return response.status(400).json({
          message:
            'At least one zone rate is required for table shipping method',
          error: true,
          success: false,
        });
      }
    }

    const newMethod = new ShippingMethodModel(processedMethodData);
    const savedMethod = await newMethod.save();

    return response.json({
      message: 'Shipping method created successfully',
      data: savedMethod,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Create shipping method error:', error);
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getShippingMethods = async (request, response) => {
  try {
    const { page = 1, limit = 10, search, type, isActive } = request.query;

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }
    if (type) {
      query.type = type;
    }
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const skip = (page - 1) * limit;

    const [methods, totalCount] = await Promise.all([
      ShippingMethodModel.find(query)
        .populate('createdBy', 'name email')
        .populate('updatedBy', 'name email')
        .sort({ sortOrder: 1, name: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ShippingMethodModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Shipping methods retrieved successfully',
      data: methods,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const updateShippingMethod = async (request, response) => {
  try {
    const userId = request.user._id;
    const { methodId } = request.params;
    const updateData = request.body;

    const method = await ShippingMethodModel.findById(methodId);
    if (!method) {
      return response.status(404).json({
        message: 'Shipping method not found',
        error: true,
        success: false,
      });
    }

    if (updateData.code && updateData.code !== method.code) {
      const existingMethod = await ShippingMethodModel.findOne({
        _id: { $ne: methodId },
        code: updateData.code.toUpperCase(),
      });

      if (existingMethod) {
        return response.status(400).json({
          message: 'Another method with this code already exists',
          error: true,
          success: false,
        });
      }
    }

    const finalUpdateData = {
      ...updateData,
      updatedBy: userId,
    };

    if (updateData.code) {
      finalUpdateData.code = updateData.code.toUpperCase();
    }

    // Clean up data based on type to prevent validation errors
    if (method.type !== 'pickup' && updateData.type !== 'pickup') {
      delete finalUpdateData.pickup;
    }
    if (method.type !== 'flat_rate' && updateData.type !== 'flat_rate') {
      delete finalUpdateData.flatRate;
    }
    if (
      method.type !== 'table_shipping' &&
      updateData.type !== 'table_shipping'
    ) {
      delete finalUpdateData.tableShipping;
    }

    const updatedMethod = await ShippingMethodModel.findByIdAndUpdate(
      methodId,
      finalUpdateData,
      { new: true }
    ).populate('createdBy updatedBy', 'name email');

    return response.json({
      message: 'Shipping method updated successfully',
      data: updatedMethod,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const deleteShippingMethod = async (request, response) => {
  try {
    const { methodId } = request.params;

    const ordersUsingMethod = await OrderModel.findOne({
      shippingMethod: methodId,
    });

    if (ordersUsingMethod) {
      return response.status(400).json({
        message: 'Cannot delete shipping method that is being used by orders',
        error: true,
        success: false,
      });
    }

    const deletedMethod = await ShippingMethodModel.findByIdAndDelete(methodId);
    if (!deletedMethod) {
      return response.status(404).json({
        message: 'Shipping method not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Shipping method deleted successfully',
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// ===== CATEGORIES AND PRODUCTS FOR ASSIGNMENT =====

export const getCategoriesForAssignment = async (request, response) => {
  try {
    const { search = '', page = 1, limit = 50 } = request.query;

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;

    const CategoryModel = mongoose.model('category');

    const [categories, totalCount] = await Promise.all([
      CategoryModel.find(query)
        .select('_id name slug')
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      CategoryModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Categories retrieved successfully',
      data: categories,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getProductsForAssignment = async (request, response) => {
  try {
    const { search = '', page = 1, limit = 50, category } = request.query;

    const query = {
      publish: 'PUBLISHED',
    };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
      ];
    }

    if (category) {
      query.category = category;
    }

    const skip = (page - 1) * limit;

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .select('_id name sku productType category weight')
        .populate('category', 'name slug')
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Products retrieved successfully',
      data: products,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// ===== SHIPPING COST CALCULATION - UPDATED FOR SIMPLIFIED TABLE SHIPPING =====

// controllers/shipping.controller.js - Fixed
export const calculateCheckoutShipping = async (request, response) => {
  try {
    const { addressId, items, orderValue, totalWeight } = request.body;

    if (!addressId || !items || items.length === 0) {
      return response.status(400).json({
        message: 'Address ID and items are required',
        error: true,
        success: false,
      });
    }

    // Get address details
    const address = await mongoose
      .model('address')
      .findById(addressId)
      .populate('shipping_zone');

    if (!address) {
      return response.status(404).json({
        message: 'Address not found',
        error: true,
        success: false,
      });
    }

    // FIXED: Enhanced zone finding with state/LGA matching
    let zone = address.shipping_zone;

    if (!zone) {
      // Find zone by state and LGA
      const zones = await ShippingZoneModel.find({ isActive: true });

      for (const testZone of zones) {
        const stateMatch = testZone.states.find(
          (state) => state.name.toLowerCase() === address.state.toLowerCase()
        );

        if (stateMatch) {
          // Check if LGA is covered
          if (
            stateMatch.coverage_type === 'all' ||
            stateMatch.covered_lgas.some(
              (lga) => lga.toLowerCase() === address.lga.toLowerCase()
            )
          ) {
            zone = testZone;

            // Update address with found zone
            await mongoose.model('address').findByIdAndUpdate(addressId, {
              shipping_zone: zone._id,
            });
            break;
          }
        }
      }
    }

    if (!zone) {
      return response.status(400).json({
        message: 'No shipping zone found for your location',
        error: true,
        success: false,
      });
    }

    // Get product details for items
    const productIds = items.map((item) => item.productId || item._id);
    const products = await ProductModel.find({
      _id: { $in: productIds },
      publish: 'PUBLISHED',
      productAvailability: true,
    }).populate('category', 'name slug');

    if (products.length === 0) {
      return response.status(400).json({
        message: 'No valid products found in cart',
        error: true,
        success: false,
      });
    }

    // Extract category IDs
    const categoryIds = [
      ...new Set(products.map((p) => p.category?._id).filter(Boolean)),
    ];

    // Calculate total weight if not provided
    let calculatedWeight = totalWeight || 0;
    if (!calculatedWeight) {
      for (const item of items) {
        const product = products.find(
          (p) => p._id.toString() === (item.productId || item._id).toString()
        );
        if (product && product.weight) {
          calculatedWeight += product.weight * item.quantity;
        } else {
          calculatedWeight += 1 * item.quantity; // Default 1kg per item
        }
      }
    }

    // FIXED: Get all active shipping methods and apply proper filtering
    const shippingMethods = await ShippingMethodModel.find({
      isActive: true,
    }).sort({ sortOrder: 1 });

    const availableMethods = [];

    for (const method of shippingMethods) {
      try {
        // Check if method is currently valid
        if (!method.isCurrentlyValid()) {
          continue;
        }

        // FIXED: Enhanced product/category matching
        let appliesToItems = false;
        const config = method[method.type];

        if (!config) {
          appliesToItems = true; // If no config, apply to all
        } else {
          switch (config.assignment) {
            case 'all_products':
              appliesToItems = true;
              break;
            case 'categories':
              if (!config.categories || config.categories.length === 0) {
                appliesToItems = true; // No categories specified = all products
              } else {
                appliesToItems = categoryIds.some((catId) =>
                  config.categories.some(
                    (methodCatId) => methodCatId.toString() === catId.toString()
                  )
                );
              }
              break;
            case 'specific_products':
              if (!config.products || config.products.length === 0) {
                appliesToItems = true; // No products specified = all products
              } else {
                appliesToItems = productIds.some((prodId) =>
                  config.products.some(
                    (methodProdId) =>
                      methodProdId.toString() === prodId.toString()
                  )
                );
              }
              break;
            default:
              appliesToItems = true;
          }
        }

        if (!appliesToItems) {
          continue;
        }

        // Check if method is available in this zone
        if (!method.isAvailableInZone(zone._id)) {
          continue;
        }

        const calculation = method.calculateShippingCost({
          weight: calculatedWeight,
          orderValue: orderValue || 0,
          zone: zone._id,
          items: items,
        });

        if (calculation.eligible) {
          const methodData = {
            _id: method._id,
            name: method.name,
            code: method.code,
            type: method.type,
            description: method.description,
            cost: calculation.cost,
            estimatedDelivery: method.estimatedDelivery,
            reason: calculation.reason,
          };

          // Add pickup locations for pickup methods
          if (method.type === 'pickup') {
            methodData.pickupLocations = method.getPickupLocationsForZone(
              zone._id
            );
          }

          methodData.zoneInfo = {
            zoneId: zone._id,
            zoneName: zone.name,
            zoneCode: zone.code,
          };

          availableMethods.push(methodData);
        }
      } catch (methodError) {
        console.error(`Error processing method ${method.name}:`, methodError);
        continue;
      }
    }

    // Sort methods by cost (free first, then by price)
    availableMethods.sort((a, b) => {
      if (a.cost === 0 && b.cost !== 0) return -1;
      if (a.cost !== 0 && b.cost === 0) return 1;
      return a.cost - b.cost;
    });

    return response.json({
      message: 'Shipping methods calculated successfully',
      data: {
        zone: {
          _id: zone._id,
          name: zone.name,
          code: zone.code,
          coverage: 'full',
        },
        methods: availableMethods,
        calculatedWeight,
        address: {
          city: address.city,
          state: address.state,
          lga: address.lga,
          country: address.country,
        },
        productCategories: categoryIds.length,
        applicableProducts: products.length,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Error calculating shipping:', error);
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// ===== SHIPMENT MANAGEMENT (KEEPING ORIGINAL TRACKING LOGIC) =====

export const createShipment = async (request, response) => {
  try {
    const userId = request.user._id;
    const {
      orderId,
      trackingNumber,
      carrier,
      estimatedDelivery,
      packageInfo,
      deliveryInstructions,
      priority,
      orderType = 'online',
    } = request.body;

    if (!orderId || !carrier) {
      return response.status(400).json({
        message: 'Order ID and carrier are required',
        error: true,
        success: false,
      });
    }

    const order = await OrderModel.findById(orderId).populate(
      'delivery_address userId'
    );
    if (!order) {
      return response.status(404).json({
        message: 'Order not found',
        error: true,
        success: false,
      });
    }

    const existingTracking = await ShippingTrackingModel.findOne({ orderId });
    if (existingTracking) {
      return response.status(400).json({
        message: 'Tracking already exists for this order',
        error: true,
        success: false,
      });
    }

    if (trackingNumber) {
      const existingTrackingNumber = await ShippingTrackingModel.findOne({
        trackingNumber: trackingNumber.toUpperCase(),
      });
      if (existingTrackingNumber) {
        return response.status(400).json({
          message: 'Tracking number already exists',
          error: true,
          success: false,
        });
      }
    }

    const newTracking = new ShippingTrackingModel({
      orderId,
      trackingNumber: trackingNumber?.toUpperCase(),
      carrier,
      estimatedDelivery,
      packageInfo,
      deliveryInstructions,
      priority: priority || 'NORMAL',
      orderType: orderType,
      deliveryAddress: order.delivery_address
        ? {
            addressLine: order.delivery_address.address_line,
            city: order.delivery_address.city,
            state: order.delivery_address.state,
            postalCode: order.delivery_address.postal_code,
            country: order.delivery_address.country,
          }
        : {},
      recipientInfo: {
        name: order.userId ? order.userId.name : 'Customer',
        phone: order.delivery_address?.mobile,
        email: order.userId ? order.userId.email : '',
      },
      shippingCost: order.shipping_cost || 0,
      createdBy: userId,
      updatedBy: userId,
    });

    const savedTracking = await newTracking.save();

    // Add initial tracking event
    await savedTracking.addTrackingEvent(
      {
        status: 'PENDING',
        description:
          orderType === 'online'
            ? 'Online order confirmed and ready for processing'
            : 'Offline order created and ready for processing',
        location: {
          facility: 'I-Coffee Warehouse',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
        },
      },
      userId
    );

    // Update order with tracking information
    await OrderModel.findByIdAndUpdate(orderId, {
      tracking_number: savedTracking.trackingNumber,
      order_status: 'PROCESSING',
      estimated_delivery: estimatedDelivery,
    });

    const populatedTracking = await ShippingTrackingModel.findById(
      savedTracking._id
    )
      .populate('orderId')
      .populate('createdBy', 'name email');

    return response.json({
      message: 'Shipment created successfully',
      data: populatedTracking,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const updateTracking = async (request, response) => {
  try {
    const userId = request.user._id;
    const { trackingId } = request.params;
    const { status, description, location, estimatedDelivery } = request.body;

    const tracking = await ShippingTrackingModel.findById(trackingId);
    if (!tracking) {
      return response.status(404).json({
        message: 'Tracking not found',
        error: true,
        success: false,
      });
    }

    if (estimatedDelivery) {
      await tracking.updateEstimatedDelivery(
        new Date(estimatedDelivery),
        userId
      );
    }

    if (status && description) {
      await tracking.addTrackingEvent(
        {
          status,
          description,
          location,
        },
        userId
      );

      // Update order status based on tracking status
      let orderStatus = tracking.orderId.order_status;
      switch (status) {
        case 'PROCESSING':
          orderStatus = 'PROCESSING';
          break;
        case 'PICKED_UP':
        case 'IN_TRANSIT':
          orderStatus = 'SHIPPED';
          break;
        case 'DELIVERED':
          orderStatus = 'DELIVERED';
          break;
        case 'RETURNED':
        case 'LOST':
          orderStatus = 'CANCELLED';
          break;
      }

      await OrderModel.findByIdAndUpdate(tracking.orderId, {
        order_status: orderStatus,
        ...(status === 'DELIVERED' && { actual_delivery: new Date() }),
      });
    }

    const updatedTracking = await ShippingTrackingModel.findById(trackingId)
      .populate('orderId')
      .populate('trackingEvents.updatedBy', 'name');

    return response.json({
      message: 'Tracking updated successfully',
      data: updatedTracking,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getTrackingByNumber = async (request, response) => {
  try {
    const { trackingNumber } = request.params;

    const tracking = await ShippingTrackingModel.getByTrackingNumber(
      trackingNumber
    );

    if (!tracking) {
      return response.status(404).json({
        message: 'Tracking number not found',
        error: true,
        success: false,
      });
    }

    const customerVisibleEvents = tracking.trackingEvents.filter(
      (event) => event.isCustomerVisible
    );

    const customerData = {
      trackingNumber: tracking.trackingNumber,
      status: tracking.status,
      estimatedDelivery: tracking.estimatedDelivery,
      actualDelivery: tracking.actualDelivery,
      carrier: tracking.carrier,
      events: customerVisibleEvents,
      deliveryAddress: tracking.deliveryAddress,
      packageInfo: {
        weight: tracking.packageInfo.weight,
        fragile: tracking.packageInfo.fragile,
      },
    };

    return response.json({
      message: 'Tracking information retrieved successfully',
      data: customerData,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getAllTrackings = async (request, response) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      carrier,
      priority,
      overdue,
      search,
    } = request.query;

    const query = {};

    if (status) query.status = status;
    if (carrier) query['carrier.code'] = carrier.toUpperCase();
    if (priority) query.priority = priority;

    if (overdue === 'true') {
      query.estimatedDelivery = { $lt: new Date() };
      query.status = { $nin: ['DELIVERED', 'RETURNED', 'LOST', 'CANCELLED'] };
    }

    if (search) {
      query.$or = [
        { trackingNumber: { $regex: search, $options: 'i' } },
        { 'carrier.name': { $regex: search, $options: 'i' } },
        { 'recipientInfo.name': { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [trackings, totalCount] = await Promise.all([
      ShippingTrackingModel.find(query)
        .populate('orderId', 'orderId payment_status totalAmt')
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ShippingTrackingModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Trackings retrieved successfully',
      data: trackings,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getTrackingStats = async (request, response) => {
  try {
    const stats = await ShippingTrackingModel.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const overdue = await ShippingTrackingModel.countDocuments({
      estimatedDelivery: { $lt: new Date() },
      status: { $nin: ['DELIVERED', 'RETURNED', 'LOST', 'CANCELLED'] },
    });

    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const todayDeliveries = await ShippingTrackingModel.countDocuments({
      actualDelivery: { $gte: startOfDay, $lte: endOfDay },
    });

    const avgDeliveryTime = await ShippingTrackingModel.aggregate([
      { $match: { status: 'DELIVERED', actualDelivery: { $exists: true } } },
      {
        $addFields: {
          deliveryDays: {
            $divide: [
              { $subtract: ['$actualDelivery', '$createdAt'] },
              1000 * 60 * 60 * 24,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgDays: { $avg: '$deliveryDays' },
        },
      },
    ]);

    return response.json({
      message: 'Tracking statistics retrieved successfully',
      data: {
        statusBreakdown: stats,
        overdue,
        todayDeliveries,
        avgDeliveryTime: avgDeliveryTime[0]?.avgDays || 0,
        inTransit:
          stats.find((s) =>
            ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(s._id)
          )?.count || 0,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getPublicShippingMethods = async (request, response) => {
  try {
    const { city, state } = request.query;

    if (!city || !state) {
      return response.status(400).json({
        message: 'City and state are required',
        error: true,
        success: false,
      });
    }

    const zone = await ShippingZoneModel.findZoneByCity(city, state);

    const methods = await ShippingMethodModel.find({ isActive: true })
      .select('name code type description estimatedDelivery')
      .sort({ sortOrder: 1 });

    const publicMethods = methods.map((method) => ({
      _id: method._id,
      name: method.name,
      code: method.code,
      type: method.type,
      description: method.description,
      estimatedDelivery: method.estimatedDelivery,
    }));

    return response.json({
      message: 'Public shipping methods retrieved successfully',
      data: {
        zone: zone
          ? {
              _id: zone._id,
              name: zone.name,
              code: zone.code,
            }
          : null,
        methods: publicMethods,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getOrdersReadyForShipping = async (request, response) => {
  try {
    const { page = 1, limit = 10, status = 'CONFIRMED' } = request.query;

    const query = {
      payment_status: 'PAID',
      order_status: status,
      tracking_number: { $exists: false },
    };

    const skip = (page - 1) * limit;

    const [orders, totalCount] = await Promise.all([
      OrderModel.find(query)
        .populate('delivery_address')
        .populate('userId', 'name email mobile')
        .populate('productId', 'name image weight')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      OrderModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Orders ready for shipping retrieved successfully',
      data: orders,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getShippingDashboardStats = async (request, response) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const [
      readyForShipping,
      inTransit,
      delivered,
      overdue,
      todayShipments,
      todayDeliveries,
      totalZones,
      totalMethods,
    ] = await Promise.all([
      OrderModel.countDocuments({
        payment_status: 'PAID',
        order_status: 'CONFIRMED',
        tracking_number: { $exists: false },
      }),
      ShippingTrackingModel.countDocuments({
        status: { $in: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] },
      }),
      ShippingTrackingModel.countDocuments({
        status: 'DELIVERED',
      }),
      ShippingTrackingModel.countDocuments({
        estimatedDelivery: { $lt: new Date() },
        status: { $nin: ['DELIVERED', 'RETURNED', 'LOST', 'CANCELLED'] },
      }),
      ShippingTrackingModel.countDocuments({
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      }),
      ShippingTrackingModel.countDocuments({
        actualDelivery: { $gte: startOfDay, $lte: endOfDay },
      }),
      ShippingZoneModel.countDocuments({ isActive: true }),
      ShippingMethodModel.countDocuments({ isActive: true }),
    ]);

    return response.json({
      message: 'Shipping dashboard stats retrieved successfully',
      data: {
        readyForShipping,
        inTransit,
        delivered,
        overdue,
        todayShipments,
        todayDeliveries,
        totalZones,
        totalMethods,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
