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

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "*",
    credentials: process.env.CLIENT_ORIGIN ? true : false,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const rateLimit = require('./middlewares/rateLimit');
app.use('/api/auth', rateLimit(30));
app.use('/api/staff', rateLimit(300));
app.use('/api/registrations/lookup', rateLimit(30));

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/registrations", registrationRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/marketplace", marketplaceRoutes);
app.use("/api/organizations", organizationRoutes);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use((req, res) => {
  res
    .status(404)
    .json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((err, _req, res, _next) => {
  const status = err.statusCode || (err.code === 11000 ? 409 : ['ValidationError', 'CastError'].includes(err.name) || err.type === 'entity.parse.failed' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ message: status === 500 ? 'Internal server error' : err.code === 11000 ? 'Duplicate record or transaction reference.' : err.message });
});

async function startServer() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is required. Add it to your .env file.");
  }

  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required.');
  await mongoose.connect(MONGODB_URI);
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

  return app.listen(PORT, () => {
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
