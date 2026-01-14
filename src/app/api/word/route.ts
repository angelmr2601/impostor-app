export const runtime = "nodejs";

type Difficulty = "easy" | "normal" | "hard";
type Secret = {
  language: "es";
  category: string;
  word: string;
  difficulty: Difficulty;
  hints: string[];
};

const HF_API_URL = "https://api-inference.huggingface.co/models";

// Modelo recomendado “barato/rápido” para serverless.
// Puedes cambiarlo si quieres (ojo: algunos modelos están “gated” o no soportados serverless).
const HF_MODEL = process.env.HF_MODEL || "mistralai/Mistral-7B-Instruct-v0.3";

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

/**
 * HF text-generation endpoint suele devolver:
 *  - [{ "generated_text": "..." }]  o  { "generated_text": "..." }
 * y a veces mensajes tipo {"error":"..."} / {"estimated_time":...}
 */
async function hfGenerate(prompt: string, maxNewTokens: number) {
  const token = process.env.HF_TOKEN;
  if (!token) {
    return { ok: false as const, status: 500, text: "", error: "Missing HF_TOKEN env var" };
  }

  const url = `${HF_API_URL}/${encodeURIComponent(HF_MODEL)}`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: maxNewTokens,
        temperature: 0.2,
        top_p: 0.9,
        return_full_text: false,
      },
      options: {
        wait_for_model: true,
        use_cache: false,
      },
    }),
  });

  const status = r.status;
  const raw = await r.text().catch(() => "");
  if (!r.ok) {
    return { ok: false as const, status, text: raw, error: `HF ${status}` };
  }
  return { ok: true as const, status, text: raw, error: "" };
}

/** Extrae el primer objeto JSON {...} de un string (por si el modelo añade texto alrededor). */
function extractFirstJsonObject(s: string) {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) {
      const candidate = s.slice(start, i + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Parseo tolerante de respuesta HF */
function parseHfOutput(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    // casos: array
    if (Array.isArray(parsed) && parsed[0]?.generated_text) return String(parsed[0].generated_text);
    // caso: objeto
    if (parsed?.generated_text) return String(parsed.generated_text);
    // errores comunes
    if (parsed?.error) return `__HF_ERROR__:${String(parsed.error)}`;
    return String(raw);
  } catch {
    return String(raw);
  }
}

/** Verificación semántica “es un estadio real” usando HF (sí/no). */
async function verifyFootballStadium(word: string) {
  const prompt = [
    "Responde SOLO con JSON.",
    "Devuelve exactamente: {\"ok\":true} o {\"ok\":false}. Sin texto extra.",
    "Pregunta: ¿La palabra es el nombre real de un estadio de fútbol?",
    `Palabra: "${word}"`,
  ].join("\n");

  const gen = await hfGenerate(prompt, 40);
  if (!gen.ok) return false;

  const out = parseHfOutput(gen.text);
  if (out.startsWith("__HF_ERROR__")) return false;

  const obj = extractFirstJsonObject(out);
  if (!obj || typeof obj.ok !== "boolean") return false;
  return obj.ok === true;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const categoriesRaw = body.categories;
    const difficulty: Difficulty = body.difficulty || "easy";
    const usedWords: string[] = Array.isArray(body.usedWords) ? body.usedWords : [];

    const categories = Array.isArray(categoriesRaw)
      ? categoriesRaw.map((c: any) => sanitizeCategory(String(c)))
      : [];
    const selected = categories.filter(Boolean) as string[];

    if (!selected.length) {
      return Response.json({ error: "No categories selected" }, { status: 400 });
    }

    let lastErrs: string[] = [];

    for (let attempt = 0; attempt < 5; attempt++) {
      const prompt = [
        "Eres un generador de palabras para un juego social tipo 'impostor'.",
        "Idioma: español.",
        `Categorías permitidas: ${selected.join(", ")}.`,
        "",
        "Devuelve SOLO un JSON válido (sin markdown, sin texto extra) con esta forma:",
        '{"language":"es","category":"<una de las categorías>","word":"<1-3 palabras>","difficulty":"easy|normal|hard","hints":["<pista1>","<pista2>","<pista3>"]}',
        "",
        "Reglas:",
        "- category DEBE ser exactamente una de las categorías permitidas.",
        "- word: 1 a 3 palabras, apto para todas las edades.",
        "- hints: exactamente 3 pistas, relacionadas y que NO contengan partes de la palabra.",
        `- difficulty: ${difficulty}.`,
        usedWords.length ? `- NO repitas palabras usadas: ${usedWords.slice(-50).join(", ")}.` : "",
        "",
        "Regla especial de estadios:",
        "- Si la categoría contiene 'estadio/estadios', word debe ser SOLO el nombre real de un estadio de fútbol (nombre propio).",
        "",
        lastErrs.length ? `Corrige estos errores previos: ${lastErrs.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const gen = await hfGenerate(prompt, 240);
      if (!gen.ok) {
        // devuelvo error claro para debug
        lastErrs = [`hf_http_${gen.status}`, gen.text.slice(0, 180)];
        continue;
      }

      const out = parseHfOutput(gen.text);
      if (out.startsWith("__HF_ERROR__")) {
        lastErrs = [out.slice(0, 180)];
        continue;
      }

      const payload = extractFirstJsonObject(out) as Secret | null;
      if (!payload) {
        lastErrs = ["json_parse_failed"];
        continue;
      }

      const hv = hardValidate(payload, selected, usedWords);
      if (!hv.ok) {
        lastErrs = hv.errs;
        continue;
      }

      // verificación semántica SOLO para estadios
      if (isEntitiesOnlyCategory(payload.category)) {
        const ok = await verifyFootballStadium(payload.word);
        if (!ok) {
          lastErrs = ["semantic_check_failed_not_a_stadium"];
          continue;
        }
      }

      return Response.json(payload, { status: 200 });
    }

    return Response.json({ error: "Failed to generate a valid word", lastErrs }, { status: 500 });
  } catch (err: any) {
    return Response.json(
      { error: "Unhandled server error in /api/word", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}
