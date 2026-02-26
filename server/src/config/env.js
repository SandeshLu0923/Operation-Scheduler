import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/ot_scheduler",
  jwtSecret: process.env.JWT_SECRET || "changeme",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  adminRegistrationToken: process.env.ADMIN_REGISTRATION_TOKEN || ""
};

if (env.nodeEnv === "production" && env.jwtSecret === "changeme") {
  throw new Error("JWT_SECRET must be configured in production");
}
