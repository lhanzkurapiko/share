import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json({ limit: "10mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(__dirname));

const BASE = "https://jrmtool-api.vercel.app/api/gemini";

app.post("/ai", async (req, res) => {
  const { message, image } = req.body;

  try {
    let url = `${BASE}?ask=${encodeURIComponent(message || "Describe this")}`;
    if (image) url += `&imagurl=${encodeURIComponent(image)}`;

    const r = await fetch(url);
    const data = await r.json();

    const reply = data.result || data.reply || data.message || "No response.";
    res.json({ reply });
  } catch (e) {
    res.json({ reply: "AI error." });
  }
});

app.listen(3000, () => {
  console.log("Jzov AI running → http://localhost:3000");
});