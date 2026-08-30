// controllers/admin-order.controller.js - COMPLETE CORRECTED VERSION
import OrderModel from "../models/order.model.js";
import CustomerModel from "../models/customer.model.js";
import ProductModel from "../models/product.model.js";
import UserModel from "../models/user.model.js";
import mongoose from "mongoose";
import { generateInvoiceTemplate } from "../utils/invoiceTemplate.js";
import sendEmail from "../config/sendEmail.js";
import { logActivity } from "../utils/activityLogger.js";
// Country-scoped customer notifications on status transitions. Until now
// updateOrderStatusController wrote the new status and returned — no email
// was EVER sent to a customer when an admin changed a payment or order
// status, in any country.
import {
  paymentStatusEmail,
  orderStatusEmail,
  resolveEmailCountry,
  subjectFor,
} from "../utils/countryEmailTemplates.js";
import { sendCountryEmail } from "../config/emailService.js";
import { ALL_COUNTRY_CODES, getCountryByCode } from "../config/countries/index.js";
// Canonical storefront purchasability/stock rules, so manual orders can
// never sell something the storefront refuses to sell (or refuse something
// the storefront happily sells). See utils/manualOrderValidation.js.
import {
  isProductSellableForMode,
  resolveCategorySlugs,
  getManualOrderUnitPrice,
  priceOptionConsumesStock,
  getStockForMode,
} from "../utils/manualOrderValidation.js";
// ONLINE/OFFLINE is the axis everything else hangs off — see the header of
// config/manualOrderModes.js for why the server derives it rather than
// trusting what the client sent.
import {
  resolveOrderMode,
  orderTypeForMode,
  MANUAL_ORDER_SUBROLES,
} from "../config/manualOrderModes.js";

// Helper functions
const getProductPrice = (product, priceOption = "regular") => {
  switch (priceOption) {
    case "3weeks":
      return product.price3weeksDelivery || product.btcPrice || product.price;
    case "5weeks":
      return product.price5weeksDelivery || product.btcPrice || product.price;
    default:
      return product.btcPrice || product.price;
  }
};

const pricewithDiscount = (price, dis = 0) => {
  const discountAmount = Math.ceil((Number(price) * Number(dis)) / 100);
  return Number(price) - discountAmount;
};

// ===== CREATE MANUAL ORDER WITH WAREHOUSE STOCK DEDUCTION =====
export const createAdminOrderController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    // ── ROLE GUARD ────────────────────────────────────────────────────────
    // BUGFIX: this previously read `user.subRole !== "SALES"`, which 403'd
    // IT, DIRECTOR and MANAGER out of manual order creation entirely — and
    // made the `["IT","MANAGER","DIRECTOR"]` customer-ownership exemption 40
    // lines below unreachable dead code, since those roles could never get
    // past this gate to reach it.
    if (user.role !== "ADMIN" || !MANUAL_ORDER_SUBROLES.includes(user.subRole)) {
      return response.status(403).json({
        message: "You do not have permission to create manual orders",
        error: true,
      });
    }

    const isGlobalManualOrderAdmin = ["IT", "DIRECTOR"].includes(user.subRole);

    const {
      customerId,
      items,
      // `orderType` is accepted but no longer trusted — manual orders are
      // BTC-only now (see below). Kept in the destructure so an older admin
      // build still posting orderType:"BTB" gets a clear 400 rather than a
      // confusing schema error.
      orderType,
      // Country the order belongs to. Only meaningful for IT/DIRECTOR, who
      // can raise an order on behalf of any market; everyone else is pinned
      // to their own scope regardless of what they send.
      countryCode: requestedCountryCode,
      orderMode,
      paymentMethod,
      deliveryAddress,
      shippingMethodId,
      notes,
      customerNotes,
      discountAmount = 0,
      taxAmount = 0,
      shippingCost = 0,
      sendInvoiceEmail = false,
    } = request.body;

    // ── MODE RESOLUTION (the axis everything else follows) ───────────────
    // CORRECTION to the 2026-08-28 revision, which forced every manual order
    // to BTC and rejected BTB. That was a misreading: BTB is not retired, it
    // is the OFFLINE half of the system.
    //
    //   ONLINE  → BTC customers, btcPrice, storefront stock rules
    //   OFFLINE → BTB customers, btbPrice, warehouse offline stock
    //
    // For SALES the mode comes from their ACCOUNT (user.userMode), not the
    // request — an online agent must not be able to raise a BTB warehouse
    // sale, and a UI lock alone is not a control. IT/DIRECTOR/MANAGER choose.
    const modeResult = resolveOrderMode(user, orderMode);
    if (modeResult.error) {
      return response.status(403).json({ message: modeResult.error, error: true });
    }
    const resolvedMode = modeResult.mode;
    const resolvedOrderType = orderTypeForMode(resolvedMode);

    // orderType is derived, never accepted. If a client sent one that
    // disagrees with its own mode, that is a stale build — say so rather
    // than silently writing the derived value, which would produce an order
    // the agent believes is something else.
    if (orderType && orderType !== resolvedOrderType) {
      return response.status(400).json({
        message: `A ${resolvedMode} order is always ${resolvedOrderType}; received orderType "${orderType}".`,
        error: true,
      });
    }

    // ── COUNTRY OF RECORD ─────────────────────────────────────────────────
    // BUGFIX: this used to be decided further down as
    // `request.countryScope || request.countryCode || "NG"`. For IT/DIRECTOR
    // countryScope is null (they are GLOBAL), so it fell through to the
    // domain-detected country — which for the admin panel is always the
    // admin host, i.e. NG. A director therefore could not raise a Togo
    // manual order at all; every order they created was stamped Nigeria.
    let orderCountryCode;
    if (isGlobalManualOrderAdmin) {
      const requested = (requestedCountryCode || "").toUpperCase();
      if (requested && !ALL_COUNTRY_CODES.includes(requested)) {
        return response.status(400).json({
          message: `Unknown country code: ${requested}`,
          error: true,
        });
      }
      orderCountryCode = requested || request.countryCode || "NG";
    } else {
      // Country-scoped roles (SALES, MANAGER) are pinned to their own
      // country. Anything they send in the body is ignored, not merged.
      orderCountryCode = request.countryScope || request.countryCode || "NG";
    }

    const customer = await CustomerModel.findById(customerId);
    if (!customer) {
      return response.status(404).json({
        message: "Customer not found",
        error: true,
      });
    }

    // ── CUSTOMER MODE / TYPE MATCH ───────────────────────────────────────
    // An ONLINE order must be for a BTC customer and an OFFLINE order for a
    // BTB one. Without this, an offline agent could bill a storefront
    // customer at BTB warehouse prices.
    if (customer.customerType && customer.customerType !== resolvedOrderType) {
      return response.status(400).json({
        message: `A ${resolvedMode} order requires a ${resolvedOrderType} customer; this customer is ${customer.customerType}.`,
        error: true,
      });
    }
    if (customer.customerMode && customer.customerMode !== resolvedMode) {
      return response.status(400).json({
        message: `This customer is registered as ${customer.customerMode}; you are creating an ${resolvedMode} order.`,
        error: true,
      });
    }

    // ── CUSTOMER COUNTRY MATCH ────────────────────────────────────────────
    // A customer belongs to exactly one country. Raising an order for a
    // customer outside the order's country would create a record neither
    // country's staff can consistently see, and would send the customer an
    // email branded for the wrong market.
    if (customer.countryCode && customer.countryCode !== orderCountryCode) {
      return response.status(403).json({
        message: `Customer belongs to ${customer.countryCode}; cannot create a ${orderCountryCode} order for them.`,
        error: true,
      });
    }

    if (!isGlobalManualOrderAdmin && user.subRole !== "MANAGER") {
      if (
        customer.createdBy?.toString() !== userId &&
        !customer.isWebsiteCustomer
      ) {
        return response.status(403).json({
          message: "You can only create orders for customers you manage",
          error: true,
        });
      }
    }

    const orderGroupId = `GRP-${Date.now()}-${customerId}`;
    const shippingCostPerItem = shippingCost / items.length;

    const groupTotals = {
      subTotal: 0,
      totalShipping: shippingCost,
      totalDiscount: discountAmount,
      totalTax: taxAmount,
      grandTotal: 0,
      itemCount: items.length,
    };

    const processedOrders = [];
    const stockUpdates = [];

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const firstOrderId = `ORD-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const isParent = index === 0;

        const product = await ProductModel.findById(item.productId).session(
          session,
        );
        if (!product) {
          throw new Error(`Product with ID ${item.productId} not found`);
        }

        // ── COUNTRY GATE ────────────────────────────────────────────────
        // A product belonging to another market must not be sellable into
        // this order. Legacy products with no countryCode are allowed
        // through, matching countryScopedPlugin's own legacy fallback.
        if (product.countryCode && product.countryCode !== orderCountryCode) {
          throw new Error(
            `${product.name} is not available in ${orderCountryCode}`,
          );
        }

        // ── STOREFRONT PARITY VALIDATION ────────────────────────────────
        // Same rule the customer-facing site applies (PRODUCT_VISIBILITY_
        // RULES.md §3/§4), via the shared helper rather than a local copy.
        // The previous inline check read warehouseStock.offlineStock and
        // ignored partnerStock entirely, so partner-supplied stock read as
        // zero and the agent was blocked from selling it.
        const categorySlugs = await resolveCategorySlugs(product, session);
        // ONLINE applies the canonical storefront rule (so a manual online
        // order matches exactly what the website would accept); OFFLINE
        // applies the warehouse rule — BTB price + physical offline stock,
        // and no special-order escape hatch.
        const sellable = isProductSellableForMode(product, resolvedMode, categorySlugs);
        if (!sellable.sellable) {
          throw new Error(`${product.name}: ${sellable.reason}`);
        }

        const priceOption =
          resolvedMode === "OFFLINE" ? "regular" : item.priceOption || "regular";
        const consumesStock = priceOptionConsumesStock(priceOption, resolvedMode);
        const availableStock = getStockForMode(product, resolvedMode);

        // Special-order (2/5-week) lines are supplier-sourced and hold no
        // local stock, so they are exempt from the stock check — and must
        // not decrement it later either.
        if (consumesStock && availableStock < item.quantity) {
          throw new Error(
            `Insufficient stock for ${product.name}. Available: ${availableStock}, Required: ${item.quantity}`,
          );
        }

        // BTC pricing only — BTB is retired (see the guard at the top).
        const unitPrice = getManualOrderUnitPrice(product, priceOption, resolvedMode);

        if (!unitPrice || unitPrice <= 0) {
          throw new Error(
            `No valid ${resolvedOrderType} price for ${product.name}` +
              (resolvedMode === "ONLINE" ? ` (${priceOption})` : ""),
          );
        }

        const itemSubtotal = unitPrice * item.quantity;
        const itemTotal =
          itemSubtotal +
          shippingCostPerItem +
          taxAmount / items.length -
          discountAmount / items.length;

        groupTotals.subTotal += itemSubtotal;
        groupTotals.grandTotal += itemTotal;

        // ── STOCK DECREMENT ─────────────────────────────────────────────
        // Skipped entirely for special-order (2/5-week) lines: those are
        // supplier-sourced, hold no local inventory, and decrementing for
        // them silently drained stock that was never reserved.
        //
        // Note this now writes to ONLINE stock, matching the pool the
        // validation above reads. The old code validated against
        // offlineStock and then decremented offlineStock, which was
        // self-consistent but measured a different pool from the storefront
        // — so a manual sale never reduced what the website could sell.
        if (!consumesStock) {
          // no-op: online special order, supplier-sourced, no local stock
        } else if (resolvedMode === "OFFLINE") {
          // Offline sales draw down the WAREHOUSE COUNTER pool, never the
          // storefront pool — otherwise a counter sale would silently
          // reduce what the website can sell.
          const newOfflineStock =
            (product.warehouseStock?.offlineStock || 0) - item.quantity;
          const newFinal = (product.warehouseStock?.finalStock || 0) - item.quantity;
          await ProductModel.findByIdAndUpdate(
            item.productId,
            {
              "warehouseStock.offlineStock": newOfflineStock,
              "warehouseStock.finalStock": newFinal,
              "warehouseStock.lastUpdated": new Date(),
              "warehouseStock.updatedBy": userId,
            },
            { session },
          );
          stockUpdates.push({
            productId: item.productId,
            productName: product.name,
            quantityDeducted: item.quantity,
            source: "warehouseStock.offlineStock",
            previousStock: product.warehouseStock?.offlineStock || 0,
            newStock: newOfflineStock,
          });
        } else if (product.partnerStock?.enabled) {
          const newPartnerQty =
            (product.partnerStock.quantity || 0) - item.quantity;
          await ProductModel.findByIdAndUpdate(
            item.productId,
            {
              "partnerStock.quantity": newPartnerQty,
              "partnerStock.lastUpdated": new Date(),
            },
            { session },
          );
          stockUpdates.push({
            productId: item.productId,
            productName: product.name,
            quantityDeducted: item.quantity,
            source: "partnerStock",
            previousStock: product.partnerStock.quantity || 0,
            newStock: newPartnerQty,
          });
        } else if (product.warehouseStock?.enabled) {
          const newOnlineStock =
            (product.warehouseStock.onlineStock || 0) - item.quantity;
          const newFinalStock =
            (product.warehouseStock.finalStock || 0) - item.quantity;

          await ProductModel.findByIdAndUpdate(
            item.productId,
            {
              "warehouseStock.onlineStock": newOnlineStock,
              "warehouseStock.finalStock": newFinalStock,
              "warehouseStock.lastUpdated": new Date(),
              "warehouseStock.updatedBy": userId,
            },
            { session },
          );

          stockUpdates.push({
            productId: item.productId,
            productName: product.name,
            quantityDeducted: item.quantity,
            source: "warehouseStock.onlineStock",
            previousStock: product.warehouseStock.onlineStock || 0,
            newStock: newOnlineStock,
          });
        } else {
          const newStock = (product.stock || 0) - item.quantity;
          await ProductModel.findByIdAndUpdate(
            item.productId,
            { stock: newStock },
            { session },
          );

          stockUpdates.push({
            productId: item.productId,
            productName: product.name,
            quantityDeducted: item.quantity,
            previousStock: product.stock || 0,
            newStock,
          });
        }

        const orderId = isParent
          ? firstOrderId
          : `ORD-${Date.now()}-${index}-${Math.random()
              .toString(36)
              .substr(2, 9)}`;

        processedOrders.push({
          orderId,
          userId: null,
          customerId,
          orderGroupId,
          isParentOrder: isParent,
          parentOrderId: isParent ? null : firstOrderId,
          orderSequence: index + 1,
          totalItemsInGroup: items.length,
          orderType: resolvedOrderType,
          orderMode: resolvedMode,
          isWebsiteOrder: false,
          productId: item.productId,
          product_details: {
            name: product.name,
            image: product.image,
            priceOption: item.priceOption || "regular",
            deliveryTime: item.priceOption || "regular",
            sku: product.sku,
          },
          quantity: item.quantity,
          unitPrice,
          subTotalAmt: itemSubtotal,
          discount_amount: discountAmount / items.length,
          tax_amount: taxAmount / items.length,
          shipping_cost: shippingCostPerItem,
          totalAmt: itemTotal,
          // Currency follows the ORDER's country, not a hardcoded NGN — a
          // Togo manual order is XOF, an Italian one EUR. Hardcoding NGN
          // here meant every non-NG manual order was denominated wrongly on
          // the order record, the invoice and the customer email.
          currency:
            getCountryByCode(orderCountryCode)?.currency?.code || "NGN",
          countryCode: orderCountryCode,
          groupTotals: isParent ? groupTotals : {},
          payment_status: paymentMethod === "CASH" ? "PENDING" : "PENDING",
          payment_method: paymentMethod,
          paymentId: `MAN-${Date.now()}`,
          order_status: "CONFIRMED",
          deliveryAddress: deliveryAddress || customer.address,
          delivery_address: null,
          shippingMethod: shippingMethodId || null,
          // ── SALES AGENT ATTRIBUTION ──────────────────────────────────
          // `createdBy` is the acting admin. `salesAgent` snapshots WHO
          // made the sale at the time it was made, including their subRole
          // and country, so attribution survives the agent later changing
          // role, moving country, or leaving — which a populated ref alone
          // does not.
          createdBy: userId,
          salesAgent: {
            userId,
            name: user.name,
            email: user.email,
            subRole: user.subRole,
            countryCode: user.assignedCountry || orderCountryCode,
            recordedAt: new Date(),
          },
          notes,
          customer_notes: customerNotes,
          invoiceGenerated: false,
        });
      }

      if (processedOrders.length > 0) {
        processedOrders[0].groupTotals = groupTotals;
      }

      const orders = await OrderModel.insertMany(processedOrders, { session });

      await CustomerModel.findByIdAndUpdate(
        customerId,
        {
          $inc: {
            totalOrders: orders.length,
            totalOrderValue: orders.reduce(
              (sum, order) => sum + order.totalAmt,
              0,
            ),
          },
          lastOrderDate: new Date(),
        },
        { session },
      );

      await session.commitTransaction();

      console.log(
        `✅ Manual order: Created order group ${orderGroupId} with ${orders.length} orders`,
      );

      const populatedOrders = await OrderModel.find({
        _id: { $in: orders.map((o) => o._id) },
      })
        .populate(
          "customerId",
          "name email customerType companyName mobile address",
        )
        .populate("createdBy", "name email")
        .populate("productId", "name image sku");

      // ✅ SEND INVOICE EMAIL IF REQUESTED
      if (sendInvoiceEmail && customer.email) {
        try {
          const mainOrder = populatedOrders[0];

          const invoiceHTML = generateInvoiceTemplate({
            order: {
              orderId: mainOrder.orderId,
              invoiceNumber: mainOrder.invoiceNumber,
              invoiceDate: mainOrder.createdAt,
              createdAt: mainOrder.createdAt,
              orderType: mainOrder.orderType,
              orderMode: mainOrder.orderMode,
              orderStatus: mainOrder.order_status,
              paymentStatus: mainOrder.payment_status,
              paymentMethod: mainOrder.payment_method,
              subTotal: groupTotals.subTotal,
              discountAmount,
              taxAmount,
              shippingCost,
              totalAmount: groupTotals.grandTotal,
              notes: mainOrder.notes,
              customerNotes: mainOrder.customer_notes,
              isWebsiteOrder: false,
            },
            customer: {
              name: customer.name,
              email: customer.email,
              mobile: customer.mobile,
              customerType: customer.customerType,
              companyName: customer.companyName,
              address: deliveryAddress || customer.address,
              taxNumber: customer.taxNumber,
            },
            items: populatedOrders.map((order) => ({
              productName: order.productId.name,
              priceOption: order.product_details.priceOption,
              quantity: order.quantity,
              unitPrice: order.unitPrice,
              totalPrice: order.totalAmt,
            })),
            salesAgent: {
              name: user.name,
              email: user.email,
            },
          });

          await sendEmail({
            sendTo: customer.email,
            subject: `Invoice - Order ${mainOrder.orderId} | I-COFFEE.NG`,
            html: invoiceHTML,
            senderName: user.name,
            replyTo: user.email,
          });

          console.log(
            `✅ Invoice email sent to ${customer.email} from ${user.name}`,
          );
        } catch (emailError) {
          console.error("❌ Error sending invoice email:", emailError);
        }
      }

      return response.json({
        message: "Orders created successfully",
        data: {
          orders: populatedOrders,
          stockUpdates,
          invoiceEmailSent: sendInvoiceEmail && customer.email,
          orderGroupId,
        },
        success: true,
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("Create admin order error:", error);
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
};

// ===== GET ALL ORDERS (UNIFIED) =====
export const getAllOrdersController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    const {
      page = 1,
      limit = 10,
      search,
      orderType,
      orderMode,
      orderStatus,
      paymentStatus,
      isWebsiteOrder,
      sortBy = "createdAt",
      sortOrder = "desc",
      startDate,
      endDate,
      countryCode,
    } = request.query;

    let query = {};

    // Sub-roles allowed to see every order regardless of country/domain.
    // Per policy: ONLY IT and DIRECTOR get cross-country visibility — every
    // other HQ role (including MANAGER) is restricted to Nigeria's orders,
    // and a country-scoped admin (e.g. a Togo/Italy manager) is restricted
    // to their own assignedCountry. (LOGISTICS/etc. still default to GLOBAL
    // `scope` for other data types — this restriction is order-specific.)
    const GLOBAL_ORDER_VIEW_SUBROLES = ["IT", "DIRECTOR"];
    const isGlobalOrderViewer =
      user.role === "ADMIN" && GLOBAL_ORDER_VIEW_SUBROLES.includes(user.subRole);

    if (user.role === "ADMIN") {
      if (isGlobalOrderViewer) {
        query = {};
      } else if (user.subRole === "SALES") {
        query = {
          $or: [
            { createdBy: userId, isWebsiteOrder: false },
            { isWebsiteOrder: true },
          ],
        };
      } else if (
        ["MANAGER", "SALES_MANAGER", "HR", "ACCOUNTANT", "GRAPHICS", "EDITOR", "LOGISTICS", "WAREHOUSE"].includes(
          user.subRole,
        )
      ) {
        query = {};
      } else {
        return response.status(403).json({
          message: "Access denied",
          error: true,
        });
      }
    } else {
      return response.status(403).json({
        message: "Access denied",
        error: true,
      });
    }

    // Country visibility:
    //   - IT / DIRECTOR                → unrestricted, every country/domain
    //   - COUNTRY-scoped admin         → only their own assignedCountry
    //     (e.g. a foreign Togo manager sees only i-coffee.tg orders)
    //   - every other HQ admin         → Nigeria (HQ) orders only — this is
    //     the default because `scope` defaults to GLOBAL on the user model
    //     for non-HQ_ONLY_SUBROLES, so without this an ordinary HQ admin
    //     (MANAGER, SALES, ACCOUNTANT, etc.) would otherwise see every
    //     country's orders too.
    if (isGlobalOrderViewer) {
      // Unrestricted by default — but IT/DIRECTOR can narrow the cross-country
      // view to one country with ?countryCode=TG, which is what backs the
      // country filter dropdown in WebsiteOrderManagement.jsx. Validated
      // against ALL_COUNTRY_CODES so a junk value can't produce an empty list
      // that looks like "no orders exist".
      const requestedCountry = (countryCode || "").toUpperCase();
      if (requestedCountry && ALL_COUNTRY_CODES.includes(requestedCountry)) {
        query = { $and: [query, { countryCode: requestedCountry }] };
      }
    } else if (request.countryScope) {
      query = { $and: [query, { countryCode: request.countryScope }] };
    } else {
      query = { $and: [query, { countryCode: "NG" }] };
    }
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$and = query.$and || [];
      query.$and.push({
        $or: [{ orderId: searchRegex }, { invoiceNumber: searchRegex }],
      });
    }

    if (orderType) query.orderType = orderType;
    if (orderMode) query.orderMode = orderMode;
    if (orderStatus) query.order_status = orderStatus;
    if (paymentStatus) query.payment_status = paymentStatus;
    if (isWebsiteOrder !== undefined)
      query.isWebsiteOrder = isWebsiteOrder === "true";

    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [orders, totalCount] = await Promise.all([
      OrderModel.find(query)
        .populate("userId", "name email mobile")
        .populate("customerId", "name email customerType companyName mobile")
        .populate("createdBy", "name email subRole")
        .populate("productId", "name image sku")
        .populate("delivery_address")
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      OrderModel.countDocuments(query),
    ]);

    // Per-country counts for the cross-country view. Only computed for
    // IT/DIRECTOR — everyone else's list is single-country by construction, so
    // the breakdown would be a pointless extra aggregation on every page load.
    //
    // NOTE: this deliberately drops the pagination-only parts of `query` and
    // keeps the filters, so the breakdown describes the whole filtered result
    // set rather than the current page.
    let countryBreakdown = null;
    if (isGlobalOrderViewer) {
      const rows = await OrderModel.aggregate([
        { $match: query },
        { $group: { _id: "$countryCode", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);
      countryBreakdown = rows.map((r) => ({
        countryCode: r._id || "NG",
        count: r.count,
      }));
    }

    return response.json({
      message: "Orders retrieved successfully",
      data: {
        docs: orders,
        countryBreakdown,
        totalDocs: totalCount,
        limit: parseInt(limit),
        page: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        hasNextPage: parseInt(page) < Math.ceil(totalCount / parseInt(limit)),
        hasPrevPage: parseInt(page) > 1,
      },
      success: true,
    });
  } catch (error) {
    console.error("Get orders error:", error);
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
};

// ===== UPDATE ORDER STATUS =====
export const updateOrderStatusController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);
    const { orderId } = request.params;
    const { order_status, payment_status, notes } = request.body;

    const order = await OrderModel.findById(orderId);
    if (!order) {
      return response.status(404).json({
        message: "Order not found",
        error: true,
      });
    }

    const GLOBAL_ORDER_VIEW_SUBROLES = ["IT", "DIRECTOR"];
    const isGlobalOrderViewer =
      user.role === "ADMIN" && GLOBAL_ORDER_VIEW_SUBROLES.includes(user.subRole);

    if (user.role === "ADMIN") {
      if (isGlobalOrderViewer) {
        // Can update any order, any country
      } else if (user.subRole === "SALES") {
        if (!order.isWebsiteOrder && order.createdBy?.toString() !== userId) {
          return response.status(403).json({
            message: "You can only update orders you created",
            error: true,
          });
        }
      } else if (
        !["MANAGER", "SALES_MANAGER", "HR", "ACCOUNTANT", "GRAPHICS", "EDITOR", "LOGISTICS", "WAREHOUSE"].includes(
          user.subRole,
        )
      ) {
        return response.status(403).json({
          message: "Access denied",
          error: true,
        });
      }

      // Country restriction — mirrors getAllOrdersController: only IT/
      // DIRECTOR can touch orders outside their own country/scope.
      if (!isGlobalOrderViewer) {
        const allowedCountry = request.countryScope || "NG";
        if (order.countryCode !== allowedCountry) {
          return response.status(403).json({
            message: "You can only update orders from your own country",
            error: true,
          });
        }
      }
    }

    const updateData = {};
    if (order_status) updateData.order_status = order_status;
    if (payment_status) updateData.payment_status = payment_status;
    if (notes) updateData.admin_notes = notes;

    if (order_status === "DELIVERED") {
      updateData.actual_delivery = new Date();
    }

    // Capture the PRE-update values so we only email on an actual transition —
    // re-saving the same status (common when an admin edits notes) must not
    // re-notify the customer.
    const previousPaymentStatus = order.payment_status;
    const previousOrderStatus = order.order_status;

    const updatedOrder = await OrderModel.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true },
    )
      .populate("userId", "name email")
      .populate("customerId", "name email companyName")
      .populate("createdBy", "name email");

    // ── Country-scoped customer notifications ────────────────────────────────
    // Branded/localized from the ORDER's countryCode, never the admin's: an
    // IT/DIRECTOR in Lagos flipping a Togo order to SHIPPED must send the
    // customer a French, Togo-branded email. Wrapped so a mail failure can
    // never fail the status update itself, which has already been persisted.
    try {
      const recipient = updatedOrder.userId || updatedOrder.customerId;
      const emailCountry = resolveEmailCountry(updatedOrder.countryCode);

      if (recipient?.email) {
        if (payment_status && payment_status !== previousPaymentStatus) {
          await sendCountryEmail({
            countryCode: emailCountry.code,
            sendTo: recipient.email,
            subject: subjectFor("paymentStatus", emailCountry, {
              orderId: updatedOrder.orderId,
              status: payment_status,
            }),
            html: paymentStatusEmail({
              order: updatedOrder,
              user: recipient,
              status: payment_status,
              country: emailCountry,
              amount:
                updatedOrder.groupTotals?.grandTotal ?? updatedOrder.totalAmt,
              currency: updatedOrder.currency,
            }),
          });
        }

        if (order_status && order_status !== previousOrderStatus) {
          await sendCountryEmail({
            countryCode: emailCountry.code,
            sendTo: recipient.email,
            subject: subjectFor("orderStatus", emailCountry, {
              orderId: updatedOrder.orderId,
              status: order_status,
            }),
            html: orderStatusEmail({
              order: updatedOrder,
              user: recipient,
              status: order_status,
              country: emailCountry,
            }),
          });
        }
      }
    } catch (emailError) {
      console.error(
        "[admin-order] status-change notification failed:",
        emailError.message,
      );
    }

    logActivity({
      userId: request.user?._id,
      action: 'ORDER_STATUS_CHANGE',
      description: `Updated order ${updatedOrder?.orderNumber || orderId} — status: ${updateData.status || 'updated'}`,
      resourceType: 'Order',
      resourceId: orderId,
      resourceName: updatedOrder?.orderNumber || String(orderId),
      req: request,
    });

    return response.json({
      message: "Order updated successfully",
      data: updatedOrder,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
};

// ===== GENERATE INVOICE WITH EMAIL OPTION =====
export const generateInvoiceController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);
    const { orderId } = request.params;
    const { sendEmail: shouldSendEmail = false } = request.body;

    if (user.role !== "ADMIN" || user.subRole !== "SALES") {
      return response.status(403).json({
        message: "Only sales agents can generate invoices",
        error: true,
      });
    }

    const order = await OrderModel.findById(orderId)
      .populate("userId", "name email")
      .populate(
        "customerId",
        "name email companyName customerType mobile address taxNumber",
      )
      .populate("productId", "name image sku")
      .populate("createdBy", "name email")
      .populate("delivery_address");

    if (!order) {
      return response.status(404).json({
        message: "Order not found",
        error: true,
      });
    }

    if (!["IT", "MANAGER", "DIRECTOR"].includes(user.subRole)) {
      if (!order.isWebsiteOrder && order.createdBy?.toString() !== userId) {
        return response.status(403).json({
          message: "You can only generate invoices for orders you created",
          error: true,
        });
      }
    }

    if (!order.invoiceGenerated) {
      order.invoiceGenerated = true;
      await order.save();
    }

    let deliveryAddress = null;
    if (order.isWebsiteOrder) {
      deliveryAddress = order.delivery_address;
    } else {
      deliveryAddress = order.deliveryAddress || order.customerId?.address;
    }

    let emailSent = false;
    if (shouldSendEmail) {
      const customer = order.isWebsiteOrder ? order.userId : order.customerId;

      if (customer && customer.email) {
        try {
          const invoiceHTML = generateInvoiceTemplate({
            order: {
              orderId: order.orderId,
              invoiceNumber: order.invoiceNumber,
              invoiceDate: order.createdAt,
              createdAt: order.createdAt,
              orderType: order.orderType,
              orderMode: order.orderMode,
              orderStatus: order.order_status,
              paymentStatus: order.payment_status,
              paymentMethod: order.payment_method,
              subTotal: order.subTotalAmt,
              discountAmount: order.discount_amount || 0,
              taxAmount: order.tax_amount || 0,
              shippingCost: order.shipping_cost || 0,
              totalAmount: order.totalAmt,
              notes: order.notes,
              customerNotes: order.customer_notes,
              isWebsiteOrder: order.isWebsiteOrder,
            },
            customer: {
              name: customer.name,
              email: customer.email,
              mobile: customer.mobile || order.userId?.mobile,
              customerType: customer.customerType,
              companyName: customer.companyName,
              address: deliveryAddress,
              taxNumber: customer.taxNumber,
            },
            items: [
              {
                productName: order.productId.name,
                priceOption: order.product_details?.priceOption || "regular",
                quantity: order.quantity,
                unitPrice: order.unitPrice,
                totalPrice: order.totalAmt,
              },
            ],
            salesAgent: order.createdBy
              ? {
                  name: order.createdBy.name,
                  email: order.createdBy.email,
                }
              : null,
          });

          await sendEmail({
            sendTo: customer.email,
            subject: `Invoice ${order.invoiceNumber} - Order ${order.orderId} | I-COFFEE.NG`,
            html: invoiceHTML,
            senderName: order.createdBy?.name || user.name,
            replyTo: order.createdBy?.email || user.email,
          });

          emailSent = true;
          console.log(
            `✅ Invoice email sent to ${customer.email} from ${
              order.createdBy?.name || user.name
            }`,
          );
        } catch (emailError) {
          console.error("❌ Error sending invoice email:", emailError);
        }
      }
    }

    return response.json({
      message: "Invoice generated successfully",
      data: {
        invoiceNumber: order.invoiceNumber,
        order,
        emailSent,
      },
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
};

// ===== GET ORDER ANALYTICS =====
export const getOrderAnalyticsController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    if (user.role !== "ADMIN") {
      return response.status(403).json({
        message: "Access denied",
        error: true,
      });
    }

    const { startDate, endDate, agentId } = request.query;

    let matchQuery = {};

    if (user.subRole === "SALES") {
      matchQuery = {
        $or: [
          {
            createdBy: new mongoose.Types.ObjectId(userId),
            isWebsiteOrder: false,
          },
          { isWebsiteOrder: true },
        ],
      };
    } else if (agentId) {
      matchQuery.createdBy = new mongoose.Types.ObjectId(agentId);
    }

    if (startDate && endDate) {
      matchQuery.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const analytics = await OrderModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: "$totalAmt" },
          avgOrderValue: { $avg: "$totalAmt" },
          btcOrders: {
            $sum: { $cond: [{ $eq: ["$orderType", "BTC"] }, 1, 0] },
          },
          btbOrders: {
            $sum: { $cond: [{ $eq: ["$orderType", "BTB"] }, 1, 0] },
          },
          onlineOrders: {
            $sum: { $cond: [{ $eq: ["$orderMode", "ONLINE"] }, 1, 0] },
          },
          offlineOrders: {
            $sum: { $cond: [{ $eq: ["$orderMode", "OFFLINE"] }, 1, 0] },
          },
          websiteOrders: { $sum: { $cond: ["$isWebsiteOrder", 1, 0] } },
          manualOrders: {
            $sum: { $cond: [{ $not: "$isWebsiteOrder" }, 1, 0] },
          },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ["$order_status", "PENDING"] }, 1, 0] },
          },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$order_status", "DELIVERED"] }, 1, 0] },
          },
          paidOrders: {
            $sum: { $cond: [{ $eq: ["$payment_status", "PAID"] }, 1, 0] },
          },
        },
      },
    ]);

    let salesByAgent = [];
    if (["DIRECTOR", "MANAGER", "IT"].includes(user.subRole)) {
      salesByAgent = await OrderModel.aggregate([
        { $match: { ...matchQuery, isWebsiteOrder: false } },
        {
          $group: {
            _id: "$createdBy",
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: "$totalAmt" },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "agent",
          },
        },
        { $unwind: "$agent" },
        {
          $project: {
            agentName: "$agent.name",
            agentEmail: "$agent.email",
            totalOrders: 1,
            totalRevenue: 1,
          },
        },
        { $sort: { totalRevenue: -1 } },
      ]);
    }

    return response.json({
      message: "Analytics retrieved successfully",
      data: {
        summary: analytics[0] || {
          totalOrders: 0,
          totalRevenue: 0,
          avgOrderValue: 0,
          btcOrders: 0,
          btbOrders: 0,
          onlineOrders: 0,
          offlineOrders: 0,
          websiteOrders: 0,
          manualOrders: 0,
          pendingOrders: 0,
          completedOrders: 0,
          paidOrders: 0,
        },
        salesByAgent,
      },
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
};

// ===== PREVIEW INVOICE WITHOUT GENERATING =====
export const previewInvoiceController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    const {
      customerId,
      items,
      orderType,
      orderMode,
      paymentMethod,
      deliveryAddress,
      notes,
      customerNotes,
      discountAmount = 0,
      taxAmount = 0,
      shippingCost = 0,
    } = request.body;

    const customer = await CustomerModel.findById(customerId);
    if (!customer) {
      return response.status(404).json({
        message: "Customer not found",
        error: true,
      });
    }

    let subTotal = 0;
    const itemsForInvoice = [];

    for (const item of items) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        continue;
      }

      let unitPrice;
      if (orderType === "BTB") {
        unitPrice = product.btbPrice || product.price;
      } else {
        unitPrice = getProductPrice(product, item.priceOption);
      }

      const itemTotal = unitPrice * item.quantity;
      subTotal += itemTotal;

      itemsForInvoice.push({
        productName: product.name,
        priceOption: item.priceOption || "regular",
        quantity: item.quantity,
        unitPrice,
        totalPrice: itemTotal,
      });
    }

    const totalAmount = subTotal + taxAmount + shippingCost - discountAmount;

    const invoiceHTML = generateInvoiceTemplate({
      order: {
        orderId: "PREVIEW",
        invoiceNumber: "PREVIEW",
        invoiceDate: new Date(),
        createdAt: new Date(),
        orderType,
        orderMode,
        orderStatus: "PENDING",
        paymentStatus: "PENDING",
        paymentMethod,
        subTotal,
        discountAmount,
        taxAmount,
        shippingCost,
        totalAmount,
        notes,
        customerNotes,
        isWebsiteOrder: false,
      },
      customer: {
        name: customer.name,
        email: customer.email,
        mobile: customer.mobile,
        customerType: customer.customerType,
        companyName: customer.companyName,
        address: deliveryAddress || customer.address,
        taxNumber: customer.taxNumber,
      },
      items: itemsForInvoice,
      salesAgent: {
        name: user.name,
        email: user.email,
      },
    });

    return response.json({
      message: "Invoice preview generated",
      data: {
        html: invoiceHTML,
        summary: {
          subTotal,
          discountAmount,
          taxAmount,
          shippingCost,
          totalAmount,
          itemCount: items.length,
        },
      },
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
};
