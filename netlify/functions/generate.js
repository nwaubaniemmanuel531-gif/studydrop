// Runs on the server. Your API key lives in the ANTHROPIC_API_KEY environment variable, never in the page.
const hits = new Map();
const MAX_PER_HOUR = 30;

const reply = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "Use POST." });

  const ip = (event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) hits.set(ip, { n: 1, reset: now + 3600e3 });
  else if (++rec.n > MAX_PER_HOUR) return reply(429, { error: "Too many requests. Try again later." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "Bad request." }); }
  const notes = String(body.notes || "").trim().slice(0, 8000);
  const n = [5, 8, 12].includes(Number(body.n)) ? Number(body.n) : 8;
  if (notes.length < 80) return reply(400, { error: "Add a few more lines of notes." });
  if (!process.env.ANTHROPIC_API_KEY) return reply(500, { error: "Server is missing its API key." });

  const prompt = `You are a sharp study coach for students. From the notes below, create a study set.
Return ONLY JSON, no markdown, in this shape:
{"summary":["5 to 7 short bullet strings"],"flashcards":[{"q":"...","a":"..."}],"quiz":[{"q":"...","options":["A","B","C","D"],"answer":0,"why":"one short sentence"}]}
Make up to ${n} flashcards and up to ${n} quiz questions (fewer if the notes are thin).
Mix recall questions with "why" and "how" questions that test understanding. Wrong quiz options must be plausible, not silly.
Use only facts from the notes. Keep answers short. "answer" is the index (0-3) of the correct option; vary its position.

NOTES:
${notes}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.MODEL || "claude-haiku-5-5",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    if (!res.ok) return reply(502, { error: "The AI service had a problem. Try again." });
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    return reply(200, JSON.parse(clean));
  } catch (e) {
    return reply(502, { error: "Couldn't build that set. Try again." });
  }
};
