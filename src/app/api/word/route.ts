import OpenAI from "openai";

export const runtime = "nodejs";

type Secret = {
  language: "es";
  category: string;
  word: string;
  difficulty: "easy" | "normal" | "hard";
  hints: string[];
};

const WORD_RE = /^[a-záéíóúüñ]+(?: [a-záéíóúüñ]+){0,2}$/i;
const ENTITY_NAME_RE =
  /^[A-ZÁÉÍÓÚÜÑ][\p{L}\p{N}'’\-]+(?: [A-ZÁÉÍÓÚÜÑ][\p{L}\p{N}'’\-]+){0,3}$/u;

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

function isEntitiesOnlyCategory(category: string) {
  const c = normalize(category);
  return c.includes("estadio") || c.includes("estadios");
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

  if (isEntitiesOnlyCategory(category)) {
    if (!ENTITY_NAME_RE.test(word)) errs.push("entity_name_required");
  }

  if (hints.length !== 3) errs.push("hints_count");
  for (const h of hints) {
    if (h.length < 2 || h.length > 28) errs.push("hint_length");
    if (!WORD_RE.test(h)) errs.push("hint_format");
    if (hintLeaksWord(word, h)) errs.push("hint_leaks_word");
  }

  return { ok: errs.length === 0, errs };
}

async function verifyFootballStadium(client: OpenAI, word: string) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: { ok: { type: "boolean" }, reason: { type: "string" } },
    required: ["ok", "reason"],
  } as const;

  const prompt = [
    "Responde SOLO con JSON.",
    "Pregunta: ¿La siguiente palabra es el nombre real de un estadio de fútbol?",
    "Si no es un estadio (animal, comida, objeto, concepto, lugar genérico), ok=false.",
    `Palabra: "${word}"`,
  ].join("\n");

  try {
    const resp = await client.responses.create({
      model: "gpt-5-mini",
      input: prompt,
      store: false,
      text: { format: { type: "json_schema", name: "stadium_check", strict: true, schema } },
    });

    const raw = resp.output_text?.trim() || "";
    const parsed = JSON.parse(raw) as { ok: boolean; reason: string };
    return parsed.ok === true;
  } catch {
    return false;
  }
}

async function moderate(client: OpenAI, text: string) {
  const r = await client.moderations.create({
    model: "omni-moderation-latest",
    input: text,
  });
  return { flagged: !!r.results?.[0]?.flagged };
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Missing OPENAI_API_KEY. Add it to .env.local (local) or Vercel Env Vars and redeploy." },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey });

    const body = await req.json().catch(() => ({}));
    const categoriesRaw = body.categories;
    const difficulty: "easy" | "normal" | "hard" = body.difficulty || "easy";
    const usedWords: string[] = Array.isArray(body.usedWords) ? body.usedWords : [];

    const categories = Array.isArray(categoriesRaw)
      ? categoriesRaw.map((c: any) => sanitizeCategory(String(c)))
      : [];
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

    for (let attempt = 0; attempt < 5; attempt++) {
      const prompt = [
        "Genera una palabra para un juego social tipo 'impostor'.",
        "Idioma: español.",
        `Categorías permitidas: ${selected.join(", ")}.`,
        "",
        "Regla clave: la palabra debe pertenecer estrictamente a la categoría elegida.",
        "",
        "REGLA ESPECIAL:",
        "Si la categoría contiene 'estadio/estadios', la palabra debe ser SOLO el nombre real de un estadio de fútbol.",
        "Ejemplos válidos: Camp Nou, Santiago Bernabéu, Old Trafford, San Mamés, Wembley.",
        "Ejemplos NO válidos: animales, comida, objetos, conceptos o partes del estadio.",
        "",
        `Dificultad: ${difficulty}.`,
        "Se permiten 1 a 3 palabras (máx 2 espacios).",
        `NO repitas palabras usadas: ${usedWords.slice(-50).join(", ") || "(ninguna)"}.`,
        "",
        "Devuelve EXACTAMENTE 3 pistas relacionadas.",
        "Las pistas NO deben incluir ninguna parte del nombre.",
        lastErrs.length ? `Corrige estos errores previos: ${lastErrs.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join("\n");

      let payload: Secret | null = null;

      try {
        const resp = await client.responses.create({
          model: "gpt-5-mini",
          input: prompt,
          store: false,
          text: { format: { type: "json_schema", name: "word_pick", strict: true, schema } },
        });

        payload = JSON.parse(resp.output_text || "") as Secret;
      } catch (e: any) {
  const status = e?.status || e?.response?.status;
  const msg =
    e?.message ||
    e?.response?.data?.error?.message ||
    e?.error?.message ||
    "unknown_openai_error";

  console.error("OpenAI error:", { status, msg });

  lastErrs = [`openai_failed_${status || "no_status"}`, String(msg).slice(0, 160)];
  continue;
}

      const hv = hardValidate(payload, selected, usedWords);
      if (!hv.ok) {
        lastErrs = hv.errs;
        continue;
      }

      if (isEntitiesOnlyCategory(payload.category)) {
        const ok = await verifyFootballStadium(client, payload.word);
        if (!ok) {
          lastErrs = ["semantic_check_failed"];
          continue;
        }
      }

      const mod = await moderate(client, `${payload.word}\n${payload.hints.join("\n")}`);
      if (mod.flagged) {
        lastErrs = ["moderation_flagged"];
        continue;
      }

      return Response.json(payload, { status: 200 });
    }

    return Response.json({ error: "Failed to generate a valid word", lastErrs }, { status: 500 });
  } catch (err: any) {
    console.error("Unhandled /api/word error:", err?.message || err);
    return Response.json(
      { error: "Unhandled server error in /api/word", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}
