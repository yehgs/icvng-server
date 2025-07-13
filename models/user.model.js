import mongoose from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Provide name'],
    },
    email: {
      type: String,
      required: [true, 'Provide email'],
      unique: true,
    },
    password: {
      type: String,
      required: [true, 'Provide password'],
    },
    avatar: {
      type: String,
      default: '',
    },
    mobile: {
      type: Number,
      default: null,
    },
    refresh_token: {
      type: String,
      default: '',
    },
    verify_email: {
      type: Boolean,
      default: false,
    },
    last_login_date: {
      type: Date,
      default: '',
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Suspended'],
      default: 'Active',
    },
    address_details: [
      {
        type: mongoose.Schema.ObjectId,
        ref: 'address',
      },
    ],
    shopping_cart: [
      {
        type: mongoose.Schema.ObjectId,
        ref: 'cartProduct',
      },
    ],
    orderHistory: [
      {
        type: mongoose.Schema.ObjectId,
        ref: 'order',
      },
    ],
    forgot_password_otp: {
      type: String,
      default: null,
    },
    forgot_password_expiry: {
      type: Date,
      default: '',
    },
    role: {
      type: String,
      enum: ['ADMIN', 'USER'],
      default: 'USER',
    },
    subRole: {
      type: String,
      enum: [
        'DIRECTOR',
        'SALES',
        'HR',
        'MANAGER',
        'ACCOUNTANT',
        'GRAPHICS',
        'EDITOR',
        'LOGISTICS',
        'BTC',
        'BTB',
        'IT',
        'WAREHOUSE',
        null,
      ],
      default: null,
      validate: {
        validator: function (value) {
          if (!value) return true;
          const adminRoles = [
            'IT',
            'DIRECTOR',
            'SALES',
            'HR',
            'MANAGER',
            'WAREHOUSE',
            'ACCOUNTANT',
            'GRAPHICS',
            'LOGISTICS',
            'EDITOR',
          ];
          const userRoles = ['BTC', 'BTB'];
          if (this.role === 'ADMIN') return adminRoles.includes(value);
          if (this.role === 'USER') return userRoles.includes(value);
          return false;
        },
        message: 'Invalid subRole for the given role',
      },
    },
  },
  {
    timestamps: true,
  }
);

// Add pagination plugin BEFORE creating the model
userSchema.plugin(mongoosePaginate);

// Create indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ role: 1, subRole: 1 });
userSchema.index({ status: 1 });
userSchema.index({ createdAt: -1 });

const UserModel = mongoose.model('User', userSchema);

export default UserModel;
