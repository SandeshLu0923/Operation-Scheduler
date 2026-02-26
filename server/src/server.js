import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import app from "./app.js";
import { env } from "./config/env.js";
import { connectDb } from "./config/db.js";
import { logger } from "./config/logger.js";
import { registerIo } from "./services/realtimeService.js";
import { backfillPendingArrangementSchedules } from "./services/dataRepairService.js";

async function bootstrap() {
  try {
    await connectDb(env.mongoUri);
    await backfillPendingArrangementSchedules();

    const httpServer = createServer(app);
    const io = new SocketIOServer(httpServer, {
      cors: {
        origin: env.clientUrl,
        credentials: true
      }
    });

    io.on("connection", (socket) => {
      logger.info("Socket connected", { socketId: socket.id });
      socket.on("disconnect", () => {
        logger.info("Socket disconnected", { socketId: socket.id });
      });
    });

    registerIo(io);

    httpServer.listen(env.port, () => {
      logger.info(`Server running on port ${env.port}`);
    });
  } catch (err) {
    logger.error("Failed to boot server", {
      error: err.message,
      hint:
        "Ensure MongoDB is running and MONGO_URI in server/.env is correct. Example: mongodb://127.0.0.1:27017/ot_scheduler"
    });
    process.exit(1);
  }
}

bootstrap();
