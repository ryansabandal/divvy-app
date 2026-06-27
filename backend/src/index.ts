import express from "express";
import { prisma } from "./db";
import { sessionsRouter } from "./routes/sessions";

// Single shared Express app instance for the API
const app = express();
// Parse incoming JSON request bodies
app.use(express.json());

// Health check that also confirms the DB connection is alive
app.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok" });
});

// All routes here are relative to /api/sessions (e.g. POST / becomes POST /api/sessions)
app.use("/api/sessions", sessionsRouter);

const port = process.env.PORT ?? 4000;
app.listen(port, () => {
  console.log(`Divvy API listening on port ${port}`);
});
