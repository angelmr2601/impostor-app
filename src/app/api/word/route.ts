export const runtime = "nodejs";

type Difficulty = "easy" | "normal" | "hard";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function sanitizeCategory(c: string) {
  const s = String(c).replace(/\s+/g, " ").trim();
  if (s.length < 3 || s.length > 40) return null;
  if (!/^[\p{L}\p{N} áéíóúüñÁÉÍÓÚÜÑ'’\-]+$/u.test(s)) return null;
  return s;
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

    // ✅ URL base de tu Space (sin barra final)
    // Ejemplo: https://angelmr26-impostor-wordgen.hf.space
    const SPACE_URL = process.env.HF_SPACE_URL || "YOUR_SPACE_URL";

    if (SPACE_URL === "YOUR_SPACE_URL") {
      return Response.json(
        { error: "Missing HF_SPACE_URL. Set it to your Space URL, e.g. https://<user>-<space>.hf.space" },
        { status: 500 }
      );
    }

    // 1) Lanzar el trabajo
    // Gradio HTTP API: POST /call/<api_name> con { data: [...] }
    // Docs: /call/predict devuelve un event_id, luego haces GET al endpoint de resultado. :contentReference[oaicite:2]{index=2}
    const start = await fetch(`${SPACE_URL}/call/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [selected, difficulty, usedWords],
      }),
    });

    const startText = await start.text().catch(() => "");
    if (!start.ok) {
      return Response.json(
        { error: "Space start failed", status: start.status, details: startText.slice(0, 400) },
        { status: 500 }
      );
    }

    let eventId = "";
    try {
      const js = JSON.parse(startText);
      eventId = js?.event_id || js?.eventId || "";
    } catch {
      // a veces viene como texto: {"event_id":"..."}
      eventId = "";
    }

    if (!eventId) {
      return Response.json(
        { error: "Space did not return event_id", details: startText.slice(0, 400) },
        { status: 500 }
      );
    }

    // 2) Polling del resultado
    // En Gradio moderno, el resultado suele estar en: GET /call/predict/<event_id>
    // (o endpoint equivalente). :contentReference[oaicite:3]{index=3}
    let lastRaw = "";
    for (let i = 0; i < 30; i++) {
      await sleep(500);

      const res = await fetch(`${SPACE_URL}/call/predict/${eventId}`);
      lastRaw = await res.text().catch(() => "");
      if (!res.ok) continue;

      // El payload típico incluye un campo "status" y cuando termina "data"
      try {
        const js = JSON.parse(lastRaw);

        // Si está procesando, sigue
        if (js?.status && js.status !== "complete" && js.status !== "succeeded") {
          continue;
        }

        // La data suele venir como array: { data: [<json_result>] }
        const data = js?.data;
        const output = Array.isArray(data) ? data[0] : data;

        if (!output) continue;

        return Response.json(output, { status: 200 });
      } catch {
        // si no parsea, seguimos intentando
        continue;
      }
    }

    return Response.json({ error: "Space timeout", details: lastRaw.slice(0, 400) }, { status: 504 });
  } catch (err: any) {
    return Response.json(
      { error: "Unhandled server error in /api/word", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}
