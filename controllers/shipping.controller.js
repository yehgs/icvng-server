// controllers/shipping.controller.js - Updated with simplified table shipping and LGA coverage
import ShippingZoneModel from "../models/shipping-zone.model.js";
import ShippingMethodModel from "../models/shipping-method.model.js";
import ShippingTrackingModel from "../models/shipping-tracking.model.js";
import OrderModel from "../models/order.model.js";
import ProductModel from "../models/product.model.js";
import { nigeriaStatesLgas } from "../data/nigeria-states-lgas.js";
import mongoose from "mongoose";

// Helper function to generate unique zone code

async function generateZoneCode(name) {
  const words = name.trim().split(/\s+/);

  let baseCode;
  if (words.length === 1) {
    baseCode = words[0].substring(0, 3).toUpperCase();
  } else {
    baseCode = words
      .slice(0, 3)
      .map((word) => word.charAt(0).toUpperCase())
      .join("");
  }

  if (baseCode.length < 2) {
    baseCode = baseCode.padEnd(2, "Z");
  }

  let code = baseCode;
  let counter = 1;

  while (await ShippingZoneModel.findOne({ code })) {
    code = `${baseCode}${counter}`;
    counter++;

    if (counter > 999) {
      throw new Error("Unable to generate unique zone code");
    }
  }

  return code;
}

// Helper function to generate unique method code
const generateMethodCode = async (name, type) => {
  const typePrefix = {
    flat_rate: "FR",
    table_shipping: "TS",
    pickup: "PU",
  };

  const nameCode = name.substring(0, 2).toUpperCase();
  const baseCode = `${typePrefix[type] || "SM"}-${nameCode}`;
  let code = baseCode;
  let counter = 1;

  while (await ShippingMethodModel.findOne({ code })) {
    code = baseCode + counter.toString().padStart(2, "0");
    counter++;
  }

  return code;
};

// Helper function to generate unique tracking number
const generateTrackingNumber = async () => {
  const prefix = "ICF";
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Generate 6 random digits
    const digits = Math.floor(100000 + Math.random() * 900000).toString();

    // Generate 3 random uppercase letters
    const letters = Array.from({ length: 3 }, () =>
      String.fromCharCode(65 + Math.floor(Math.random() * 26))
    ).join("");

    const trackingNumber = `${prefix}${digits}${letters}`;

    // Check if tracking number already exists
    const existing = await ShippingTrackingModel.findOne({
      trackingNumber: trackingNumber,
    });

    if (!existing) {
      return trackingNumber;
    }

    console.log(
      `Tracking number ${trackingNumber} already exists, retrying...`
    );
  }

  throw new Error(
    "Unable to generate unique tracking number after multiple attempts"
  );
};

// ===== SHIPPING ZONES =====

export const createShippingZone = async (request, response) => {
  try {
    const userId = request.user._id;
    const {
      name,
      description,
      states,
      isActive,
      sortOrder,
      zone_type,
      priority,
      operational_notes,
    } = request.body;

    console.log("=== CREATE SHIPPING ZONE ===");
    console.log("Request body:", JSON.stringify(request.body, null, 2));

    // Validate required fields
    if (!name || !name.trim()) {
      return response.status(400).json({
        message: "Zone name is required",
        error: true,
        success: false,
      });
    }

    if (!states || !Array.isArray(states) || states.length === 0) {
      return response.status(400).json({
        message: "At least one state is required",
        error: true,
        success: false,
      });
    }

    // Check for duplicate zone name
    const existingZone = await ShippingZoneModel.findOne({
      name: name.trim(),
    });

    if (existingZone) {
      return response.status(400).json({
        message: "Shipping zone with this name already exists",
        error: true,
        success: false,
      });
    }

    // Auto-generate unique code
    const code = await generateZoneCode(name);
    console.log("Generated zone code:", code);

    // Process and validate states
    const processedStates = [];
    const seenStates = new Set();

    for (const state of states) {
      console.log("Processing state:", state);

      // Check for duplicate states
      if (seenStates.has(state.name.toLowerCase())) {
        return response.status(400).json({
          message: `Duplicate state: ${state.name}`,
          error: true,
          success: false,
        });
      }
      seenStates.add(state.name.toLowerCase());

      // Validate against Nigeria data
      const nigeriaState = nigeriaStatesLgas.find(
        (s) => s.state.toLowerCase() === state.name.toLowerCase()
      );

      if (!nigeriaState) {
        return response.status(400).json({
          message: `Invalid Nigerian state: ${state.name}`,
          error: true,
          success: false,
        });
      }

      // Process covered LGAs
      let processedCoveredLgas = [];

      if (state.coverage_type === "specific") {
        if (!state.covered_lgas || state.covered_lgas.length === 0) {
          return response.status(400).json({
            message: `Please select at least one LGA for ${state.name} or change coverage to 'All LGAs'`,
            error: true,
            success: false,
          });
        }

        // Convert covered_lgas to string array
        processedCoveredLgas = state.covered_lgas
          .map((lga) => {
            if (typeof lga === "string") return lga.trim();
            if (lga && typeof lga === "object" && lga.name)
              return lga.name.trim();
            return null;
          })
          .filter(Boolean);

        // Validate all covered LGAs exist
        const invalidLgas = processedCoveredLgas.filter(
          (lgaName) => !nigeriaState.lga.includes(lgaName)
        );

        if (invalidLgas.length > 0) {
          return response.status(400).json({
            message: `Invalid LGAs for ${state.name}: ${invalidLgas.join(
              ", "
            )}`,
            error: true,
            success: false,
          });
        }
      }

      processedStates.push({
        name: nigeriaState.state,
        code: state.code || nigeriaState.state.substring(0, 2).toUpperCase(),
        coverage_type: state.coverage_type || "all",
        available_lgas: [...nigeriaState.lga],
        covered_lgas:
          state.coverage_type === "specific" ? processedCoveredLgas : [],
      });
    }

    console.log("Processed states:", JSON.stringify(processedStates, null, 2));

    // Create new zone
    const newZone = new ShippingZoneModel({
      name: name.trim(),
      code,
      description: description?.trim() || "",
      states: processedStates,
      zone_type: zone_type || "mixed",
      priority: priority || "medium",
      isActive: isActive !== undefined ? isActive : true,
      sortOrder: sortOrder || 0,
      operational_notes: operational_notes?.trim() || "",
      createdBy: userId,
      updatedBy: userId,
    });

    const savedZone = await newZone.save();
    console.log("Zone created successfully:", savedZone._id);

    return response.json({
      message: "Shipping zone created successfully",
      data: savedZone,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Create shipping zone error:", error);
    return response.status(500).json({
      message: error.message || "Failed to create shipping zone",
      error: true,
      success: false,
    });
  }
};

// controllers/shipping.controller.js - updateShippingZone
export const updateShippingZone = async (request, response) => {
  try {
    const userId = request.user._id;
    const { zoneId } = request.params;
    const {
      name,
      description,
      states,
      isActive,
      sortOrder,
      zone_type,
      priority,
      operational_notes,
    } = request.body;

    console.log("=== UPDATE SHIPPING ZONE ===");
    console.log("Zone ID:", zoneId);
    console.log("Update data:", JSON.stringify(request.body, null, 2));

    const zone = await ShippingZoneModel.findById(zoneId);
    if (!zone) {
      return response.status(404).json({
        message: "Shipping zone not found",
        error: true,
        success: false,
      });
    }

    const updateData = { updatedBy: userId };

    // Update basic fields
    if (name) {
      updateData.name = name.trim();

      // Check for duplicate name (excluding current zone)
      if (name.trim() !== zone.name) {
        const existingZone = await ShippingZoneModel.findOne({
          _id: { $ne: zoneId },
          name: name.trim(),
        });

        if (existingZone) {
          return response.status(400).json({
            message: "A zone with this name already exists",
            error: true,
            success: false,
          });
        }
      }
    }

    if (description !== undefined)
      updateData.description = description?.trim() || "";
    if (isActive !== undefined) updateData.isActive = isActive;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if (zone_type) updateData.zone_type = zone_type;
    if (priority) updateData.priority = priority;
    if (operational_notes !== undefined)
      updateData.operational_notes = operational_notes?.trim() || "";

    // Process states if provided
    if (states && Array.isArray(states)) {
      const processedStates = [];

      for (const state of states) {
        const nigeriaState = nigeriaStatesLgas.find(
          (s) => s.state.toLowerCase() === state.name.toLowerCase()
        );

        if (!nigeriaState) {
          throw new Error(`Invalid state: ${state.name}`);
        }

        // Process covered LGAs
        let processedCoveredLgas = [];

        if (state.coverage_type === "specific") {
          if (!state.covered_lgas || state.covered_lgas.length === 0) {
            return response.status(400).json({
              message: `Please select at least one LGA for ${state.name} or change coverage to 'All LGAs'`,
              error: true,
              success: false,
            });
          }

          processedCoveredLgas = state.covered_lgas
            .map((lga) => {
              if (typeof lga === "string") return lga.trim();
              if (lga && typeof lga === "object" && lga.name)
                return lga.name.trim();
              return null;
            })
            .filter(Boolean);

          // Validate all covered LGAs exist
          const invalidLgas = processedCoveredLgas.filter(
            (lgaName) => !nigeriaState.lga.includes(lgaName)
          );

          if (invalidLgas.length > 0) {
            throw new Error(
              `Invalid LGAs for ${state.name}: ${invalidLgas.join(", ")}`
            );
          }
        }

        processedStates.push({
          name: nigeriaState.state,
          code: state.code || nigeriaState.state.substring(0, 2).toUpperCase(),
          coverage_type: state.coverage_type || "all",
          available_lgas: [...nigeriaState.lga],
          covered_lgas:
            state.coverage_type === "specific" ? processedCoveredLgas : [],
        });
      }

      updateData.states = processedStates;
      console.log(
        "Processed states for update:",
        JSON.stringify(processedStates, null, 2)
      );
    }

    const updatedZone = await ShippingZoneModel.findByIdAndUpdate(
      zoneId,
      updateData,
      { new: true, runValidators: true }
    ).populate("createdBy updatedBy", "name email");

    console.log("Zone updated successfully:", updatedZone._id);

    return response.json({
      message: "Shipping zone updated successfully",
      data: updatedZone,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Update shipping zone error:", error);
    return response.status(500).json({
      message: error.message || "Failed to update shipping zone",
      error: true,
      success: false,
    });
  }
};

// Add this new function before deleteShippingZone
export const getZoneDependencies = async (request, response) => {
  try {
    const { zoneId } = request.params;

    // Find zone
    const zone = await ShippingZoneModel.findById(zoneId);
    if (!zone) {
      return response.status(404).json({
        message: "Shipping zone not found",
        error: true,
        success: false,
      });
    }

    // Find all methods using this zone
    const methodsUsingZone = await ShippingMethodModel.find({
      $or: [
        { "tableShipping.zoneRates.zone": zoneId },
        { "flatRate.zoneRates.zone": zoneId },
        { "pickup.zoneLocations.zone": zoneId },
      ],
    }).select("_id name code type description isActive");

    return response.json({
      message: "Zone dependencies retrieved successfully",
      data: {
        zone: {
          _id: zone._id,
          name: zone.name,
          code: zone.code,
        },
        dependentMethods: methodsUsingZone,
        hasDependencies: methodsUsingZone.length > 0,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get zone dependencies error:", error);
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Update deleteShippingZone to support cascade deletion
export const deleteShippingZone = async (request, response) => {
  try {
    const { zoneId } = request.params;
    const { cascadeDelete } = request.query; // New parameter

    // Find zone first
    const zone = await ShippingZoneModel.findById(zoneId);
    if (!zone) {
      return response.status(404).json({
        message: "Shipping zone not found",
        error: true,
        success: false,
      });
    }

    // Check if zone is being used in any shipping method
    const methodsUsingZone = await ShippingMethodModel.find({
      $or: [
        { "tableShipping.zoneRates.zone": zoneId },
        { "flatRate.zoneRates.zone": zoneId },
        { "pickup.zoneLocations.zone": zoneId },
      ],
    });

    if (methodsUsingZone.length > 0) {
      // If cascade delete is requested, delete all dependent methods first
      if (cascadeDelete === "true") {
        console.log(
          `Cascade deleting ${methodsUsingZone.length} shipping methods...`
        );

        // Delete all dependent methods
        const deletedMethodIds = [];
        for (const method of methodsUsingZone) {
          await ShippingMethodModel.findByIdAndDelete(method._id);
          deletedMethodIds.push(method._id);
          console.log(`Deleted method: ${method.name} (${method.code})`);
        }

        // Now delete the zone
        const deletedZone = await ShippingZoneModel.findByIdAndDelete(zoneId);

        return response.json({
          message: `Zone and ${methodsUsingZone.length} dependent shipping method(s) deleted successfully`,
          data: {
            deletedZone,
            deletedMethods: methodsUsingZone.map((m) => ({
              _id: m._id,
              name: m.name,
              code: m.code,
            })),
          },
          error: false,
          success: true,
        });
      }

      // If cascade delete not requested, return error with dependent methods
      return response.status(400).json({
        message: `Cannot delete zone. It is being used by ${methodsUsingZone.length} shipping method(s).`,
        error: true,
        success: false,
        data: {
          methodNames: methodsUsingZone.map((m) => m.name),
          methodCodes: methodsUsingZone.map((m) => m.code),
          methodCount: methodsUsingZone.length,
          dependentMethods: methodsUsingZone.map((m) => ({
            _id: m._id,
            name: m.name,
            code: m.code,
            type: m.type,
            isActive: m.isActive,
          })),
        },
      });
    }

    // No dependencies, safe to delete
    const deletedZone = await ShippingZoneModel.findByIdAndDelete(zoneId);

    return response.json({
      message: "Shipping zone deleted successfully",
      data: deletedZone,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Delete shipping zone error:", error);
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

    console.log("=== CREATE SHIPPING METHOD ===");
    console.log("Received method data:", {
      name: methodData.name,
      type: methodData.type,
      hasPickup: !!methodData.pickup,
      hasFlatRate: !!methodData.flatRate,
      hasTableShipping: !!methodData.tableShipping,
    });

    // Validate basic required fields
    if (!methodData.name || !methodData.type) {
      return response.status(400).json({
        message: "Name and type are required",
        error: true,
        success: false,
      });
    }

    // Validate type is one of the three allowed
    if (!["flat_rate", "table_shipping", "pickup"].includes(methodData.type)) {
      return response.status(400).json({
        message:
          "Invalid shipping method type. Must be flat_rate, table_shipping, or pickup",
        error: true,
        success: false,
      });
    }

    // ALWAYS auto-generate unique code
    const code = await generateMethodCode(methodData.name, methodData.type);
    console.log("Generated code:", code);

    const existingMethod = await ShippingMethodModel.findOne({
      code: code.toUpperCase(),
    });

    if (existingMethod) {
      return response.status(400).json({
        message: "Shipping method with this code already exists",
        error: true,
        success: false,
      });
    }

    // FIXED: Build processedMethodData with ONLY relevant fields for the type
    const processedMethodData = {
      name: methodData.name,
      code: code,
      description: methodData.description || "",
      type: methodData.type,
      isActive: methodData.isActive !== undefined ? methodData.isActive : true,
      sortOrder: methodData.sortOrder || 0,
      estimatedDelivery: methodData.estimatedDelivery || {
        minDays: 1,
        maxDays: 7,
      },
      createdBy: userId,
      updatedBy: userId,
    };

    // FIXED: Only add the configuration for the specific type
    // ===== TABLE SHIPPING METHOD HANDLING =====
    if (methodData.type === "table_shipping") {
      console.log("Processing TABLE SHIPPING method");
      const tableShippingConfig = methodData.tableShipping || {};

      // Ensure assignment defaults
      if (!tableShippingConfig.assignment) {
        tableShippingConfig.assignment = "all_products";
      }

      // Clean up categories and products arrays if not using them
      if (tableShippingConfig.assignment !== "categories") {
        tableShippingConfig.categories = [];
      }
      if (tableShippingConfig.assignment !== "specific_products") {
        tableShippingConfig.products = [];
      }

      // Clean up zone rates - remove empty zones
      if (
        tableShippingConfig.zoneRates &&
        Array.isArray(tableShippingConfig.zoneRates)
      ) {
        tableShippingConfig.zoneRates = tableShippingConfig.zoneRates.filter(
          (zoneRate) => {
            return zoneRate.zone && zoneRate.zone.trim() !== "";
          }
        );
        console.log(
          "Table shipping zone rates after cleaning:",
          tableShippingConfig.zoneRates.length
        );
      }

      // Validate that at least one zone rate exists for table shipping
      if (
        !tableShippingConfig.zoneRates ||
        tableShippingConfig.zoneRates.length === 0
      ) {
        return response.status(400).json({
          message:
            "At least one zone rate is required for table shipping method",
          error: true,
          success: false,
        });
      }

      // Validate weight ranges exist for each zone
      for (let i = 0; i < tableShippingConfig.zoneRates.length; i++) {
        const zoneRate = tableShippingConfig.zoneRates[i];
        if (!zoneRate.weightRanges || zoneRate.weightRanges.length === 0) {
          return response.status(400).json({
            message: `Weight ranges are required for zone rate #${i + 1}`,
            error: true,
            success: false,
          });
        }
      }

      // ONLY add tableShipping config
      processedMethodData.tableShipping = tableShippingConfig;
    }
    // ===== FLAT RATE METHOD HANDLING =====
    else if (methodData.type === "flat_rate") {
      console.log("Processing FLAT RATE method");
      const flatRateConfig = methodData.flatRate || {};

      // Ensure assignment defaults
      if (!flatRateConfig.assignment) {
        flatRateConfig.assignment = "all_products";
      }

      // Clean up categories and products arrays if not using them
      if (flatRateConfig.assignment !== "categories") {
        flatRateConfig.categories = [];
      }
      if (flatRateConfig.assignment !== "specific_products") {
        flatRateConfig.products = [];
      }

      // Clean up zone rates - remove empty zones
      if (flatRateConfig.zoneRates && Array.isArray(flatRateConfig.zoneRates)) {
        flatRateConfig.zoneRates = flatRateConfig.zoneRates.filter(
          (zoneRate) => {
            return zoneRate.zone && zoneRate.zone.trim() !== "";
          }
        );
        console.log(
          "Flat rate zone rates after cleaning:",
          flatRateConfig.zoneRates.length
        );
      }

      // Ensure numeric values
      flatRateConfig.defaultCost =
        Number(flatRateConfig.defaultCost) || Number(flatRateConfig.cost) || 0;
      flatRateConfig.cost = Number(flatRateConfig.cost) || 0;

      if (flatRateConfig.freeShipping) {
        flatRateConfig.freeShipping.minimumOrderAmount =
          Number(flatRateConfig.freeShipping.minimumOrderAmount) || 0;
      }

      // ONLY add flatRate config
      processedMethodData.flatRate = flatRateConfig;
    }
    // ===== PICKUP METHOD HANDLING =====
    else if (methodData.type === "pickup") {
      console.log("Processing PICKUP method");
      const pickupConfig = methodData.pickup || {};

      // Ensure assignment defaults
      if (!pickupConfig.assignment) {
        pickupConfig.assignment = "all_products";
      }

      // Clean up categories and products arrays if not using them
      if (pickupConfig.assignment !== "categories") {
        pickupConfig.categories = [];
      }
      if (pickupConfig.assignment !== "specific_products") {
        pickupConfig.products = [];
      }

      // Clean up zoneLocations with CONSISTENT LGA validation
      if (
        pickupConfig.zoneLocations &&
        Array.isArray(pickupConfig.zoneLocations)
      ) {
        console.log(
          "Cleaning zone locations:",
          pickupConfig.zoneLocations.length
        );

        pickupConfig.zoneLocations = pickupConfig.zoneLocations.filter(
          (zoneLocation) => {
            // Remove if no zone selected
            if (!zoneLocation.zone || zoneLocation.zone.trim() === "") {
              console.log("Filtering out zone location: no zone selected");
              return false;
            }

            // Filter out invalid locations within this zone
            if (
              zoneLocation.locations &&
              Array.isArray(zoneLocation.locations)
            ) {
              zoneLocation.locations = zoneLocation.locations.filter(
                (location) => {
                  const isValid =
                    location.name &&
                    location.name.trim() !== "" &&
                    location.address &&
                    location.address.trim() !== "" &&
                    location.city &&
                    location.city.trim() !== "" &&
                    location.state &&
                    location.state.trim() !== "" &&
                    location.lga &&
                    location.lga.trim() !== "";

                  if (!isValid) {
                    console.log("Invalid zone location filtered:", {
                      name: location.name || "missing",
                      hasAddress: !!location.address,
                      hasCity: !!location.city,
                      hasState: !!location.state,
                      hasLga: !!location.lga,
                    });
                  }

                  return isValid;
                }
              );
            }

            // Keep zone location only if it has valid locations
            const hasValidLocations =
              zoneLocation.locations && zoneLocation.locations.length > 0;
            if (!hasValidLocations) {
              console.log("Filtering out zone location: no valid locations");
            }
            return hasValidLocations;
          }
        );

        console.log(
          "Zone locations after cleaning:",
          pickupConfig.zoneLocations.length
        );
      }

      // Clean up defaultLocations with CONSISTENT LGA validation
      if (
        pickupConfig.defaultLocations &&
        Array.isArray(pickupConfig.defaultLocations)
      ) {
        console.log(
          "Cleaning default locations:",
          pickupConfig.defaultLocations.length
        );

        pickupConfig.defaultLocations = pickupConfig.defaultLocations.filter(
          (location) => {
            const isValid =
              location.name &&
              location.name.trim() !== "" &&
              location.address &&
              location.address.trim() !== "" &&
              location.city &&
              location.city.trim() !== "" &&
              location.state &&
              location.state.trim() !== "" &&
              location.lga &&
              location.lga.trim() !== "";

            if (!isValid) {
              console.log("Invalid default location filtered:", {
                name: location.name || "missing",
                hasAddress: !!location.address,
                hasCity: !!location.city,
                hasState: !!location.state,
                hasLga: !!location.lga,
              });
            }

            return isValid;
          }
        );

        console.log(
          "Default locations after cleaning:",
          pickupConfig.defaultLocations.length
        );
      }

      // Validate at least one valid location exists
      const hasZoneLocations =
        pickupConfig.zoneLocations && pickupConfig.zoneLocations.length > 0;
      const hasDefaultLocations =
        pickupConfig.defaultLocations &&
        pickupConfig.defaultLocations.length > 0;

      console.log("Pickup validation:", {
        hasZoneLocations,
        hasDefaultLocations,
        zoneLocationsCount: pickupConfig.zoneLocations?.length || 0,
        defaultLocationsCount: pickupConfig.defaultLocations?.length || 0,
      });

      if (!hasZoneLocations && !hasDefaultLocations) {
        return response.status(400).json({
          message:
            "At least one valid pickup location is required with name, address, city, state, and LGA.",
          error: true,
          success: false,
        });
      }

      // ONLY add pickup config
      processedMethodData.pickup = pickupConfig;
    }

    console.log("Final processed data structure:", {
      type: processedMethodData.type,
      code: processedMethodData.code,
      hasPickup: !!processedMethodData.pickup,
      hasFlatRate: !!processedMethodData.flatRate,
      hasTableShipping: !!processedMethodData.tableShipping,
      keys: Object.keys(processedMethodData),
    });

    // Create and save the shipping method
    const newMethod = new ShippingMethodModel(processedMethodData);
    const savedMethod = await newMethod.save();

    console.log("✅ Shipping method created successfully:", savedMethod._id);

    return response.json({
      message: "Shipping method created successfully",
      data: savedMethod,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("❌ Create shipping method error:", error);

    // Enhanced error reporting
    if (error.name === "ValidationError") {
      const validationErrors = Object.keys(error.errors).map((key) => ({
        field: key,
        message: error.errors[key].message,
        value: error.errors[key].value,
      }));

      console.error("Validation errors:", validationErrors);

      return response.status(400).json({
        message: "Validation failed",
        errors: validationErrors,
        error: true,
        success: false,
      });
    }

    return response.status(500).json({
      message: error.message || "Failed to create shipping method",
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
        message: "Shipping method not found",
        error: true,
        success: false,
      });
    }

    // Prevent type changes
    if (updateData.type && updateData.type !== method.type) {
      return response.status(400).json({
        message: "Method type cannot be changed after creation",
        error: true,
        success: false,
      });
    }

    // Build clean update data with only relevant fields
    const finalUpdateData = {
      updatedBy: userId,
      type: method.type,
    };

    // Update basic fields if provided
    if (updateData.name !== undefined) finalUpdateData.name = updateData.name;
    if (updateData.description !== undefined)
      finalUpdateData.description = updateData.description;
    if (updateData.isActive !== undefined)
      finalUpdateData.isActive = updateData.isActive;
    if (updateData.sortOrder !== undefined)
      finalUpdateData.sortOrder = updateData.sortOrder;
    if (updateData.estimatedDelivery !== undefined)
      finalUpdateData.estimatedDelivery = updateData.estimatedDelivery;

    // Code is immutable, remove it
    delete finalUpdateData.code;

    // Handle method-specific configuration based on current method type
    if (method.type === "pickup") {
      console.log("Processing pickup method update");

      if (!updateData.pickup) {
        return response.status(400).json({
          message: "Pickup configuration is required for pickup method",
          error: true,
          success: false,
        });
      }

      const pickupConfig = { ...updateData.pickup };

      // Ensure assignment defaults
      if (!pickupConfig.assignment) {
        pickupConfig.assignment = "all_products";
      }

      // Clean up categories and products based on assignment
      if (pickupConfig.assignment !== "categories") {
        pickupConfig.categories = [];
      }
      if (pickupConfig.assignment !== "specific_products") {
        pickupConfig.products = [];
      }

      // Clean up zoneLocations with proper validation
      if (
        pickupConfig.zoneLocations &&
        Array.isArray(pickupConfig.zoneLocations)
      ) {
        pickupConfig.zoneLocations = pickupConfig.zoneLocations.filter(
          (zoneLocation) => {
            if (!zoneLocation.zone || zoneLocation.zone.trim() === "") {
              console.log("Filtering out zone location without zone");
              return false;
            }

            if (
              zoneLocation.locations &&
              Array.isArray(zoneLocation.locations)
            ) {
              zoneLocation.locations = zoneLocation.locations.filter(
                (location) => {
                  const isValid =
                    location.name &&
                    location.name.trim() !== "" &&
                    location.address &&
                    location.address.trim() !== "" &&
                    location.city &&
                    location.city.trim() !== "" &&
                    location.state &&
                    location.state.trim() !== "" &&
                    location.lga &&
                    location.lga.trim() !== "";

                  if (!isValid) {
                    console.log("Invalid zone location filtered:", {
                      name: location.name || "missing",
                      hasLga: !!location.lga,
                      hasState: !!location.state,
                    });
                  }

                  return isValid;
                }
              );
            }

            return zoneLocation.locations && zoneLocation.locations.length > 0;
          }
        );
      } else {
        pickupConfig.zoneLocations = [];
      }

      // Clean up defaultLocations with proper validation
      if (
        pickupConfig.defaultLocations &&
        Array.isArray(pickupConfig.defaultLocations)
      ) {
        pickupConfig.defaultLocations = pickupConfig.defaultLocations.filter(
          (location) => {
            const isValid =
              location.name &&
              location.name.trim() !== "" &&
              location.address &&
              location.address.trim() !== "" &&
              location.city &&
              location.city.trim() !== "" &&
              location.state &&
              location.state.trim() !== "" &&
              location.lga &&
              location.lga.trim() !== "";

            if (!isValid) {
              console.log("Invalid default location filtered:", {
                name: location.name || "missing",
                hasLga: !!location.lga,
                hasState: !!location.state,
              });
            }

            return isValid;
          }
        );
      } else {
        pickupConfig.defaultLocations = [];
      }

      // Validate at least one valid location exists
      const hasZoneLocations = pickupConfig.zoneLocations.length > 0;
      const hasDefaultLocations = pickupConfig.defaultLocations.length > 0;

      if (!hasZoneLocations && !hasDefaultLocations) {
        return response.status(400).json({
          message:
            "At least one valid pickup location is required. All locations must have name, address, city, state, and LGA.",
          error: true,
          success: false,
        });
      }

      finalUpdateData.pickup = pickupConfig;
      // Explicitly unset other method configs
      finalUpdateData.flatRate = undefined;
      finalUpdateData.tableShipping = undefined;

      console.log(
        `Pickup config validated: ${
          hasZoneLocations ? pickupConfig.zoneLocations.length : 0
        } zone locations, ${
          hasDefaultLocations ? pickupConfig.defaultLocations.length : 0
        } default locations`
      );
    } else if (method.type === "flat_rate") {
      console.log("Processing flat_rate method update");

      if (!updateData.flatRate) {
        return response.status(400).json({
          message: "Flat rate configuration is required for flat rate method",
          error: true,
          success: false,
        });
      }

      const flatRateConfig = { ...updateData.flatRate };

      // Ensure assignment defaults
      if (!flatRateConfig.assignment) {
        flatRateConfig.assignment = "all_products";
      }

      // Clean up categories and products based on assignment
      if (flatRateConfig.assignment !== "categories") {
        flatRateConfig.categories = [];
      }
      if (flatRateConfig.assignment !== "specific_products") {
        flatRateConfig.products = [];
      }

      // Clean up zone rates
      if (flatRateConfig.zoneRates && Array.isArray(flatRateConfig.zoneRates)) {
        flatRateConfig.zoneRates = flatRateConfig.zoneRates.filter(
          (zoneRate) => {
            return zoneRate.zone && zoneRate.zone.trim() !== "";
          }
        );
      } else {
        flatRateConfig.zoneRates = [];
      }

      // Ensure numeric values
      flatRateConfig.defaultCost =
        Number(flatRateConfig.defaultCost) || Number(flatRateConfig.cost) || 0;
      flatRateConfig.cost = Number(flatRateConfig.cost) || 0;

      if (flatRateConfig.freeShipping) {
        flatRateConfig.freeShipping.minimumOrderAmount =
          Number(flatRateConfig.freeShipping.minimumOrderAmount) || 0;
      }

      finalUpdateData.flatRate = flatRateConfig;
      // Explicitly unset other method configs
      finalUpdateData.pickup = undefined;
      finalUpdateData.tableShipping = undefined;
    } else if (method.type === "table_shipping") {
      console.log("Processing table_shipping method update");

      if (!updateData.tableShipping) {
        return response.status(400).json({
          message:
            "Table shipping configuration is required for table shipping method",
          error: true,
          success: false,
        });
      }

      const tableShippingConfig = { ...updateData.tableShipping };

      // Ensure assignment defaults
      if (!tableShippingConfig.assignment) {
        tableShippingConfig.assignment = "all_products";
      }

      // Clean up categories and products based on assignment
      if (tableShippingConfig.assignment !== "categories") {
        tableShippingConfig.categories = [];
      }
      if (tableShippingConfig.assignment !== "specific_products") {
        tableShippingConfig.products = [];
      }

      // Clean up zone rates
      if (
        tableShippingConfig.zoneRates &&
        Array.isArray(tableShippingConfig.zoneRates)
      ) {
        tableShippingConfig.zoneRates = tableShippingConfig.zoneRates.filter(
          (zoneRate) => {
            return zoneRate.zone && zoneRate.zone.trim() !== "";
          }
        );
      } else {
        tableShippingConfig.zoneRates = [];
      }

      // Validate at least one zone rate
      if (tableShippingConfig.zoneRates.length === 0) {
        return response.status(400).json({
          message:
            "At least one zone rate is required for table shipping method",
          error: true,
          success: false,
        });
      }

      finalUpdateData.tableShipping = tableShippingConfig;
      // Explicitly unset other method configs
      finalUpdateData.pickup = undefined;
      finalUpdateData.flatRate = undefined;
    }

    console.log("Attempting update with data structure:", {
      type: finalUpdateData.type,
      hasPickup: !!finalUpdateData.pickup,
      hasFlatRate: !!finalUpdateData.flatRate,
      hasTableShipping: !!finalUpdateData.tableShipping,
    });

    // Perform the update with explicit $set and $unset
    const unsetFields = {};
    if (method.type === "pickup") {
      unsetFields.flatRate = "";
      unsetFields.tableShipping = "";
    } else if (method.type === "flat_rate") {
      unsetFields.pickup = "";
      unsetFields.tableShipping = "";
    } else if (method.type === "table_shipping") {
      unsetFields.pickup = "";
      unsetFields.flatRate = "";
    }

    const updatedMethod = await ShippingMethodModel.findByIdAndUpdate(
      methodId,
      {
        $set: finalUpdateData,
        $unset: unsetFields,
      },
      {
        new: true,
        runValidators: true,
        context: "query",
      }
    ).populate("createdBy updatedBy", "name email");

    if (!updatedMethod) {
      return response.status(404).json({
        message: "Failed to update shipping method",
        error: true,
        success: false,
      });
    }

    console.log("Shipping method updated successfully:", updatedMethod._id);

    return response.json({
      message: "Shipping method updated successfully",
      data: updatedMethod,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Update shipping method error:", error);

    // Handle validation errors
    if (error.name === "ValidationError") {
      const validationErrors = Object.keys(error.errors).map((key) => ({
        field: key,
        message: error.errors[key].message,
        value: error.errors[key].value,
      }));

      return response.status(400).json({
        message: "Validation failed",
        errors: validationErrors,
        error: true,
        success: false,
      });
    }

    // Handle cast errors (invalid ObjectId, etc.)
    if (error.name === "CastError") {
      return response.status(400).json({
        message: `Invalid ${error.path}: ${error.value}`,
        error: true,
        success: false,
      });
    }

    return response.status(500).json({
      message: error.message || "Failed to update shipping method",
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
        message: "Cannot delete shipping method that is being used by orders",
        error: true,
        success: false,
      });
    }

    const deletedMethod = await ShippingMethodModel.findByIdAndDelete(methodId);
    if (!deletedMethod) {
      return response.status(404).json({
        message: "Shipping method not found",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: "Shipping method deleted successfully",
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
    const { search = "", page = 1, limit = 50 } = request.query;

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { slug: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const CategoryModel = mongoose.model("category");

    const [categories, totalCount] = await Promise.all([
      CategoryModel.find(query)
        .select("_id name slug")
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      CategoryModel.countDocuments(query),
    ]);

    return response.json({
      message: "Categories retrieved successfully",
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
    const { search = "", page = 1, limit = 50, category } = request.query;

    const query = {
      publish: "PUBLISHED",
    };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
      ];
    }

    if (category) {
      query.category = category;
    }

    const skip = (page - 1) * limit;

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .select("_id name sku productType category weight")
        .populate("category", "name slug")
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: "Products retrieved successfully",
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

// controllers/shipping.controller.js
// FIXED calculateCheckoutShipping function
export const calculateCheckoutShipping = async (request, response) => {
  try {
    const { addressId, items, orderValue, totalWeight } = request.body;

    console.log("=== CALCULATE CHECKOUT SHIPPING ===");
    console.log("Request:", {
      addressId,
      itemCount: items?.length,
      orderValue,
      totalWeight,
    });

    if (!addressId || !items || items.length === 0) {
      return response.status(400).json({
        message: "Address ID and items are required",
        error: true,
        success: false,
      });
    }

    // Get address details
    const address = await mongoose
      .model("address")
      .findById(addressId)
      .populate("shipping_zone");

    if (!address) {
      return response.status(404).json({
        message: "Address not found",
        error: true,
        success: false,
      });
    }

    console.log("Address:", {
      state: address.state,
      lga: address.lga,
      city: address.city,
      hasZone: !!address.shipping_zone,
    });

    // Find zone for address if not already assigned
    let zone = address.shipping_zone;

    if (!zone) {
      console.log("Searching for matching zone...");
      const zones = await ShippingZoneModel.find({ isActive: true });

      for (const testZone of zones) {
        const stateMatch = testZone.states.find(
          (state) =>
            state.name.toLowerCase().trim() ===
            address.state.toLowerCase().trim()
        );

        if (stateMatch) {
          console.log(`State match found: ${stateMatch.name}`);
          console.log(`Coverage type: ${stateMatch.coverage_type}`);

          let lgaCovered = false;

          // FIXED: If coverage_type is 'all' OR no covered_lgas specified, cover all LGAs
          if (
            stateMatch.coverage_type === "all" ||
            !stateMatch.covered_lgas ||
            stateMatch.covered_lgas.length === 0
          ) {
            lgaCovered = true;
            console.log("✅ Zone covers ALL LGAs in state");
          } else if (stateMatch.coverage_type === "specific") {
            // Only check specific LGAs if explicitly set to specific AND has covered_lgas
            lgaCovered = stateMatch.covered_lgas?.some(
              (lga) =>
                lga.toLowerCase().trim() === address.lga.toLowerCase().trim()
            );
            console.log(`LGA ${address.lga} covered: ${lgaCovered}`);
          }

          if (lgaCovered) {
            zone = testZone;
            console.log(`✅ Zone assigned: ${zone.name}`);
            await mongoose.model("address").findByIdAndUpdate(addressId, {
              shipping_zone: zone._id,
            });
            break;
          }
        }
      }
    }

    console.log("Zone result:", zone ? `Found: ${zone.name}` : "Not found");

    // Get product details
    const productIds = items.map((item) => item.productId || item._id);
    const products = await ProductModel.find({
      _id: { $in: productIds },
      publish: "PUBLISHED",
      productAvailability: true,
    }).populate("category", "name slug");

    if (products.length === 0) {
      return response.status(400).json({
        message: "No valid products found in cart",
        error: true,
        success: false,
      });
    }

    // Extract category IDs
    const categoryIds = [
      ...new Set(products.map((p) => p.category?._id).filter(Boolean)),
    ];

    console.log("Cart:", {
      productCount: products.length,
      categoryCount: categoryIds.length,
    });

    // Calculate total weight
    let calculatedWeight = totalWeight || 0;
    if (!calculatedWeight) {
      for (const item of items) {
        const product = products.find(
          (p) => p._id.toString() === (item.productId || item._id).toString()
        );
        if (product && product.weight) {
          calculatedWeight += product.weight * item.quantity;
        } else {
          calculatedWeight += 1 * item.quantity;
        }
      }
    }

    console.log(`Total weight: ${calculatedWeight}kg`);

    // Get ALL active shipping methods
    const shippingMethods = await ShippingMethodModel.find({
      isActive: true,
    }).sort({ sortOrder: 1 });

    console.log(`Found ${shippingMethods.length} active shipping methods`);

    const availableMethods = [];

    for (const method of shippingMethods) {
      try {
        console.log(`\n🔍 Evaluating: ${method.name} (${method.type})`);

        // Check if method is currently valid (date-based validity)
        if (!method.isCurrentlyValid()) {
          console.log(`❌ Not currently valid (date restrictions)`);
          continue;
        }

        // FIXED: Map type to correct config key (database uses camelCase)
        const configKeyMap = {
          flat_rate: "flatRate",
          table_shipping: "tableShipping",
          pickup: "pickup",
        };

        const configKey = configKeyMap[method.type] || method.type;
        const config = method[configKey];

        if (!config) {
          console.log(
            `❌ No configuration found for type: ${method.type} (tried key: ${configKey})`
          );
          console.log(
            `Available keys:`,
            Object.keys(method.toObject ? method.toObject() : method)
          );
          continue;
        }

        console.log(
          `✅ Found config for ${method.type} using key: ${configKey}`
        );

        // STEP 1: Check product/category assignment
        let appliesToItems = false;

        console.log(`Assignment type: ${config.assignment}`);

        // FIXED: Default to all_products if assignment is undefined or null
        const assignment = config.assignment || "all_products";

        switch (assignment) {
          case "all_products":
            appliesToItems = true;
            console.log("✅ Applies to all products");
            break;

          case "categories":
            if (!config.categories || config.categories.length === 0) {
              appliesToItems = true;
              console.log("✅ No categories specified, applies to all");
            } else if (categoryIds.length === 0) {
              // IMPORTANT: If cart has no categories but method requires categories,
              // still apply it (customer might have products without categories)
              appliesToItems = true;
              console.log("✅ Cart has no categories, applies to all");
            } else {
              appliesToItems = categoryIds.some((catId) =>
                config.categories.some(
                  (methodCatId) => methodCatId.toString() === catId.toString()
                )
              );
              console.log(`Category match: ${appliesToItems}`, {
                cartCategories: categoryIds.map((c) => c.toString()),
                methodCategories: config.categories.map((c) => c.toString()),
              });
            }
            break;

          case "specific_products":
            if (!config.products || config.products.length === 0) {
              appliesToItems = true;
              console.log("✅ No products specified, applies to all");
            } else {
              appliesToItems = productIds.some((prodId) =>
                config.products.some(
                  (methodProdId) =>
                    methodProdId.toString() === prodId.toString()
                )
              );
              console.log(`Product match: ${appliesToItems}`);
            }
            break;

          default:
            appliesToItems = true;
        }

        if (!appliesToItems) {
          console.log(`❌ Does not apply to cart items`);
          continue;
        }

        // STEP 2: Check zone availability and calculate cost
        let isAvailableForAddress = false;
        let calculationResult = null;

        if (method.type === "pickup") {
          // PICKUP METHODS: Check both zone-specific and default locations
          const hasZoneLocations = config.zoneLocations?.length > 0;
          const hasDefaultLocations = config.defaultLocations?.length > 0;

          console.log("Pickup availability:", {
            hasZoneLocations,
            hasDefaultLocations,
            hasZone: !!zone,
          });

          if (hasZoneLocations && zone) {
            // Check if this zone has locations
            const zoneLocation = config.zoneLocations.find(
              (zl) => zl.zone && zl.zone.toString() === zone._id.toString()
            );
            if (zoneLocation && zoneLocation.locations?.length > 0) {
              isAvailableForAddress = true;
              console.log("✅ Zone-specific pickup locations available");
            }
          }

          // Always check default locations for pickup
          if (!isAvailableForAddress && hasDefaultLocations) {
            isAvailableForAddress = true;
            console.log("✅ Default pickup locations available");
          }

          // Calculate cost for pickup (usually free)
          if (isAvailableForAddress) {
            calculationResult = method.calculateShippingCost({
              weight: calculatedWeight,
              orderValue: orderValue || 0,
              zone: zone?._id,
              items: items,
            });
          }
        } else if (method.type === "flat_rate") {
          // FLAT_RATE: Check zone rates OR default cost
          const hasZoneRate =
            zone &&
            config.zoneRates?.some(
              (zr) => zr.zone && zr.zone.toString() === zone._id.toString()
            );
          const hasDefaultCost =
            config.defaultCost !== undefined && config.defaultCost !== null;

          console.log("Flat rate availability:", {
            hasZone: !!zone,
            hasZoneRate,
            hasDefaultCost,
            defaultCost: config.defaultCost,
          });

          // FIXED: Available if has zone rate OR has default cost OR no zone required
          if (hasZoneRate || hasDefaultCost || !zone) {
            isAvailableForAddress = true;
            console.log("✅ Flat rate available");

            calculationResult = method.calculateShippingCost({
              weight: calculatedWeight,
              orderValue: orderValue || 0,
              zone: zone?._id,
              items: items,
            });
          }
        } else if (method.type === "table_shipping") {
          // TABLE_SHIPPING: Must have zone and zone rate
          if (!zone) {
            console.log(`❌ No zone found for table shipping`);
            continue;
          }

          const hasZoneRate = config.zoneRates?.some(
            (zr) => zr.zone && zr.zone.toString() === zone._id.toString()
          );

          console.log("Table shipping availability:", {
            hasZone: !!zone,
            hasZoneRate,
          });

          if (hasZoneRate) {
            isAvailableForAddress = true;
            console.log("✅ Table shipping available");

            calculationResult = method.calculateShippingCost({
              weight: calculatedWeight,
              orderValue: orderValue || 0,
              zone: zone._id,
              items: items,
            });
          }
        }

        if (!isAvailableForAddress) {
          console.log(`❌ Not available for this address/zone`);
          continue;
        }

        console.log("Calculation result:", {
          eligible: calculationResult?.eligible,
          cost: calculationResult?.cost,
          reason: calculationResult?.reason,
        });

        if (calculationResult && calculationResult.eligible) {
          const methodData = {
            _id: method._id,
            name: method.name,
            code: method.code,
            type: method.type,
            description: method.description,
            cost: calculationResult.cost,
            estimatedDelivery: method.estimatedDelivery,
            reason: calculationResult.reason,
          };

          // Add pickup locations for pickup methods
          if (method.type === "pickup") {
            const locations = [];

            // Add zone-specific locations if available
            if (zone && config.zoneLocations) {
              const zoneLocation = config.zoneLocations.find(
                (zl) => zl.zone && zl.zone.toString() === zone._id.toString()
              );
              if (zoneLocation?.locations) {
                locations.push(...zoneLocation.locations);
              }
            }

            // Add default locations
            if (config.defaultLocations) {
              locations.push(...config.defaultLocations);
            }

            methodData.pickupLocations = locations;
          }

          if (zone) {
            methodData.zoneInfo = {
              zoneId: zone._id,
              zoneName: zone.name,
              zoneCode: zone.code,
            };
          }

          availableMethods.push(methodData);
          console.log(`✅ Added to available methods`);
        } else {
          console.log(
            `❌ Not eligible: ${calculationResult?.reason || "Unknown reason"}`
          );
        }
      } catch (methodError) {
        console.error(`❌ Error processing ${method.name}:`, methodError);
        continue;
      }
    }

    console.log(`\n📊 Final: ${availableMethods.length} methods available`);

    // Sort methods: free first, then by price
    availableMethods.sort((a, b) => {
      if (a.cost === 0 && b.cost !== 0) return -1;
      if (a.cost !== 0 && b.cost === 0) return 1;
      return a.cost - b.cost;
    });

    return response.json({
      message: "Shipping methods calculated successfully",
      data: {
        zone: zone
          ? {
              _id: zone._id,
              name: zone.name,
              code: zone.code,
            }
          : null,
        methods: availableMethods,
        calculatedWeight,
        address: {
          city: address.city,
          state: address.state,
          lga: address.lga,
          country: address.country,
        },
        debug: {
          hasZone: !!zone,
          productCount: products.length,
          categoryCount: categoryIds.length,
          totalMethodsChecked: shippingMethods.length,
        },
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("❌ Calculate shipping error:", error);
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// controllers/shipping.controller.js - ADD THIS NEW FUNCTION

export const calculateManualOrderShipping = async (request, response) => {
  try {
    const { deliveryAddress, items, orderValue, totalWeight } = request.body;

    console.log("=== CALCULATE MANUAL ORDER SHIPPING ===");

    if (!deliveryAddress?.state || !deliveryAddress?.lga) {
      return response.status(400).json({
        message: "State and LGA are required",
        error: true,
        success: false,
      });
    }

    if (!items || items.length === 0) {
      return response.status(400).json({
        message: "Items are required",
        error: true,
        success: false,
      });
    }

    // Find zone for state/LGA
    const zones = await ShippingZoneModel.find({ isActive: true });
    let zone = null;

    for (const testZone of zones) {
      const stateMatch = testZone.states.find(
        (state) =>
          state.name.toLowerCase().trim() ===
          deliveryAddress.state.toLowerCase().trim()
      );

      if (stateMatch) {
        let lgaCovered = false;

        if (
          stateMatch.coverage_type === "all" ||
          !stateMatch.covered_lgas ||
          stateMatch.covered_lgas.length === 0
        ) {
          lgaCovered = true;
        } else if (stateMatch.coverage_type === "specific") {
          lgaCovered = stateMatch.covered_lgas?.some(
            (lga) =>
              lga.toLowerCase().trim() ===
              deliveryAddress.lga.toLowerCase().trim()
          );
        }

        if (lgaCovered) {
          zone = testZone;
          break;
        }
      }
    }

    if (!zone) {
      return response.json({
        message: "No shipping zone available for this location",
        data: {
          zone: null,
          methods: [],
        },
        error: false,
        success: true,
      });
    }

    // Get product details
    const productIds = items.map((item) => item.productId);
    const products = await ProductModel.find({
      _id: { $in: productIds },
    }).populate("category", "name");

    const categoryIds = [
      ...new Set(products.map((p) => p.category?._id).filter(Boolean)),
    ];

    // Calculate total weight
    let calculatedWeight = totalWeight || 0;
    if (!calculatedWeight) {
      for (const item of items) {
        const product = products.find(
          (p) => p._id.toString() === item.productId.toString()
        );
        if (product && product.weight) {
          calculatedWeight += product.weight * item.quantity;
        } else {
          calculatedWeight += 1 * item.quantity;
        }
      }
    }

    // Get shipping methods
    const shippingMethods = await ShippingMethodModel.find({
      isActive: true,
    }).sort({ sortOrder: 1 });

    const availableMethods = [];

    for (const method of shippingMethods) {
      if (!method.isCurrentlyValid()) continue;

      const configKeyMap = {
        flat_rate: "flatRate",
        table_shipping: "tableShipping",
        pickup: "pickup",
      };

      const configKey = configKeyMap[method.type] || method.type;
      const config = method[configKey];

      if (!config) continue;

      // Check assignment
      let appliesToItems = false;
      const assignment = config.assignment || "all_products";

      switch (assignment) {
        case "all_products":
          appliesToItems = true;
          break;
        case "categories":
          if (!config.categories || config.categories.length === 0) {
            appliesToItems = true;
          } else {
            appliesToItems = categoryIds.some((catId) =>
              config.categories.some(
                (methodCatId) => methodCatId.toString() === catId.toString()
              )
            );
          }
          break;
        case "specific_products":
          if (!config.products || config.products.length === 0) {
            appliesToItems = true;
          } else {
            appliesToItems = productIds.some((prodId) =>
              config.products.some(
                (methodProdId) => methodProdId.toString() === prodId.toString()
              )
            );
          }
          break;
        default:
          appliesToItems = true;
      }

      if (!appliesToItems) continue;

      // Check zone availability
      let isAvailableForAddress = false;
      let calculationResult = null;

      if (method.type === "pickup") {
        const hasZoneLocations = config.zoneLocations?.length > 0;
        const hasDefaultLocations = config.defaultLocations?.length > 0;

        if (hasZoneLocations) {
          const zoneLocation = config.zoneLocations.find(
            (zl) => zl.zone && zl.zone.toString() === zone._id.toString()
          );
          if (zoneLocation && zoneLocation.locations?.length > 0) {
            isAvailableForAddress = true;
          }
        }

        if (!isAvailableForAddress && hasDefaultLocations) {
          isAvailableForAddress = true;
        }

        if (isAvailableForAddress) {
          calculationResult = method.calculateShippingCost({
            weight: calculatedWeight,
            orderValue: orderValue || 0,
            zone: zone._id,
            items: items,
          });
        }
      } else if (method.type === "flat_rate") {
        const hasZoneRate = config.zoneRates?.some(
          (zr) => zr.zone && zr.zone.toString() === zone._id.toString()
        );
        const hasDefaultCost =
          config.defaultCost !== undefined && config.defaultCost !== null;

        if (hasZoneRate || hasDefaultCost) {
          isAvailableForAddress = true;
          calculationResult = method.calculateShippingCost({
            weight: calculatedWeight,
            orderValue: orderValue || 0,
            zone: zone._id,
            items: items,
          });
        }
      } else if (method.type === "table_shipping") {
        const hasZoneRate = config.zoneRates?.some(
          (zr) => zr.zone && zr.zone.toString() === zone._id.toString()
        );

        if (hasZoneRate) {
          isAvailableForAddress = true;
          calculationResult = method.calculateShippingCost({
            weight: calculatedWeight,
            orderValue: orderValue || 0,
            zone: zone._id,
            items: items,
          });
        }
      }

      if (isAvailableForAddress && calculationResult?.eligible) {
        const methodData = {
          _id: method._id,
          name: method.name,
          code: method.code,
          type: method.type,
          description: method.description,
          cost: calculationResult.cost,
          estimatedDelivery: method.estimatedDelivery,
          reason: calculationResult.reason,
        };

        if (method.type === "pickup") {
          const locations = [];
          if (zone && config.zoneLocations) {
            const zoneLocation = config.zoneLocations.find(
              (zl) => zl.zone && zl.zone.toString() === zone._id.toString()
            );
            if (zoneLocation?.locations) {
              locations.push(...zoneLocation.locations);
            }
          }
          if (config.defaultLocations) {
            locations.push(...config.defaultLocations);
          }
          methodData.pickupLocations = locations;
        }

        methodData.zoneInfo = {
          zoneId: zone._id,
          zoneName: zone.name,
          zoneCode: zone.code,
        };

        availableMethods.push(methodData);
      }
    }

    // Sort: free first, then by price
    availableMethods.sort((a, b) => {
      if (a.cost === 0 && b.cost !== 0) return -1;
      if (a.cost !== 0 && b.cost === 0) return 1;
      return a.cost - b.cost;
    });

    return response.json({
      message: "Shipping methods calculated successfully",
      data: {
        zone: {
          _id: zone._id,
          name: zone.name,
          code: zone.code,
        },
        methods: availableMethods,
        calculatedWeight,
        address: {
          city: deliveryAddress.city,
          state: deliveryAddress.state,
          lga: deliveryAddress.lga,
          country: deliveryAddress.country || "Nigeria",
        },
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Calculate manual order shipping error:", error);
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// ===== SHIPMENT MANAGEMENT (KEEPING ORIGINAL TRACKING LOGIC) =====

// controllers/shipping.controller.js

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
      orderType = "online",
      applyToGroup = true, // NEW: Option to apply tracking to entire group
    } = request.body;

    if (!orderId || !carrier) {
      return response.status(400).json({
        message: "Order ID and carrier are required",
        error: true,
        success: false,
      });
    }

    const order = await OrderModel.findById(orderId)
      .populate("delivery_address")
      .populate("userId", "name email mobile")
      .populate("customerId", "name email mobile companyName")
      .populate("productId", "name weight")
      .populate("shippingMethod", "name type");

    if (!order) {
      return response.status(404).json({
        message: "Order not found",
        error: true,
        success: false,
      });
    }

    // NEW: Get all orders in the group if applyToGroup is true
    let ordersToTrack = [order];
    if (applyToGroup && order.orderGroupId) {
      ordersToTrack = await OrderModel.find({
        orderGroupId: order.orderGroupId,
      })
        .populate("delivery_address")
        .populate("userId", "name email mobile")
        .populate("customerId", "name email mobile companyName")
        .populate("productId", "name weight")
        .populate("shippingMethod", "name type");
    }

    // Check if any order already has tracking
    const existingTracking = await ShippingTrackingModel.findOne({
      orderId: { $in: ordersToTrack.map((o) => o._id) },
    });

    if (existingTracking) {
      return response.status(400).json({
        message: "Tracking already exists for this order or order group",
        error: true,
        success: false,
      });
    }

    // Auto-generate tracking number if not provided
    let finalTrackingNumber = trackingNumber?.toUpperCase();

    if (!finalTrackingNumber) {
      console.log("🔄 Auto-generating tracking number...");
      finalTrackingNumber = await generateTrackingNumber();
      console.log(`✅ Generated tracking number: ${finalTrackingNumber}`);
    } else {
      // If tracking number is provided, check if it already exists
      const existingTrackingNumber = await ShippingTrackingModel.findOne({
        trackingNumber: finalTrackingNumber,
      });
      if (existingTrackingNumber) {
        return response.status(400).json({
          message: "Tracking number already exists",
          error: true,
          success: false,
        });
      }
    }

    // NEW: Calculate total weight for all items in group
    const totalWeight = ordersToTrack.reduce((sum, o) => {
      return sum + (o.productId?.weight || 1) * o.quantity;
    }, 0);

    // Get customer info (prioritize userId over customerId)
    const customer = order.userId || order.customerId;

    // Create tracking records for each order in the group
    const trackingRecords = [];

    for (const orderItem of ordersToTrack) {
      const newTracking = new ShippingTrackingModel({
        orderId: orderItem._id,
        trackingNumber: finalTrackingNumber, // Same tracking number for all
        carrier,
        shippingMethod: orderItem.shippingMethod?._id,
        estimatedDelivery,
        packageInfo: {
          weight: packageInfo?.weight || totalWeight,
          dimensions: packageInfo?.dimensions || {
            length: 20,
            width: 15,
            height: 10,
            unit: "cm",
          },
          fragile: packageInfo?.fragile || false,
          insured:
            packageInfo?.insured || order.groupTotals?.grandTotal > 50000,
          insuranceValue:
            packageInfo?.insuranceValue ||
            (order.groupTotals?.grandTotal > 50000
              ? order.groupTotals.grandTotal
              : 0),
        },
        deliveryInstructions,
        priority: priority || "NORMAL",
        orderType: orderType,
        deliveryAddress: orderItem.delivery_address
          ? {
              addressLine: orderItem.delivery_address.address_line,
              city: orderItem.delivery_address.city,
              state: orderItem.delivery_address.state,
              postalCode: orderItem.delivery_address.pincode,
              country: orderItem.delivery_address.country || "Nigeria",
            }
          : {},
        recipientInfo: {
          name: customer ? customer.name : "Customer",
          phone: orderItem.delivery_address?.mobile || customer?.mobile,
          email: customer ? customer.email : "",
        },
        shippingCost: orderItem.shipping_cost || 0,
        // NEW: Store group information
        orderGroupId: orderItem.orderGroupId,
        isGroupShipment: ordersToTrack.length > 1,
        groupItemCount: ordersToTrack.length,
        createdBy: userId,
        updatedBy: userId,
      });

      const savedTracking = await newTracking.save();
      trackingRecords.push(savedTracking);

      // Add initial tracking event
      await savedTracking.addTrackingEvent(
        {
          status: "PENDING",
          description:
            orderType === "online"
              ? `Online order confirmed and ready for processing${
                  ordersToTrack.length > 1
                    ? ` (${ordersToTrack.length} items in shipment)`
                    : ""
                }`
              : `Offline order created and ready for processing${
                  ordersToTrack.length > 1
                    ? ` (${ordersToTrack.length} items in shipment)`
                    : ""
                }`,
          location: {
            facility: "I-Coffee Shop",
            city: "Lagos",
            state: "Lagos",
            country: "Nigeria",
          },
        },
        userId
      );

      // Update order with tracking information
      await OrderModel.findByIdAndUpdate(orderItem._id, {
        tracking_number: savedTracking.trackingNumber,
        order_status: "PROCESSING",
        estimated_delivery: estimatedDelivery,
      });
    }

    // Send notification emails
    try {
      if (customer) {
        await sendShippingNotificationEmail({
          user: customer,
          order: order,
          tracking: trackingRecords[0],
          latestEvent:
            trackingRecords[0].trackingEvents[
              trackingRecords[0].trackingEvents.length - 1
            ],
          isGroupShipment: ordersToTrack.length > 1,
          groupItemCount: ordersToTrack.length,
        });
      }

      await sendOrderNotificationToTeam({
        user: customer,
        order: order,
        items: ordersToTrack,
        orderType: `Shipment Created - ${orderType}${
          ordersToTrack.length > 1 ? ` (${ordersToTrack.length} items)` : ""
        }`,
      });
    } catch (emailError) {
      console.error("Failed to send notification emails:", emailError);
    }

    // Return the first tracking record with populated data
    const populatedTracking = await ShippingTrackingModel.findById(
      trackingRecords[0]._id
    )
      .populate("orderId")
      .populate("shippingMethod")
      .populate("createdBy", "name email");

    return response.json({
      message: `Shipment created successfully${
        ordersToTrack.length > 1 ? ` for ${ordersToTrack.length} items` : ""
      }`,
      data: {
        ...populatedTracking.toObject(),
        groupItemCount: ordersToTrack.length,
        trackingRecordsCreated: trackingRecords.length,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("❌ Create shipment error:", error);
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
    const {
      status,
      description,
      location,
      estimatedDelivery,
      applyToGroup = true, // NEW: Option to apply update to entire group
    } = request.body;

    const tracking = await ShippingTrackingModel.findById(trackingId)
      .populate("orderId")
      .populate("orderId.userId", "name email")
      .populate("orderId.customerId", "name email companyName");

    if (!tracking) {
      return response.status(404).json({
        message: "Tracking not found",
        error: true,
        success: false,
      });
    }

    // NEW: Get all trackings in the group if applyToGroup is true
    let trackingsToUpdate = [tracking];
    if (applyToGroup && tracking.orderGroupId) {
      // Find all trackings with same tracking number (they're in the same shipment)
      trackingsToUpdate = await ShippingTrackingModel.find({
        trackingNumber: tracking.trackingNumber,
      })
        .populate("orderId")
        .populate("orderId.userId", "name email")
        .populate("orderId.customerId", "name email companyName");
    }

    // Update estimated delivery for all trackings in group
    if (estimatedDelivery) {
      for (const trackingItem of trackingsToUpdate) {
        await trackingItem.updateEstimatedDelivery(
          new Date(estimatedDelivery),
          userId
        );
      }
    }

    // Add tracking event and update status for all in group
    if (status && description) {
      for (const trackingItem of trackingsToUpdate) {
        await trackingItem.addTrackingEvent(
          {
            status,
            description:
              trackingsToUpdate.length > 1
                ? `${description} (${trackingsToUpdate.length} items in shipment)`
                : description,
            location,
          },
          userId
        );

        // Update order status based on tracking status
        let orderStatus = trackingItem.orderId.order_status;
        switch (status) {
          case "PROCESSING":
            orderStatus = "PROCESSING";
            break;
          case "PICKED_UP":
          case "IN_TRANSIT":
            orderStatus = "SHIPPED";
            break;
          case "DELIVERED":
            orderStatus = "DELIVERED";
            break;
          case "RETURNED":
          case "LOST":
            orderStatus = "CANCELLED";
            break;
        }

        await OrderModel.findByIdAndUpdate(trackingItem.orderId._id, {
          order_status: orderStatus,
          ...(status === "DELIVERED" && { actual_delivery: new Date() }),
        });
      }

      // Send email notification for important status changes (only once for the group)
      const importantStatuses = [
        "PICKED_UP",
        "IN_TRANSIT",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
        "ATTEMPTED",
      ];

      if (importantStatuses.includes(status)) {
        try {
          const customer =
            tracking.orderId.userId || tracking.orderId.customerId;
          await sendShippingNotificationEmail({
            user: customer,
            order: tracking.orderId,
            tracking: tracking,
            latestEvent:
              tracking.trackingEvents[tracking.trackingEvents.length - 1],
            isGroupShipment: trackingsToUpdate.length > 1,
            groupItemCount: trackingsToUpdate.length,
          });
        } catch (emailError) {
          console.error(
            "Failed to send shipping notification email:",
            emailError
          );
        }
      }
    }

    // Return the updated tracking with group info
    const updatedTracking = await ShippingTrackingModel.findById(trackingId)
      .populate("orderId")
      .populate("shippingMethod")
      .populate("trackingEvents.updatedBy", "name");

    return response.json({
      message: `Tracking updated successfully${
        trackingsToUpdate.length > 1
          ? ` for ${trackingsToUpdate.length} items`
          : ""
      }`,
      data: {
        ...updatedTracking.toObject(),
        groupItemCount: trackingsToUpdate.length,
        trackingsUpdated: trackingsToUpdate.length,
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

export const getTrackingByNumber = async (request, response) => {
  try {
    const { trackingNumber } = request.params;

    const tracking = await ShippingTrackingModel.getByTrackingNumber(
      trackingNumber
    );

    if (!tracking) {
      return response.status(404).json({
        message: "Tracking number not found",
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
      message: "Tracking information retrieved successfully",
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

export const getTrackingStats = async (request, response) => {
  try {
    const stats = await ShippingTrackingModel.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const overdue = await ShippingTrackingModel.countDocuments({
      estimatedDelivery: { $lt: new Date() },
      status: { $nin: ["DELIVERED", "RETURNED", "LOST", "CANCELLED"] },
    });

    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const todayDeliveries = await ShippingTrackingModel.countDocuments({
      actualDelivery: { $gte: startOfDay, $lte: endOfDay },
    });

    const avgDeliveryTime = await ShippingTrackingModel.aggregate([
      { $match: { status: "DELIVERED", actualDelivery: { $exists: true } } },
      {
        $addFields: {
          deliveryDays: {
            $divide: [
              { $subtract: ["$actualDelivery", "$createdAt"] },
              1000 * 60 * 60 * 24,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgDays: { $avg: "$deliveryDays" },
        },
      },
    ]);

    return response.json({
      message: "Tracking statistics retrieved successfully",
      data: {
        statusBreakdown: stats,
        overdue,
        todayDeliveries,
        avgDeliveryTime: avgDeliveryTime[0]?.avgDays || 0,
        inTransit:
          stats.find((s) =>
            ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(s._id)
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
        message: "City and state are required",
        error: true,
        success: false,
      });
    }

    const zone = await ShippingZoneModel.findZoneByCity(city, state);

    const methods = await ShippingMethodModel.find({ isActive: true })
      .select("name code type description estimatedDelivery")
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
      message: "Public shipping methods retrieved successfully",
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

// Update getShippingMethods function
export const getShippingMethods = async (request, response) => {
  try {
    const { page = 1, limit = 10, search, type, isActive } = request.query;

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }
    if (type) {
      query.type = type;
    }
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    // Convert to integers and set max limit
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit))); // Max 50 per page
    const skip = (pageNum - 1) * limitNum;

    const [methods, totalCount] = await Promise.all([
      ShippingMethodModel.find(query)
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .sort({ sortOrder: 1, name: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ShippingMethodModel.countDocuments(query),
    ]);

    return response.json({
      message: "Shipping methods retrieved successfully",
      data: methods,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      currentPage: pageNum,
      itemsPerPage: limitNum,
      error: false,
      success: true, // FIXED: was false before
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Update getAllTrackings function (bonus - for tracking page)
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
    if (carrier) query["carrier.code"] = carrier.toUpperCase();
    if (priority) query.priority = priority;

    if (overdue === "true") {
      query.estimatedDelivery = { $lt: new Date() };
      query.status = { $nin: ["DELIVERED", "RETURNED", "LOST", "CANCELLED"] };
    }

    if (search) {
      query.$or = [
        { trackingNumber: { $regex: search, $options: "i" } },
        { "carrier.name": { $regex: search, $options: "i" } },
        { "recipientInfo.name": { $regex: search, $options: "i" } },
      ];
    }

    // Convert to integers and set max limit
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit))); // Max 50 per page
    const skip = (pageNum - 1) * limitNum;

    const [trackings, totalCount] = await Promise.all([
      ShippingTrackingModel.find(query)
        .populate("orderId", "orderId payment_status totalAmt")
        .populate("shippingMethod", "name type")
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      ShippingTrackingModel.countDocuments(query),
    ]);

    return response.json({
      message: "Trackings retrieved successfully",
      data: trackings,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      currentPage: pageNum,
      itemsPerPage: limitNum,
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

// Update getOrdersReadyForShipping function (bonus - for shipment creation)
export const getOrdersReadyForShipping = async (request, response) => {
  try {
    const { page = 1, limit = 20, search } = request.query;

    const query = {
      payment_status: "PAID",
      order_status: { $in: ["CONFIRMED", "PROCESSING"] },
    };

    // Add search functionality
    if (search) {
      query.$or = [
        { orderId: { $regex: search, $options: "i" } },
        { "userId.name": { $regex: search, $options: "i" } },
        { "userId.email": { $regex: search, $options: "i" } },
      ];
    }

    // Convert to integers and set max limit
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit))); // Max 50 per page
    const skip = (pageNum - 1) * limitNum;

    const [orders, totalCount] = await Promise.all([
      OrderModel.find(query)
        .populate("delivery_address")
        .populate("userId", "name email mobile")
        .populate("productId", "name image weight")
        .populate("shippingMethod", "name type")
        .populate("shippingZone", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      OrderModel.countDocuments(query),
    ]);

    return response.json({
      message: "Orders ready for shipping retrieved successfully",
      data: orders,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      currentPage: pageNum,
      itemsPerPage: limitNum,
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

// controllers/shipping.controller.js - ADD THIS NEW FUNCTION

// ===== NEW: GET ALL ZONES (NO PAGINATION) =====
export const getAllShippingZones = async (request, response) => {
  try {
    const { isActive, search } = request.query;

    const query = {};

    // Filter by active status if provided
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    // Add search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
        { "states.name": { $regex: search, $options: "i" } },
      ];
    }

    // Fetch ALL zones without pagination
    const zones = await ShippingZoneModel.find(query)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .sort({ sortOrder: 1, name: 1 })
      .lean(); // Use lean() for better performance

    // Calculate total LGAs covered for each zone
    const zonesWithLGACount = zones.map((zone) => {
      let totalLgasCovered = 0;

      zone.states.forEach((state) => {
        if (state.coverage_type === "all") {
          totalLgasCovered += state.available_lgas?.length || 0;
        } else if (state.coverage_type === "specific") {
          totalLgasCovered += state.covered_lgas?.length || 0;
        }
      });

      return {
        ...zone,
        total_lgas_covered: totalLgasCovered,
      };
    });

    console.log(`✅ Fetched ${zonesWithLGACount.length} zones (no pagination)`);

    return response.json({
      message: "All shipping zones retrieved successfully",
      data: zonesWithLGACount,
      totalCount: zonesWithLGACount.length,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get all shipping zones error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve shipping zones",
      error: true,
      success: false,
    });
  }
};

// ===== FIXED: GET SHIPPING ZONES (WITH PAGINATION) =====
export const getShippingZones = async (request, response) => {
  try {
    const { page = 1, limit = 10, search, isActive } = request.query;

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
        { "states.name": { $regex: search, $options: "i" } },
      ];
    }
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    // Convert to integers and set max limit
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [zones, totalCount] = await Promise.all([
      ShippingZoneModel.find(query)
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .sort({ sortOrder: 1, name: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ShippingZoneModel.countDocuments(query),
    ]);

    // Calculate total LGAs covered for each zone
    const zonesWithLGACount = zones.map((zone) => {
      let totalLgasCovered = 0;

      zone.states.forEach((state) => {
        if (state.coverage_type === "all") {
          totalLgasCovered += state.available_lgas?.length || 0;
        } else if (state.coverage_type === "specific") {
          totalLgasCovered += state.covered_lgas?.length || 0;
        }
      });

      return {
        ...zone,
        total_lgas_covered: totalLgasCovered,
      };
    });

    console.log(
      `✅ Fetched ${
        zonesWithLGACount.length
      } zones (page ${pageNum}/${Math.ceil(totalCount / limitNum)})`
    );

    return response.json({
      message: "Shipping zones retrieved successfully",
      data: zonesWithLGACount,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      currentPage: pageNum,
      itemsPerPage: limitNum,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get shipping zones error:", error);
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// ===== FIXED: GET SHIPPING DASHBOARD STATS =====
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
      activeZones,
      totalMethods,
      activeMethods,
    ] = await Promise.all([
      OrderModel.countDocuments({
        payment_status: "PAID",
        order_status: { $in: ["CONFIRMED", "PROCESSING"] },
      }),
      ShippingTrackingModel.countDocuments({
        status: { $in: ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"] },
      }),
      ShippingTrackingModel.countDocuments({
        status: "DELIVERED",
      }),
      ShippingTrackingModel.countDocuments({
        estimatedDelivery: { $lt: new Date() },
        status: { $nin: ["DELIVERED", "RETURNED", "LOST", "CANCELLED"] },
      }),
      ShippingTrackingModel.countDocuments({
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      }),
      ShippingTrackingModel.countDocuments({
        actualDelivery: { $gte: startOfDay, $lte: endOfDay },
      }),
      ShippingZoneModel.countDocuments({}), // Total zones
      ShippingZoneModel.countDocuments({ isActive: true }), // Active zones only
      ShippingMethodModel.countDocuments({}), // Total methods
      ShippingMethodModel.countDocuments({ isActive: true }), // Active methods only
    ]);

    console.log("📊 Dashboard Stats:", {
      totalZones,
      activeZones,
      totalMethods,
      activeMethods,
    });

    return response.json({
      message: "Shipping dashboard stats retrieved successfully",
      data: {
        readyForShipping,
        inTransit,
        delivered,
        overdue,
        todayShipments,
        todayDeliveries,
        totalZones,
        activeZones, // NEW: Separate active zones count
        totalMethods,
        activeMethods, // NEW: Separate active methods count
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get dashboard stats error:", error);
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
