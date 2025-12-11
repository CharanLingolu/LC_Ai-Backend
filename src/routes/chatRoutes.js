// src/routes/chatRoutes.js
import express from "express";
import dotenv from "dotenv";
import Room from "../models/Room.js"; // 🔹 Import Room to check allowAI

dotenv.config();

const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("⚠️ GEMINI_API_KEY is not set in .env");
}

// 👉 Use one of the models your key supports (from /models)
const MODEL_ID = "gemini-2.5-flash";
// (we will call: v1/models/gemini-2.5-flash:generateContent)

// Helper: Pick system prompt based on mode
function getSystemPrompt(mode) {
  switch (mode) {
    case "friend":
      return "You are LC_Ai, a warm, supportive, slightly playful friend. You talk casually, encourage the user, and keep answers clear and short unless they ask for detail.";
    case "prompt_engineer":
      return "You are an expert prompt engineer. When the user asks something, you help rewrite or design powerful prompts for other AI models. Give the final prompt clearly, optionally with brief explanation.";
    case "text_tools":
      return "You are a text editing assistant. You can rewrite, summarize, correct grammar, and format text. Keep the meaning but improve clarity.";
    case "room":
      return "You are an AI participant in a group chat room. Respond as a helpful assistant to all participants. Be neutral, concise, and avoid very long answers unless asked.";
    default:
      return "You are a helpful AI assistant.";
  }
}

// ---------- OPTIONAL: list models ----------
// GET /api/chat/models
router.get("/models", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res
        .status(500)
        .json({ error: "GEMINI_API_KEY is not configured" });
    }

    const url = `https://generativelanguage.googleapis.com/v1/models?key=${GEMINI_API_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Models fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Shared handler for both "/" and "/:mode" ----------
async function handleChat(req, res, explicitMode) {
  try {
    const body = req.body || {};
    const bodyMode = body.mode;
    const messages = body.messages;

    // 🔹 For room-mode, we'll also expect roomId in body
    const mode = explicitMode || bodyMode || "friend";

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    if (!GEMINI_API_KEY) {
      return res
        .status(500)
        .json({ error: "GEMINI_API_KEY is not configured" });
    }

    // 🔒 IMPORTANT: If we are in a room, enforce allowAI from DB
    if (mode === "room") {
      const roomId = body.roomId;

      if (!roomId) {
        return res
          .status(400)
          .json({ error: "roomId is required for room mode" });
      }

      try {
        const room = await Room.findById(roomId);

        if (!room) {
          return res.status(404).json({ error: "Room not found" });
        }

        if (!room.allowAI) {
          // Owner turned AI off → nobody can use it (owner or guests)
          return res.status(403).json({
            error: "AI is disabled by the room owner.",
          });
        }
      } catch (err) {
        console.error("Room lookup failed in chat route:", err);
        return res
          .status(500)
          .json({ error: "Failed to validate room for AI" });
      }
    }

    const systemPrompt = getSystemPrompt(mode);

    // Build contents for Gemini v1 REST API
    const contents = [
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      ...messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    ];

    const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;

    let resp;
    let data;

    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
      });
    } catch (fetchErr) {
      // network/fetch-level error (DNS, connectivity, etc.)
      console.error("🛑 Gemini fetch threw an error:", fetchErr);
      return res.status(502).json({
        error: "Failed to reach Gemini API",
        details: fetchErr.message,
      });
    }

    try {
      data = await resp.json();
    } catch (jsonErr) {
      console.error("🛑 Failed to parse Gemini response JSON:", jsonErr);
      console.error(
        "🛑 raw status:",
        resp.status,
        "statusText:",
        resp.statusText
      );
      const rawText = await resp.text().catch(() => "<unreadable>");
      console.error(
        "🛑 raw body:",
        rawText.slice ? rawText.slice(0, 2000) : "<no-body>"
      );
      return res.status(502).json({
        error: "Invalid JSON from Gemini API",
        status: resp.status,
        statusText: resp.statusText,
      });
    }

    // If Gemini returned non-OK, log full body for diagnostics
    if (!resp.ok) {
      console.error("🛑 Gemini error (status):", resp.status, resp.statusText);
      // log full response body (capped)
      try {
        console.error(
          "🛑 Gemini error body:",
          JSON.stringify(data).slice(0, 4000)
        );
      } catch (e) {
        console.error("🛑 Could not stringify Gemini error body", e);
      }

      const msg =
        data.error?.message ||
        data.error?.errors?.[0]?.message ||
        "Gemini request failed (non-OK response)";
      return res.status(500).json({ error: msg, details: data });
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    const text =
      parts
        .map((p) => p.text)
        .filter(Boolean)
        .join(" ")
        .trim() || "";

    if (!text) {
      console.error(
        "🛑 Gemini returned empty text. Full response:",
        JSON.stringify(data).slice(0, 2000)
      );
      return res.status(500).json({ error: "No reply from AI", details: data });
    }

    res.json({
      reply: { role: "assistant", content: text },
    });
  } catch (err) {
    console.error("🛑 Chat route error:", err && err.stack ? err.stack : err);
    res.status(500).json({
      error: "AI Request Failed",
      details: err?.message,
    });
  }
}

// ---------- Routes ----------

// Old style: POST /api/chat  with { mode, messages, (optional roomId) }
router.post("/", (req, res) => handleChat(req, res, null));

// New style: POST /api/chat/:mode  (e.g. /friend, /room)
// For /room, body must include { roomId, messages: [...] }
router.post("/:mode", (req, res) => {
  const { mode } = req.params;
  handleChat(req, res, mode);
});

export default router;
