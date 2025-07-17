// scripts/seedLogisticsData.js - Seed script for logistics zones and methods
import mongoose from 'mongoose';
import { nigeriaStatesLgas } from '../data/nigeria-states-lgas.js';
import ShippingZoneModel from '../models/shipping-zone.model.js';
import ShippingMethodModel from '../models/shipping-method.model.js';
import UserModel from '../models/user.model.js';
import dotenv from 'dotenv';

dotenv.config();

// Geopolitical zones mapping
const geopoliticalZones = {
  'North Central': [
    'Benue',
    'FCT',
    'Kogi',
    'Kwara',
    'Nasarawa',
    'Niger',
    'Plateau',
  ],
  'North East': ['Adamawa', 'Bauchi', 'Borno', 'Gombe', 'Taraba', 'Yobe'],
  'North West': [
    'Jigawa',
    'Kaduna',
    'Kano',
    'Katsina',
    'Kebbi',
    'Sokoto',
    'Zamfara',
  ],
  'South East': ['Abia', 'Anambra', 'Ebonyi', 'Enugu', 'Imo'],
  'South South': [
    'Akwa Ibom',
    'Bayelsa',
    'Cross River',
    'Delta',
    'Edo',
    'Rivers',
  ],
  'South West': ['Ekiti', 'Lagos', 'Ogun', 'Ondo', 'Osun', 'Oyo'],
};

// Get geopolitical zone for a state
const getGeopoliticalZone = (stateName) => {
  for (const [zone, states] of Object.entries(geopoliticalZones)) {
    if (states.includes(stateName)) {
      return zone;
    }
  }
  return 'North Central'; // Default fallback
};

// Create complete state data with LGAs
const createStateData = (stateName) => {
  const stateInfo = nigeriaStatesLgas.find(
    (s) => s.state.toLowerCase() === stateName.toLowerCase()
  );

  if (!stateInfo) {
    console.warn(`⚠️ State not found: ${stateName}`);
    return {
      name: stateName,
      code: stateName.substring(0, 2).toUpperCase(),
      capital: stateName,
      lgas: [],
      geopolitical_zone: getGeopoliticalZone(stateName),
    };
  }

  return {
    name: stateInfo.state,
    code: stateInfo.state.substring(0, 2).toUpperCase(),
    capital: stateInfo.capital,
    lgas: stateInfo.lga.map((lga) => ({
      name: lga,
      major_towns: [lga],
      postal_codes: [],
    })),
    geopolitical_zone: getGeopoliticalZone(stateInfo.state),
  };
};

// Predefined shipping zones data
const shippingZonesData = [
  {
    name: 'Lagos Metro Zone',
    code: 'LMZ',
    description: 'Lagos metropolitan area with express delivery options',
    states: ['Lagos'],
    zone_type: 'urban',
    priority: 'high',
    sortOrder: 1,
    coverage_area_km2: 3577,
    population_estimate: 15000000,
    delivery_options: {
      standard_delivery: { available: true, estimated_days: 1 },
      express_delivery: { available: true, estimated_days: 1 },
      pickup_points: { available: true, locations: [] },
    },
    operational_notes: 'Primary delivery hub with same-day delivery available',
  },
  {
    name: 'Abuja Capital Zone',
    code: 'ACZ',
    description: 'Federal Capital Territory delivery zone',
    states: ['FCT'],
    zone_type: 'urban',
    priority: 'high',
    sortOrder: 2,
    coverage_area_km2: 7315,
    population_estimate: 3000000,
    delivery_options: {
      standard_delivery: { available: true, estimated_days: 2 },
      express_delivery: { available: true, estimated_days: 1 },
      pickup_points: { available: true, locations: [] },
    },
    operational_notes: 'Capital city with priority delivery services',
  },
  {
    name: 'South West Zone',
    code: 'SWZ',
    description: 'South Western states excluding Lagos',
    states: ['Ekiti', 'Ogun', 'Ondo', 'Osun', 'Oyo'],
    zone_type: 'mixed',
    priority: 'medium',
    sortOrder: 3,
    coverage_area_km2: 77284,
    population_estimate: 20000000,
    delivery_options: {
      standard_delivery: { available: true, estimated_days: 3 },
      express_delivery: { available: true, estimated_days: 2 },
      pickup_points: { available: false, locations: [] },
    },
    operational_notes: 'Good road network with reliable delivery times',
  },
  {
    name: 'South East Zone',
    code: 'SEZ',
    description: 'South Eastern states delivery zone',
    states: ['Abia', 'Anambra', 'Ebonyi', 'Enugu', 'Imo'],
    zone_type: 'mixed',
    priority: 'medium',
    sortOrder: 4,
    coverage_area_km2: 28973,
    population_estimate: 16000000,
    delivery_options: {
      standard_delivery: { available: true, estimated_days: 4 },
      express_delivery: { available: true, estimated_days: 3 },
      pickup_points: { available: false, locations: [] },
    },
    operational_notes: 'Commercial hub with growing e-commerce demand',
  },
  {
    name: 'South South Zone',
    code: 'SSZ',
    description: 'South Southern states delivery zone',
    states: ['Akwa Ibom', 'Bayelsa', 'Cross River', 'Delta', 'Edo', 'Rivers'],
    zone_type: 'mixed',
    priority: 'medium',
    sortOrder: 5,
    coverage_area_km2: 79775,
    population_estimate: 21000000,
    delivery_options: {
      standard_delivery: { available: true, estimated_days: 5 },
      express_delivery: { available: true, estimated_days: 3 },
      pickup_points: { available: false, locations: [] },
    },
    operational_notes: 'Oil-rich region with challenging terrain in some areas',
  },
  {
    name: 'North Central Zone',
    code: 'NCZ',
    description: 'North Central states excluding FCT',
    states: ['Benue', 'Kogi', 'Kwara', 'Nasarawa', 'Niger', 'Plateau'],
    zone_type: 'mixed',
    priority: 'medium',
    sortOrder: 6,
    coverage_area_km2: 295000,
    population_estimate: 15000000,
    delivery_options: {
      standard_delivery: { available: true, estimated_days: 5 },
      express_delivery: { available: false, estimated_days: 3 },
      pickup_points: { available: false, locations: [] },
    },
    operational_notes: 'Middle belt region with seasonal access challenges',
  },
  {
    name: 'North West Zone',
    code: 'NWZ',
    description: 'North Western states delivery zone',
    states: [
      'Jigawa',
      'Kaduna',
      'Kano',
      'Katsina',
      'Kebbi',
      'Sokoto',
      'Zamfara',
    ],
    zone_type: 'mixed',
    priority: 'medium',
    sortOrder: 7,
    coverage_area_km2: 194000,
    population_estimate: 35000000,
    delivery_options: {
      standard_delivery: { available: true, estimated_days: 6 },
      express_delivery: { available: false, estimated_days: 4 },
      pickup_points: { available: false, locations: [] },
    },
    operational_notes: 'Most populous region with security considerations',
  },
  {
    name: 'North East Zone',
    code: 'NEZ',
    description: 'North Eastern states delivery zone',
    states: ['Adamawa', 'Bauchi', 'Borno', 'Gombe', 'Taraba', 'Yobe'],
    zone_type: 'mixed',
    priority: 'low',
    sortOrder: 8,
    coverage_area_km2: 278000,
    population_estimate: 18000000,
    delivery_options: {
      standard_delivery: { available: true, estimated_days: 7 },
      express_delivery: { available: false, estimated_days: 5 },
      pickup_points: { available: false, locations: [] },
    },
    operational_notes:
      'Remote region with limited infrastructure and security concerns',
  },
];

// Predefined shipping methods data
const shippingMethodsData = [
  {
    name: 'Free Shipping',
    code: 'FREE',
    description: 'Free shipping for orders above ₦50,000',
    type: 'free',
    isActive: true,
    sortOrder: 1,
    freeShipping: {
      minimumOrderAmount: 50000,
      applicableZones: [], // Will be populated with all zone IDs
    },
    estimatedDelivery: { minDays: 3, maxDays: 7 },
    restrictions: {
      minOrderValue: 50000,
    },
  },
  {
    name: 'Standard Delivery',
    code: 'STANDARD',
    description: 'Standard delivery across Nigeria',
    type: 'zone_based',
    isActive: true,
    sortOrder: 2,
    zoneBased: {
      zoneRates: [], // Will be populated with zone-specific rates
    },
    estimatedDelivery: { minDays: 2, maxDays: 7 },
  },
  {
    name: 'Express Delivery',
    code: 'EXPRESS',
    description: 'Express delivery for urgent orders',
    type: 'zone_based',
    isActive: true,
    sortOrder: 3,
    zoneBased: {
      zoneRates: [], // Will be populated with zone-specific rates
    },
    estimatedDelivery: { minDays: 1, maxDays: 3 },
  },
  {
    name: 'Lagos Same-Day',
    code: 'LAGOS_SAME',
    description: 'Same-day delivery within Lagos',
    type: 'zone_based',
    isActive: true,
    sortOrder: 4,
    zoneBased: {
      zoneRates: [], // Will be populated with Lagos zone only
    },
    estimatedDelivery: { minDays: 1, maxDays: 1 },
    restrictions: {
      minOrderValue: 10000,
    },
  },
  {
    name: 'Pickup Points',
    code: 'PICKUP',
    description: 'Customer pickup from designated locations',
    type: 'pickup',
    isActive: true,
    sortOrder: 5,
    pickup: {
      cost: 0,
      locations: [
        {
          name: 'Lagos Main Hub',
          address: '123 Herbert Macaulay Way, Yaba, Lagos',
          city: 'Lagos',
          state: 'Lagos',
          postalCode: '100001',
          phone: '+234-1-234-5678',
          operatingHours: {
            monday: { open: '08:00', close: '18:00' },
            tuesday: { open: '08:00', close: '18:00' },
            wednesday: { open: '08:00', close: '18:00' },
            thursday: { open: '08:00', close: '18:00' },
            friday: { open: '08:00', close: '18:00' },
            saturday: { open: '09:00', close: '16:00' },
            sunday: { open: '10:00', close: '14:00' },
          },
          isActive: true,
        },
        {
          name: 'Abuja Branch',
          address: '456 Ahmadu Bello Way, Garki, Abuja',
          city: 'Abuja',
          state: 'FCT',
          postalCode: '900001',
          phone: '+234-9-876-5432',
          operatingHours: {
            monday: { open: '08:00', close: '18:00' },
            tuesday: { open: '08:00', close: '18:00' },
            wednesday: { open: '08:00', close: '18:00' },
            thursday: { open: '08:00', close: '18:00' },
            friday: { open: '08:00', close: '18:00' },
            saturday: { open: '09:00', close: '16:00' },
            sunday: { open: '10:00', close: '14:00' },
          },
          isActive: true,
        },
      ],
    },
    estimatedDelivery: { minDays: 1, maxDays: 2 },
  },
];

// Zone-based shipping rates
const zoneRates = {
  LMZ: { standard: 1500, express: 3000, sameDay: 5000 },
  ACZ: { standard: 2000, express: 4000 },
  SWZ: { standard: 2500, express: 5000 },
  SEZ: { standard: 3000, express: 6000 },
  SSZ: { standard: 3500, express: 7000 },
  NCZ: { standard: 4000, express: 8000 },
  NWZ: { standard: 4500, express: 9000 },
  NEZ: { standard: 5000, express: 10000 },
};

// Connect to database
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

console.log('🌱 Seeding script started...');

// Get or create admin user
const getAdminUser = async () => {
  try {
    let adminUser = await UserModel.findOne({ role: 'ADMIN' });

    if (!adminUser) {
      adminUser = await UserModel.findOne({ email: 'admin@i-coffee.ng' });
    }

    if (!adminUser) {
      // Create a default admin user
      adminUser = new UserModel({
        name: 'System Administrator',
        email: 'admin@i-coffee.ng',
        password: 'admin123', // This should be hashed in production
        role: 'ADMIN',
        verify_email: true,
        status: 'Active',
      });
      await adminUser.save();
      console.log('✅ Created default admin user');
    }

    return adminUser;
  } catch (error) {
    console.error('❌ Error getting admin user:', error);
    throw error;
  }
};

// Seed shipping zones
const seedShippingZones = async (adminUserId) => {
  try {
    console.log('🚀 Seeding shipping zones...');

    // Clear existing zones
    await ShippingZoneModel.deleteMany({});

    const createdZones = [];

    for (const zoneData of shippingZonesData) {
      // Create complete state data with LGAs
      const statesWithLGAs = zoneData.states.map(createStateData);

      const zone = new ShippingZoneModel({
        ...zoneData,
        states: statesWithLGAs,
        createdBy: adminUserId,
        updatedBy: adminUserId,
      });

      const savedZone = await zone.save();
      createdZones.push(savedZone);

      console.log(
        `✅ Created zone: ${zone.name} (${zone.code}) with ${statesWithLGAs.length} states`
      );
    }

    console.log(`✅ Successfully seeded ${createdZones.length} shipping zones`);
    return createdZones;
  } catch (error) {
    console.error('❌ Error seeding shipping zones:', error);
    throw error;
  }
};

// Seed shipping methods
const seedShippingMethods = async (adminUserId, zones) => {
  try {
    console.log('🚀 Seeding shipping methods...');

    // Clear existing methods
    await ShippingMethodModel.deleteMany({});

    const createdMethods = [];

    for (const methodData of shippingMethodsData) {
      const method = new ShippingMethodModel({
        ...methodData,
        createdBy: adminUserId,
        updatedBy: adminUserId,
      });

      // Configure zone-based rates
      if (methodData.type === 'zone_based') {
        method.zoneBased = {
          zoneRates: zones
            .map((zone) => {
              const rates = zoneRates[zone.code];
              let cost = 0;

              if (methodData.code === 'STANDARD') {
                cost = rates?.standard || 3000;
              } else if (methodData.code === 'EXPRESS') {
                cost = rates?.express || 6000;
              } else if (
                methodData.code === 'LAGOS_SAME' &&
                zone.code === 'LMZ'
              ) {
                cost = rates?.sameDay || 5000;
              }

              return {
                zone: zone._id,
                cost: cost,
                freeShippingThreshold: cost > 0 ? 50000 : 0,
              };
            })
            .filter((rate) => rate.cost > 0), // Remove zero-cost rates
        };
      }

      // Configure free shipping zones
      if (methodData.type === 'free') {
        method.freeShipping.applicableZones = zones.map((zone) => zone._id);
      }

      const savedMethod = await method.save();
      createdMethods.push(savedMethod);

      console.log(
        `✅ Created shipping method: ${method.name} (${method.code})`
      );
    }

    console.log(
      `✅ Successfully seeded ${createdMethods.length} shipping methods`
    );
    return createdMethods;
  } catch (error) {
    console.error('❌ Error seeding shipping methods:', error);
    throw error;
  }
};

// Main seeding function
const seedLogisticsData = async () => {
  try {
    console.log('🌱 Starting logistics data seeding...');

    // Connect to database
    await connectDB();

    // Get admin user
    const adminUser = await getAdminUser();

    // Seed shipping zones
    const zones = await seedShippingZones(adminUser._id);

    // Seed shipping methods
    const methods = await seedShippingMethods(adminUser._id, zones);

    console.log('\n📊 Seeding Summary:');
    console.log(`📦 Zones created: ${zones.length}`);
    console.log(`🚚 Methods created: ${methods.length}`);
    console.log(`👤 Admin user: ${adminUser.email}`);

    // Display zone breakdown
    console.log('\n🗺️ Zone Breakdown:');
    zones.forEach((zone) => {
      console.log(
        `  ${zone.name} (${zone.code}): ${zone.states.length} states`
      );
    });

    // Display method breakdown
    console.log('\n📋 Method Breakdown:');
    methods.forEach((method) => {
      console.log(`  ${method.name} (${method.code}): ${method.type}`);
    });

    console.log('\n✅ Logistics data seeding completed successfully!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
};

// Run the seeding script
if (import.meta.url === new URL(import.meta.url).href) {
  seedLogisticsData();
}

export default seedLogisticsData;
