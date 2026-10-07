require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");
const authRoutes = require("./routes/authRoutes");
const eventRoutes = require("./routes/eventRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const registrationRoutes = require("./routes/registrationRoutes");
const walletRoutes = require("./routes/walletRoutes");
const staffRoutes = require("./routes/staffRoutes");
const adminRoutes = require("./routes/adminRoutes");
const marketplaceRoutes = require("./routes/marketplaceRoutes");
const organizationRoutes = require("./routes/organizationRoutes");
const { readHttpConfig, corsOptions, validateStartup } = require('./config/deployment');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const httpConfig = readHttpConfig();

app.set('trust proxy', httpConfig.trustProxy);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors(corsOptions(httpConfig)));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const rateLimit = require('./middlewares/rateLimit');
app.use('/api/auth', rateLimit(30));
app.use('/api/staff', rateLimit(300));
app.use('/api/registrations/lookup', rateLimit(30));
app.use('/api/wallet/topup', rateLimit(Number(process.env.WALLET_TOPUP_RATE_LIMIT) || 10));

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/registrations", registrationRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/marketplace", marketplaceRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/support", require("./routes/supportRoutes"));
app.get('/api/media/images/:imageId', require('./controllers/imageController').read);
app.get('/api/banks', async (_req, res, next) => {
  try { res.json({ banks: await require('./services/bankService').listBanks() }); } catch (error) { next(error); }
});

app.get("/health", (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
});

app.use((req, res) => {
  res
    .status(404)
    .json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use(require('./middlewares/errorHandler').errorHandler);

async function startServer() {
  validateStartup();
  await mongoose.connect(MONGODB_URI, { maxPoolSize: 10, serverSelectionTimeoutMS: 15000 });
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== 'isdbgrid') throw new Error('MongoDB replica set or sharded cluster is required for transactions.');
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const { expireBookings } = require('./services/bookingService');
  let cleaning = false;
  const clean = async () => {
    if (cleaning) return;
    cleaning = true;
    try { await expireBookings(); } catch (error) { console.error('Booking expiry failed:', error.message); }
    finally { cleaning = false; }
  };
  await clean();
  const expiryTimer = setInterval(clean, 30000);
  expiryTimer.unref();

  return app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Unable to start server:", error.message);
    process.exit(1);
  });
}

module.exports = { app, startServer };
