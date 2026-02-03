// controllers/coupon.controller.js
import CouponModel from "../models/coupon.model.js";
import UserModel from "../models/user.model.js";

/**
 * Create Coupon (Sales/Manager)
 */
export const createCoupon = async (req, res) => {
  try {
    const userId = req.userId;
    const {
      code,
      description,
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscountAmount,
      validFrom,
      validUntil,
      usageLimit,
      applicableProducts,
      applicableCategories,
      customerType,
    } = req.body;

    // Validation
    if (!code || !discountType || !discountValue || !validUntil) {
      return res.status(400).json({
        message: "Please provide all required fields",
        error: true,
        success: false,
      });
    }

    // Check if coupon code already exists
    const existingCoupon = await CouponModel.findOne({
      code: code.toUpperCase(),
    });

    if (existingCoupon) {
      return res.status(400).json({
        message: "Coupon code already exists",
        error: true,
        success: false,
      });
    }

    const coupon = new CouponModel({
      code: code.toUpperCase(),
      description,
      discountType,
      discountValue,
      minOrderAmount: minOrderAmount || 0,
      maxDiscountAmount: maxDiscountAmount || null,
      validFrom: validFrom || new Date(),
      validUntil: new Date(validUntil),
      usageLimit: usageLimit || null,
      applicableProducts: applicableProducts || [],
      applicableCategories: applicableCategories || [],
      customerType: customerType || "BTB",
      createdBy: userId,
      isActive: true,
    });

    await coupon.save();

    res.status(201).json({
      message: "Coupon created successfully",
      error: false,
      success: true,
      data: coupon,
    });
  } catch (error) {
    console.error("Create coupon error:", error);
    res.status(500).json({
      message: error.message || "Failed to create coupon",
      error: true,
      success: false,
    });
  }
};

/**
 * Get All Coupons
 */
export const getAllCoupons = async (req, res) => {
  try {
    const { isActive, customerType } = req.query;

    const query = {};
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }
    if (customerType) {
      query.customerType = { $in: [customerType, "ALL"] };
    }

    const coupons = await CouponModel.find(query)
      .populate("createdBy", "name email")
      .populate("applicableProducts", "name sku")
      .populate("applicableCategories", "name")
      .sort({ createdAt: -1 });

    res.status(200).json({
      message: "Coupons fetched successfully",
      error: false,
      success: true,
      data: coupons,
    });
  } catch (error) {
    console.error("Get coupons error:", error);
    res.status(500).json({
      message: error.message || "Failed to fetch coupons",
      error: true,
      success: false,
    });
  }
};

/**
 * Validate Coupon
 */
export const validateCoupon = async (req, res) => {
  try {
    const { code, orderAmount } = req.body;

    if (!code) {
      return res.status(400).json({
        message: "Coupon code is required",
        error: true,
        success: false,
      });
    }

    const coupon = await CouponModel.findOne({
      code: code.toUpperCase(),
    });

    if (!coupon) {
      return res.status(404).json({
        message: "Invalid coupon code",
        error: true,
        success: false,
      });
    }

    if (!coupon.isValid()) {
      return res.status(400).json({
        message: "Coupon is expired or inactive",
        error: true,
        success: false,
      });
    }

    if (
      orderAmount &&
      coupon.minOrderAmount &&
      orderAmount < coupon.minOrderAmount
    ) {
      return res.status(400).json({
        message: `Minimum order amount for this coupon is ₦${coupon.minOrderAmount.toLocaleString()}`,
        error: true,
        success: false,
      });
    }

    // Calculate discount
    let discountAmount = 0;
    if (orderAmount) {
      if (coupon.discountType === "PERCENTAGE") {
        discountAmount = (orderAmount * coupon.discountValue) / 100;
        if (
          coupon.maxDiscountAmount &&
          discountAmount > coupon.maxDiscountAmount
        ) {
          discountAmount = coupon.maxDiscountAmount;
        }
      } else {
        discountAmount = coupon.discountValue;
      }
    }

    res.status(200).json({
      message: "Coupon is valid",
      error: false,
      success: true,
      data: {
        coupon,
        discountAmount,
      },
    });
  } catch (error) {
    console.error("Validate coupon error:", error);
    res.status(500).json({
      message: error.message || "Failed to validate coupon",
      error: true,
      success: false,
    });
  }
};

/**
 * Update Coupon
 */
export const updateCoupon = async (req, res) => {
  try {
    const { couponId } = req.params;
    const updateData = req.body;

    const coupon = await CouponModel.findByIdAndUpdate(couponId, updateData, {
      new: true,
      runValidators: true,
    });

    if (!coupon) {
      return res.status(404).json({
        message: "Coupon not found",
        error: true,
        success: false,
      });
    }

    res.status(200).json({
      message: "Coupon updated successfully",
      error: false,
      success: true,
      data: coupon,
    });
  } catch (error) {
    console.error("Update coupon error:", error);
    res.status(500).json({
      message: error.message || "Failed to update coupon",
      error: true,
      success: false,
    });
  }
};

/**
 * Delete Coupon
 */
export const deleteCoupon = async (req, res) => {
  try {
    const { couponId } = req.params;

    const coupon = await CouponModel.findByIdAndDelete(couponId);

    if (!coupon) {
      return res.status(404).json({
        message: "Coupon not found",
        error: true,
        success: false,
      });
    }

    res.status(200).json({
      message: "Coupon deleted successfully",
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Delete coupon error:", error);
    res.status(500).json({
      message: error.message || "Failed to delete coupon",
      error: true,
      success: false,
    });
  }
};
