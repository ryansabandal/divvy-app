import express from "express";
import cors from "cors";
import { prisma } from "./db";
import { sessionsRouter } from "./routes/sessions";

// Single shared Express app instance for the API
const app = express();
// Allow only the known frontend origins — localhost for dev, Vercel for production
app.use(cors({ origin: ["http://localhost:3000", "https://divvy-app-zeta.vercel.app"] }));
// Parse incoming JSON request bodies
app.use(express.json());

// Health check that also confirms the DB connection is alive
app.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok" });
});

// All routes here are relative to /api/sessions (e.g. POST / becomes POST /api/sessions)
app.use("/api/sessions", sessionsRouter);

// Central error handler — must be registered after all routes and have exactly 4 args so Express identifies it as error middleware
// In production, sends a generic message so stack traces never reach the client; in development, sends the real message for easier debugging
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    const message =
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message;
    res.status(500).json({ error: message });
  },
);

const port = process.env.PORT ?? 4000;
app.listen(port, () => {
  console.log(`Divvy API listening on port ${port}`);
});
