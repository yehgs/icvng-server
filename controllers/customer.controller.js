// controllers/customer.controller.js
import CustomerModel from '../models/customer.model.js';
import UserModel from '../models/user.model.js';
import mongoose from 'mongoose';

// Create new customer
export const createCustomerController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    // Only DIRECTOR, IT, EDITOR, MANAGER, and SALES can create customers
    const allowedRoles = ['DIRECTOR', 'IT', 'EDITOR', 'MANAGER', 'SALES'];
    if (user.role !== 'ADMIN' || !allowedRoles.includes(user.subRole)) {
      return response.status(403).json({
        message: 'You do not have permission to create customers',
        error: true,
        success: false,
      });
    }

    const {
      name,
      email,
      mobile,
      image,
      address,
      customerType,
      customerMode,
      companyName,
      registrationNumber,
      notes,
      assignedTo,
    } = request.body;

    // Validate required fields for BTB customers
    if (customerType === 'BTB') {
      if (!companyName || !registrationNumber) {
        return response.status(400).json({
          message:
            'Company name and registration number (CAC) are required for BTB customers',
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
      image: image || '',
      address,
      customerType,
      customerMode,
      companyName: customerType === 'BTB' ? companyName : undefined,
      registrationNumber:
        customerType === 'BTB' ? registrationNumber : undefined,
      createdBy: userId,
      isWebsiteCustomer: false,
      notes,
      assignedTo: assignedTo || [userId],
    };

    const newCustomer = new CustomerModel(customerData);
    const savedCustomer = await newCustomer.save();

    await savedCustomer.populate([
      { path: 'createdBy', select: 'name email subRole' },
      { path: 'assignedTo', select: 'name email subRole' },
    ]);

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

    // Check if user has permission
    const allowedRoles = [
      'DIRECTOR',
      'IT',
      'EDITOR',
      'MANAGER',
      'SALES',
      'ACCOUNTANT',
    ];
    if (user.role !== 'ADMIN' || !allowedRoles.includes(user.subRole)) {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
        success: false,
      });
    }

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
    if (['DIRECTOR', 'IT', 'MANAGER'].includes(user.subRole)) {
      // Can see all customers
      query = {};
    } else {
      // Can only see customers they created or are assigned to
      query = {
        $or: [
          { createdBy: userId },
          { assignedTo: userId },
          { isWebsiteCustomer: true },
        ],
      };
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
          { registrationNumber: searchRegex },
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
        {
          path: 'assignedTo',
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

    // Check if user has permission
    const allowedRoles = [
      'DIRECTOR',
      'IT',
      'EDITOR',
      'MANAGER',
      'SALES',
      'ACCOUNTANT',
    ];
    if (user.role !== 'ADMIN' || !allowedRoles.includes(user.subRole)) {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
        success: false,
      });
    }

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
    if (['DIRECTOR', 'IT', 'MANAGER'].includes(user.subRole)) {
      // Can update any customer
    } else {
      // Can only update customers they created or are assigned to
      const canUpdate =
        customer.createdBy?.toString() === userId ||
        customer.assignedTo?.some((id) => id.toString() === userId) ||
        customer.isWebsiteCustomer;

      if (!canUpdate) {
        return response.status(403).json({
          message: 'You can only update customers you created or are assigned to',
          error: true,
          success: false,
        });
      }
    }

    const updateData = request.body;

    // Remove fields that shouldn't be updated by regular users
    if (!['DIRECTOR', 'IT', 'MANAGER'].includes(user.subRole)) {
      delete updateData.assignedTo;
      delete updateData.createdBy;
    }

    delete updateData.isWebsiteCustomer;
    delete updateData._id;

    // Validate BTB requirements if customerType is being updated
    if (updateData.customerType === 'BTB') {
      if (!updateData.companyName || !updateData.registrationNumber) {
        return response.status(400).json({
          message:
            'Company name and registration number (CAC) are required for BTB customers',
          error: true,
          success: false,
        });
      }
    }

    const updatedCustomer = await CustomerModel.findByIdAndUpdate(
      customerId,
      updateData,
      { new: true, runValidators: true }
    ).populate([
      { path: 'createdBy', select: 'name email subRole' },
      { path: 'assignedTo', select: 'name email subRole' },
    ]);

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

    // Check if user has permission
    const allowedRoles = [
      'DIRECTOR',
      'IT',
      'EDITOR',
      'MANAGER',
      'SALES',
      'ACCOUNTANT',
    ];
    if (user.role !== 'ADMIN' || !allowedRoles.includes(user.subRole)) {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
        success: false,
      });
    }

    const customer = await CustomerModel.findById(customerId).populate([
      { path: 'createdBy', select: 'name email subRole' },
      { path: 'assignedTo', select: 'name email subRole' },
    ]);

    if (!customer) {
      return response.status(404).json({
        message: 'Customer not found',
        error: true,
        success: false,
      });
    }

    // Permission check
    if (['DIRECTOR', 'IT', 'MANAGER'].includes(user.subRole)) {
      // Can view any customer
    } else {
      // Can only view customers they created or are assigned to
      const canView =
        customer.createdBy?.toString() === userId ||
        customer.assignedTo?.some((id) => id.toString() === userId) ||
        customer.isWebsiteCustomer;

      if (!canView) {
        return response.status(403).json({
          message: 'You can only view customers you created or are assigned to',
          error: true,
          success: false,
        });
      }
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

    // Only specific roles can access this
    const allowedRoles = [
      'DIRECTOR',
      'IT',
      'EDITOR',
      'MANAGER',
      'SALES',
      'ACCOUNTANT',
    ];
    if (user.role !== 'ADMIN' || !allowedRoles.includes(user.subRole)) {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
        success: false,
      });
    }

    let query = { status: 'ACTIVE' };

    // Role-based filtering
    if (['DIRECTOR', 'IT', 'MANAGER'].includes(user.subRole)) {
      // Can see all active customers
      query = { status: 'ACTIVE' };
    } else {
      // Can only see customers they created or are assigned to
      query = {
        status: 'ACTIVE',
        $or: [
          { createdBy: userId },
          { assignedTo: userId },
          { isWebsiteCustomer: true },
        ],
      };
    }

    const customers = await CustomerModel.find(query)
      .select(
        'name email customerType customerMode companyName isWebsiteCustomer image'
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

// Assign customer to users (DIRECTOR, IT, MANAGER only)
export const assignCustomerController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);
    const { customerId } = request.params;
    const { userIds } = request.body;

    // Only DIRECTOR, IT, MANAGER can assign customers
    if (
      user.role !== 'ADMIN' ||
      !['DIRECTOR', 'IT', 'MANAGER'].includes(user.subRole)
    ) {
      return response.status(403).json({
        message: 'Only directors, IT, and managers can assign customers',
        error: true,
        success: false,
      });
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return response.status(400).json({
        message: 'At least one user ID is required',
        error: true,
        success: false,
      });
    }

    // Verify all user IDs exist
    const users = await UserModel.find({
      _id: { $in: userIds },
      role: 'ADMIN',
    });

    if (users.length !== userIds.length) {
      return response.status(400).json({
        message: 'One or more invalid user IDs',
        error: true,
        success: false,
      });
    }

    const customer = await CustomerModel.findByIdAndUpdate(
      customerId,
      { assignedTo: userIds },
      { new: true, runValidators: true }
    ).populate([
      { path: 'createdBy', select: 'name email subRole' },
      { path: 'assignedTo', select: 'name email subRole' },
    ]);

    if (!customer) {
      return response.status(404).json({
        message: 'Customer not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Customer assigned successfully',
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

// Export customers CSV (DIRECTOR and IT only)
export const exportCustomersController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    // Only DIRECTOR and IT can export
    if (
      user.role !== 'ADMIN' ||
      !['DIRECTOR', 'IT'].includes(user.subRole)
    ) {
      return response.status(403).json({
        message: 'Only directors and IT can export customer data',
        error: true,
        success: false,
      });
    }

    const customers = await CustomerModel.find({})
      .populate([
        { path: 'createdBy', select: 'name email' },
        { path: 'assignedTo', select: 'name email' },
      ])
      .sort({ createdAt: -1 });

    const csvData = customers.map((customer) => ({
      Name: customer.name,
      Email: customer.email,
      Mobile: customer.mobile,
      'Customer Type': customer.customerType,
      'Customer Mode': customer.customerMode,
      'Company Name': customer.companyName || '',
      'Registration Number': customer.registrationNumber || '',
      Status: customer.status,
      'Created By': customer.isWebsiteCustomer
        ? 'Website'
        : customer.createdBy?.name || 'Unknown',
      'Assigned To': customer.assignedTo?.map((u) => u.name).join(', ') || '',
      'Created Date': customer.createdAt.toISOString().split('T')[0],
      'Total Orders': customer.totalOrders,
      'Total Order Value': customer.totalOrderValue,
      'Last Order Date': customer.lastOrderDate
        ? customer.lastOrderDate.toISOString().split('T')[0]
        : '',
      'Address Street': customer.address?.street || '',
      'Address City': customer.address?.city || '',
      'Address State': customer.address?.state || '',
      'Address Postal Code': customer.address?.postalCode || '',
      Notes: customer.notes || '',
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

// Get assignable users (for assignment dropdown)
export const getAssignableUsersController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    // Only DIRECTOR, IT, MANAGER can access this
    if (
      user.role !== 'ADMIN' ||
      !['DIRECTOR', 'IT', 'MANAGER'].includes(user.subRole)
    ) {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
        success: false,
      });
    }

    const allowedSubRoles = [
      'DIRECTOR',
      'IT',
      'EDITOR',
      'MANAGER',
      'SALES',
      'ACCOUNTANT',
    ];

    const users = await UserModel.find({
      role: 'ADMIN',
      subRole: { $in: allowedSubRoles },
      status: 'Active',
    })
      .select('name email subRole')
      .sort({ name: 1 });

    return response.json({
      message: 'Assignable users retrieved successfully',
      data: users,
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


// Toggle featured status (EDITOR, IT, DIRECTOR only)
export const toggleFeaturedCustomerController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);
    const { customerId } = request.params;

    // Only EDITOR, IT, DIRECTOR can feature customers
    if (
      user.role !== 'ADMIN' ||
      !['EDITOR', 'IT', 'DIRECTOR'].includes(user.subRole)
    ) {
      return response.status(403).json({
        message: 'Only editors, IT, and directors can feature customers',
        error: true,
        success: false,
      });
    }

    const customer = await CustomerModel.findById(customerId);

    if (!customer) {
      return response.status(404).json({
        message: 'Customer not found',
        error: true,
        success: false,
      });
    }

    // Check if customer has an image - CRITICAL REQUIREMENT
    if (!customer.image || customer.image === '') {
      return response.status(400).json({
        message: 'Only customers with images can be featured',
        error: true,
        success: false,
      });
    }

    // Toggle featured status
    const newFeaturedStatus = !customer.isFeatured;

    const updateData = {
      isFeatured: newFeaturedStatus,
      featuredAt: newFeaturedStatus ? new Date() : null,
      featuredBy: newFeaturedStatus ? userId : null,
    };

    const updatedCustomer = await CustomerModel.findByIdAndUpdate(
      customerId,
      updateData,
      { new: true, runValidators: true }
    ).populate([
      { path: 'createdBy', select: 'name email subRole' },
      { path: 'assignedTo', select: 'name email subRole' },
      { path: 'featuredBy', select: 'name email subRole' },
    ]);

    return response.json({
      message: newFeaturedStatus
        ? 'Customer featured successfully'
        : 'Customer unfeatured successfully',
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

// Get featured customers (public/all users)
export const getFeaturedCustomersController = async (request, response) => {
  try {
    const { limit = 10 } = request.query;

    const featuredCustomers = await CustomerModel.find({
      isFeatured: true,
      status: 'ACTIVE',
      image: { $ne: '' }, // Ensure image exists
    })
      .populate([
        { path: 'createdBy', select: 'name email subRole' },
        { path: 'featuredBy', select: 'name email subRole' },
      ])
      .sort({ featuredAt: -1 })
      .limit(parseInt(limit));

    return response.json({
      message: 'Featured customers retrieved successfully',
      data: featuredCustomers,
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