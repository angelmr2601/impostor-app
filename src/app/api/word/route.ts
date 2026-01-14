import OpenAI from "openai";

export const runtime = "nodejs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// 1 a 3 palabras (máx 2 espacios), letras españolas
const WORD_RE = /^[a-záéíóúüñ]+(?: [a-záéíóúüñ]+){0,2}$/i;

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function tokens(word: string) {
  return normalize(word).split(/\s+/).filter(Boolean);
}

function hintLeaksWord(word: string, hint: string) {
  const wTok = tokens(word);
  const h = normalize(hint);
  return wTok.some((t) => t.length >= 4 && h.includes(t));
}

function sanitizeCategory(c: string) {
  const s = String(c).replace(/\s+/g, " ").trim();
  if (s.length < 3 || s.length > 40) return null;
  if (!/^[\p{L}\p{N} áéíóúüñÁÉÍÓÚÜÑ'’\-]+$/u.test(s)) return null;
  return s;
}

function hardValidate(payload: any, selectedCategories: string[], usedWords: string[]) {
  const errs: string[] = [];
  const category = String(payload?.category ?? "").trim();
  const word = String(payload?.word ?? "").trim();
  const hints = Array.isArray(payload?.hints) ? payload.hints.map((x: any) => String(x).trim()) : [];

  if (!selectedCategories.includes(category)) errs.push("category_not_selected");
  if (word.length < 3 || word.length > 32) errs.push("word_length");
  if (!WORD_RE.test(word)) errs.push("word_format");

  const used = new Set((usedWords || []).map((w) => normalize(String(w))));
  if (used.has(normalize(word))) errs.push("word_repeated");

  if (hints.length !== 3) errs.push("hints_count");
  for (const h of hints) {
    if (h.length < 2 || h.length > 28) errs.push("hint_length");
    if (!WORD_RE.test(h)) errs.push("hint_format");
    if (hintLeaksWord(word, h)) errs.push("hint_leaks_word");
  }

  return { ok: errs.length === 0, errs };
}

async function moderate(text: string) {
  const r = await client.moderations.create({
    model: "omni-moderation-latest",
    input: text,
  });
  return { flagged: !!r.results?.[0]?.flagged };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const categoriesRaw: unknown = body.categories;
  const difficulty: "easy" | "normal" | "hard" = body.difficulty || "easy";
  const usedWords: string[] = Array.isArray(body.usedWords) ? body.usedWords : [];

  const categories = Array.isArray(categoriesRaw) ? categoriesRaw.map((c) => sanitizeCategory(String(c))) : [];
  const selected = categories.filter(Boolean) as string[];

  if (!selected.length) {
    return Response.json({ error: "No categories selected" }, { status: 400 });
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      language: { type: "string", enum: ["es"] },
      category: { type: "string", enum: selected },
      word: { type: "string" },
      difficulty: { type: "string", enum: ["easy", "normal", "hard"] },
      hints: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
    },
    required: ["language", "category", "word", "difficulty", "hints"],
  } as const;

  let lastErrs: string[] = [];

  for (let attempt = 0; attempt < 3; attempt++) {
    const prompt = [
      "Genera una palabra para un juego social tipo 'impostor'.",
      "Idioma: español.",
      `Categorías permitidas: ${selected.join(", ")}.`,
      "REGLA MUY IMPORTANTE: si una categoría es una frase (ej: 'estadios de fútbol'), genera SOLO ENTIDADES específicas de esa categoría (nombres propios reales).",
      "No generes cosas relacionadas ni genéricas (ej: NO 'grada', NO 'césped', NO 'portería', NO 'afición').",
      "La 'word' debe ser el nombre de la entidad (ej: 'Camp Nou', 'Santiago Bernabéu', 'Old Trafford').",
      `Dificultad: ${difficulty}.`,
      "La palabra debe ser apta para todas las edades.",
      "Se permiten 1 a 3 palabras (máx 2 espacios).",
      `NO repitas palabras usadas: ${usedWords.slice(-50).join(", ") || "(ninguna)"}.`,
      "Devuelve EXACTAMENTE 3 pistas relacionadas.",
      "Las pistas NO deben incluir ninguna parte de la palabra (ni tokens largos dentro del nombre).",
      lastErrs.length ? `Corrige estos errores previos: ${lastErrs.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const resp = await client.responses.create({
      model: "gpt-5-mini",
      input: prompt,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "word_pick",
          strict: true,
          schema,
        },
      },
    });

    const raw = resp.output_text?.trim() || "";
    let payload: any = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      lastErrs = ["json_parse_failed"];
      continue;
    }

    const hv = hardValidate(payload, selected, usedWords);
    if (!hv.ok) {
      lastErrs = hv.errs;
      continue;
    }

    const mod = await moderate(`${payload.word}\n${payload.hints.join("\n")}`);
    if (mod.flagged) {
      lastErrs = ["moderation_flagged"];
      continue;
    }

    return Response.json(payload, { status: 200 });
  }

  return Response.json({ error: "Failed to generate a valid word", lastErrs }, { status: 500 });
}
