import { Router } from "express";
import { prisma } from "../db";

// Sub-router for everything mounted under /api/sessions in index.ts
export const sessionsRouter = Router();

// POST /api/sessions — create a session and its initial participants together
sessionsRouter.post("/", async (req, res) => {
  const { name, participants } = req.body;

  // Validate at the boundary: reject bad input before it reaches Prisma
  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "name is required" });
  }
  if (!Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({ error: "participants must be a non-empty array of names" });
  }

  // Nested write: creates the Session row and all Participant rows in one transaction
  const session = await prisma.session.create({
    data: {
      name,
      participants: {
        create: participants.map((participantName: string) => ({ name: participantName })),
      },
    },
    include: { participants: true },
  });

  res.status(201).json(session);
});

// GET /api/sessions/:sessionId — fetch a session with everything needed to render it
sessionsRouter.get("/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      participants: true,
      expenses: {
        include: {
          payer: true,
          splits: { include: { participant: true } },
        },
      },
    },
  });

  // findUnique returns null rather than throwing when nothing matches
  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  res.json(session);
});

// POST /api/sessions/:sessionId/participants — add one participant to an existing session
sessionsRouter.post("/:sessionId/participants", async (req, res) => {
  const { sessionId } = req.params;
  const { name } = req.body;

  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "name is required" });
  }

  // Confirm the parent session exists before attaching a participant to it
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  const participant = await prisma.participant.create({
    data: { name, session_id: sessionId },
  });

  res.status(201).json(participant);
});
