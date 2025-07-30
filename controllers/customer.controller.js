// controllers/customer.controller.js
import CustomerModel from '../models/customer.model.js';
import UserModel from '../models/user.model.js';
import mongoose from 'mongoose';

// Create new customer
export const createCustomerController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    // Only SALES subrole can create customers
    if (user.role !== 'ADMIN' || user.subRole !== 'SALES') {
      return response.status(403).json({
        message: 'Only sales agents can create customers',
        error: true,
        success: false,
      });
    }

    const {
      name,
      email,
      mobile,
      address,
      customerType,
      customerMode,
      companyName,
      taxNumber,
      notes,
    } = request.body;

    // Validate required fields for BTB customers
    if (customerType === 'BTB') {
      if (!companyName || !taxNumber) {
        return response.status(400).json({
          message: 'Company name and tax number are required for BTB customers',
          error: true,
          success: false,
        });
      }
    }

    // Check if customer email already exists
    const existingCustomer = await CustomerModel.findOne({ email });
    if (existingCustomer) {
      return response.status(400).json({
        message: 'Customer with this email already exists',
        error: true,
        success: false,
      });
    }

    const customerData = {
      name,
      email,
      mobile,
      address,
      customerType,
      customerMode,
      companyName: customerType === 'BTB' ? companyName : undefined,
      taxNumber: customerType === 'BTB' ? taxNumber : undefined,
      createdBy: userId,
      isWebsiteCustomer: false,
      notes,
    };

    const newCustomer = new CustomerModel(customerData);
    const savedCustomer = await newCustomer.save();

    return response.json({
      message: 'Customer created successfully',
      data: savedCustomer,
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

// Get customers list with dynamic filtering based on user role
export const getCustomersController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    const {
      page = 1,
      limit = 10,
      search,
      customerType,
      customerMode,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = request.query;

    // Build query based on user role
    let query = {};

    // Role-based filtering
    if (user.role === 'ADMIN') {
      if (['IT', 'MANAGER', 'DIRECTOR'].includes(user.subRole)) {
        // Can see all customers
        query = {};
      } else if (user.subRole === 'SALES') {
        // Can only see customers they created or website customers
        query = {
          $or: [{ createdBy: userId }, { isWebsiteCustomer: true }],
        };
      } else {
        return response.status(403).json({
          message: 'Access denied',
          error: true,
          success: false,
        });
      }
    } else {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
        success: false,
      });
    }

    // Add filters
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { name: searchRegex },
          { email: searchRegex },
          { mobile: searchRegex },
          { companyName: searchRegex },
        ],
      });
    }

    if (customerType) query.customerType = customerType;
    if (customerMode) query.customerMode = customerMode;
    if (status) query.status = status;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 },
      populate: [
        {
          path: 'createdBy',
          select: 'name email subRole',
        },
      ],
    };

    const customers = await CustomerModel.paginate(query, options);

    return response.json({
      message: 'Customers retrieved successfully',
      data: customers,
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

// Update customer
export const updateCustomerController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);
    const { customerId } = request.params;

    // Check if customer exists
    const customer = await CustomerModel.findById(customerId);
    if (!customer) {
      return response.status(404).json({
        message: 'Customer not found',
        error: true,
        success: false,
      });
    }

    // Permission check
    if (user.role === 'ADMIN') {
      if (['IT', 'MANAGER', 'DIRECTOR'].includes(user.subRole)) {
        // Can update any customer
      } else if (user.subRole === 'SALES') {
        // Can only update customers they created
        if (
          customer.createdBy?.toString() !== userId &&
          !customer.isWebsiteCustomer
        ) {
          return response.status(403).json({
            message: 'You can only update customers you created',
            error: true,
            success: false,
          });
        }
      } else {
        return response.status(403).json({
          message: 'Access denied',
          error: true,
          success: false,
        });
      }
    } else {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
        success: false,
      });
    }

    const updateData = request.body;

    // Remove fields that shouldn't be updated
    delete updateData.createdBy;
    delete updateData.isWebsiteCustomer;
    delete updateData._id;

    const updatedCustomer = await CustomerModel.findByIdAndUpdate(
      customerId,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email subRole');

    return response.json({
      message: 'Customer updated successfully',
      data: updatedCustomer,
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

// Get customer details
export const getCustomerDetailsController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);
    const { customerId } = request.params;

    const customer = await CustomerModel.findById(customerId).populate(
      'createdBy',
      'name email subRole'
    );

    if (!customer) {
      return response.status(404).json({
        message: 'Customer not found',
        error: true,
        success: false,
      });
    }

    // Permission check
    if (user.role === 'ADMIN') {
      if (['IT', 'MANAGER', 'DIRECTOR'].includes(user.subRole)) {
        // Can view any customer
      } else if (user.subRole === 'SALES') {
        // Can only view customers they created or website customers
        if (
          customer.createdBy?.toString() !== userId &&
          !customer.isWebsiteCustomer
        ) {
          return response.status(403).json({
            message: 'You can only view customers you created',
            error: true,
            success: false,
          });
        }
      } else {
        return response.status(403).json({
          message: 'Access denied',
          error: true,
          success: false,
        });
      }
    } else {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Customer details retrieved successfully',
      data: customer,
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

// Get customers for dropdown (for order creation)
export const getCustomersForOrderController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    // Only SALES, IT, MANAGER, DIRECTOR can access this
    if (
      user.role !== 'ADMIN' ||
      !['SALES', 'IT', 'MANAGER', 'DIRECTOR'].includes(user.subRole)
    ) {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
        success: false,
      });
    }

    let query = { status: 'ACTIVE' };

    // Role-based filtering
    if (['IT', 'MANAGER', 'DIRECTOR'].includes(user.subRole)) {
      // Can see all active customers
      query = { status: 'ACTIVE' };
    } else if (user.subRole === 'SALES') {
      // Can only see customers they created or website customers
      query = {
        status: 'ACTIVE',
        $or: [{ createdBy: userId }, { isWebsiteCustomer: true }],
      };
    }

    const customers = await CustomerModel.find(query)
      .select(
        'name email customerType customerMode companyName isWebsiteCustomer'
      )
      .sort({ name: 1 });

    return response.json({
      message: 'Customers for order retrieved successfully',
      data: customers,
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

// Export customers CSV (DIRECTOR only)
export const exportCustomersController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    // Only DIRECTOR can export
    if (user.role !== 'ADMIN' || user.subRole !== 'DIRECTOR') {
      return response.status(403).json({
        message: 'Only directors can export customer data',
        error: true,
        success: false,
      });
    }

    const customers = await CustomerModel.find({})
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    const csvData = customers.map((customer) => ({
      Name: customer.name,
      Email: customer.email,
      Mobile: customer.mobile,
      'Customer Type': customer.customerType,
      'Customer Mode': customer.customerMode,
      'Company Name': customer.companyName || '',
      'Tax Number': customer.taxNumber || '',
      Status: customer.status,
      'Created By': customer.isWebsiteCustomer
        ? 'Website'
        : customer.createdBy?.name || 'Unknown',
      'Created Date': customer.createdAt.toISOString().split('T')[0],
      'Total Orders': customer.totalOrders,
      'Total Order Value': customer.totalOrderValue,
    }));

    return response.json({
      message: 'Customer data exported successfully',
      data: csvData,
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
