// src/routes/chatRoutes.js
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("⚠️ GEMINI_API_KEY is not set in .env");
}

// 👉 Use one of the models your key supports (from /models)
// NOTE: "gemini-2.5-flash" might not be valid yet, switched to standard "gemini-1.5-flash"
// If you are sure 2.5 exists for your account, you can change it back.
const MODEL_ID = "gemini-1.5-flash";

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

    const mode = explicitMode || bodyMode || "friend";

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    if (!GEMINI_API_KEY) {
      return res
        .status(500)
        .json({ error: "GEMINI_API_KEY is not configured" });
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

    // --- RETRY LOGIC WRAPPER START ---
    async function fetchWithRetry(retries = 3, delay = 10000) {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
      });

      const data = await resp.json();

      // If we hit a Quota Error (429 or specific error message)
      if (!resp.ok) {
        if (
          retries > 0 &&
          (resp.status === 429 || JSON.stringify(data).includes("quota"))
        ) {
          console.warn(`⚠️ Quota hit. Retrying in ${delay / 1000}s...`);

          // Wait for the delay
          await new Promise((resolve) => setTimeout(resolve, delay));

          // Retry with doubled delay (Exponential Backoff)
          // 10s -> 20s -> 40s
          return fetchWithRetry(retries - 1, delay * 2);
        }

        // If it's a real error (not quota), throw it immediately
        const msg =
          data.error?.message || "Gemini request failed (non-OK response)";
        throw new Error(msg);
      }

      return data;
    }
    // --- RETRY LOGIC WRAPPER END ---

    // Execute the call with retry logic
    const data = await fetchWithRetry();

    const parts = data.candidates?.[0]?.content?.parts || [];
    const text =
      parts
        .map((p) => p.text)
        .filter(Boolean)
        .join(" ")
        .trim() || "";

    if (!text) {
      return res.status(500).json({ error: "No reply from AI" });
    }

    res.json({
      reply: { role: "assistant", content: text },
    });
  } catch (err) {
    console.error("🛑 Chat route error:", err.message);

    // If it STILL fails after retries, send a clean message
    if (err.message.toLowerCase().includes("quota")) {
      return res.status(503).json({
        error:
          "Server is busy (Quota Limit). Please wait 30 seconds and try again.",
      });
    }

    res.status(500).json({
      error: "AI Request Failed",
      details: err.message,
    });
  }
}

// ---------- Routes ----------

// Old style: POST /api/chat  with { mode, messages }
router.post("/", (req, res) => handleChat(req, res, null));

// New style: POST /api/chat/:mode  (e.g. /friend, /room)
// Not used by your current frontend, but kept for flexibility.
router.post("/:mode", (req, res) => {
  const { mode } = req.params;
  handleChat(req, res, mode);
});

export default router;
