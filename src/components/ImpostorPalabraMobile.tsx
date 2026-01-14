"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Eye, EyeOff, Vote, RotateCcw, Loader2 } from "lucide-react";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

const PHASES = {
  SETUP: "setup",
  REVEAL: "reveal",
  VOTE: "vote",
  RESULT: "result"
} as const;

const WORD_BANK: Record<string, { w: string; hints: string[] }[]> = {
  Lugares: [
    { w: "playa", hints: ["arena", "mar", "sombrilla"] },
    { w: "aeropuerto", hints: ["maletas", "vuelos", "terminal"] },
    { w: "biblioteca", hints: ["silencio", "libros", "préstamo"] },
    { w: "hospital", hints: ["urgencias", "médicos", "pacientes"] },
    { w: "museo", hints: ["arte", "exposiciones", "entradas"] }
  ],
  Comida: [
    { w: "pizza", hints: ["queso", "horno", "porciones"] },
    { w: "sushi", hints: ["arroz", "palillos", "pescado"] },
    { w: "paella", hints: ["arroz", "marisco", "sartén"] },
    { w: "tacos", hints: ["tortilla", "salsa", "relleno"] }
  ],
  Animales: [
    { w: "delfín", hints: ["mar", "saltos", "inteligente"] },
    { w: "jirafa", hints: ["cuello", "manchas", "sabana"] },
    { w: "pingüino", hints: ["hielo", "frío", "caminar"] },
    { w: "lobo", hints: ["aullido", "manada", "bosque"] }
  ],
  Objetos: [
    { w: "teléfono", hints: ["apps", "pantalla", "llamadas"] },
    { w: "paraguas", hints: ["lluvia", "abrir", "mojarse"] },
    { w: "llave", hints: ["cerradura", "metal", "abrir"] },
    { w: "gafas", hints: ["lentes", "vista", "montura"] }
  ],
  Ocio: [
    { w: "cine", hints: ["palomitas", "pantalla", "butacas"] },
    { w: "concierto", hints: ["música", "escenario", "entradas"] },
    { w: "fútbol", hints: ["balón", "gol", "equipo"] },
    { w: "camping", hints: ["tienda", "bosque", "fuego"] }
  ]
};

function pickRandom<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function chooseSecretFromLocal(selectedCategoryList: string[], usedWords: string[]) {
  const used = new Set((usedWords || []).map((w) => String(w).toLowerCase()));
  const categories = selectedCategoryList.filter((c) => WORD_BANK[c]);
  const all = categories.flatMap((c) =>
    WORD_BANK[c].map((it) => ({ category: c, word: it.w, hints: it.hints || [] }))
  );
  const notUsed = all.filter((x) => !used.has(String(x.word).toLowerCase()));
  return pickRandom((notUsed.length ? notUsed : all) as any[]);
}

function buildImpostorHintOnce(secret: any, hintStyle: string) {
  if (!secret) return "";
  if (hintStyle === "category") return `Categoría: ${secret.category}`;
  if (hintStyle === "first_letter") return `Empieza por: ${String(secret.word).slice(0, 1).toUpperCase()}`;
  const hs = (secret.hints || []).filter(Boolean);
  if (!hs.length) return `Categoría: ${secret.category}`;
  return `Pista: ${pickRandom(hs)}`;
}

function getUsedWords() {
  try {
    return JSON.parse(localStorage.getItem("usedWords") || "[]");
  } catch {
    return [];
  }
}

function pushUsedWord(word: string) {
  try {
    const prev = getUsedWords();
    const next = [...prev, word].slice(-200);
    localStorage.setItem("usedWords", JSON.stringify(next));
  } catch {
    // ignore
  }
}

export default function ImpostorPalabraMobile() {
  const [phase, setPhase] = useState<(typeof PHASES)[keyof typeof PHASES]>(PHASES.SETUP);

  // Setup
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([{ id: uid(), name: "" }]);
  const [impostorCount, setImpostorCount] = useState(1);
  const categoryNames = useMemo(() => Object.keys(WORD_BANK), []);
  const [selectedCategories, setSelectedCategories] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of Object.keys(WORD_BANK)) init[c] = true;
    return init;
  });

  // Impostor hint
  const [giveImpostorHint, setGiveImpostorHint] = useState(true);
  const [hintStyle, setHintStyle] = useState("random_hint"); // random_hint | category | first_letter
  const [impostorHintText, setImpostorHintText] = useState("");

  // Game
  const [secret, setSecret] = useState<any>(null); // {category, word, hints}
  const [impostorIds, setImpostorIds] = useState<string[]>([]);

  // Reveal
  const [revealIndex, setRevealIndex] = useState(0);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [revealShown, setRevealShown] = useState(false);
  const [pendingNav, setPendingNav] = useState(0);

  // Vote
  const [mostVotedId, setMostVotedId] = useState<string | null>(null);
  const [resultHit, setResultHit] = useState<boolean | null>(null);

  // UX
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const validPlayers = useMemo(
    () => players.map((p) => ({ ...p, name: p.name.trim() })).filter((p) => p.name.length > 0),
    [players]
  );

  const selectedCategoryList = useMemo(
    () => categoryNames.filter((c) => selectedCategories[c]),
    [categoryNames, selectedCategories]
  );

  const canStart =
    validPlayers.length >= 3 &&
    impostorCount >= 1 &&
    impostorCount < validPlayers.length &&
    selectedCategoryList.length >= 1 &&
    !starting;

  useEffect(() => {
    setRevealShown(false);
  }, [revealIndex]);

  useEffect(() => {
    if (pendingNav === 0) return;
    if (revealShown) return;
    setRevealIndex((i) => clamp(i + pendingNav, 0, validPlayers.length - 1));
    setPendingNav(0);
  }, [pendingNav, revealShown, validPlayers.length]);

  function resetAll() {
    setPhase(PHASES.SETUP);
    setSecret(null);
    setImpostorIds([]);
    setRevealIndex(0);
    setRevealed({});
    setRevealShown(false);
    setPendingNav(0);
    setMostVotedId(null);
    setResultHit(null);
    setStarting(false);
    setStartError("");
    setImpostorHintText("");
  }

  async function fetchSecretFromApi(categories: string[], usedWords: string[]) {
    const r = await fetch("/api/word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories, difficulty: "easy", usedWords })
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(txt || `HTTP ${r.status}`);
    }
    return await r.json();
  }

  async function startGame() {
    setStarting(true);
    setStartError("");

    // roles
    const shuffled = [...validPlayers].sort(() => Math.random() - 0.5);
    const impostors = shuffled.slice(0, impostorCount).map((p) => p.id);

    // palabra
    let picked: any = null;
    const usedWords = typeof window !== "undefined" ? getUsedWords() : [];

    try {
      picked = await fetchSecretFromApi(selectedCategoryList, usedWords);
    } catch {
      picked = chooseSecretFromLocal(selectedCategoryList, usedWords);
      setStartError("No se pudo usar IA (usando pool local). Revisa /api/word y la API key.");
    }

    // pista estable para TODOS los impostores
    const hint = giveImpostorHint ? buildImpostorHintOnce(picked, hintStyle) : "";

    setImpostorIds(impostors);
    setSecret(picked);
    setImpostorHintText(hint);

    setRevealIndex(0);
    setRevealed({});
    setRevealShown(false);
    setPendingNav(0);

    setMostVotedId(null);
    setResultHit(null);

    if (picked?.word) pushUsedWord(String(picked.word));

    setPhase(PHASES.REVEAL);
    setStarting(false);
  }

  function currentRevealPlayer() {
    return validPlayers[revealIndex] || null;
  }

  function revealDone() {
    return Object.keys(revealed).length >= validPlayers.length;
  }

  function markRevealed(playerId: string) {
    setRevealed((r) => ({ ...r, [playerId]: true }));
  }

  function toggleRevealForCurrent() {
    const p = currentRevealPlayer();
    if (!p) return;
    setRevealShown((s) => {
      const next = !s;
      if (next) markRevealed(p.id);
      return next;
    });
  }

  function nextReveal(delta: number) {
    if (revealShown) {
      setPendingNav(delta);
      setRevealShown(false);
      return;
    }
    setRevealIndex((i) => clamp(i + delta, 0, validPlayers.length - 1));
  }

  function goVote() {
    setRevealShown(false);
    setMostVotedId(null);
    setPhase(PHASES.VOTE);
  }

  function submitVote() {
    const hit = mostVotedId ? impostorIds.includes(mostVotedId) : false;
    setResultHit(hit);
    setPhase(PHASES.RESULT);
  }

  const compactPage = "w-full max-w-md mx-auto";

  return (
    <div className="min-h-screen w-full bg-white text-black p-4">
      <div className={compactPage}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            <div className="font-semibold">Impostor</div>
            <Badge variant="secondary">{phase.toUpperCase()}</Badge>
          </div>
          <Button variant="outline" size="sm" onClick={resetAll} className="gap-2">
            <RotateCcw className="w-4 h-4" />
            Reiniciar
          </Button>
        </div>

        <AnimatePresence mode="wait">
          {phase === PHASES.SETUP && (
            <motion.div key="setup" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Configurar</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label>Jugadores</Label>
                      <Button variant="outline" size="sm" onClick={() => setPlayers((ps) => [...ps, { id: uid(), name: "" }])}>
                        +
                      </Button>
                    </div>
                    <div className="grid gap-2">
                      {players.map((p, idx) => (
                        <div key={p.id} className="flex gap-2">
                          <Input
                            placeholder={`Jugador ${idx + 1}`}
                            value={p.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPlayers((ps) => ps.map((x) => (x.id === p.id ? { ...x, name: val } : x)));
                            }}
                          />
                          <Button
                            variant="outline"
                            onClick={() => setPlayers((ps) => (ps.length <= 1 ? ps : ps.filter((x) => x.id !== p.id)))}
                            disabled={players.length <= 1}
                          >
                            ✕
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-black/60">Mínimo 3 jugadores.</div>
                  </div>

                  <Separator />

                  <div className="grid gap-2">
                    <Label>Categorías</Label>
                    <div className="flex flex-wrap gap-2">
                      {categoryNames.map((c) => {
                        const on = !!selectedCategories[c];
                        return (
                          <Button key={c} variant={on ? "default" : "outline"} onClick={() => setSelectedCategories((s) => ({ ...s, [c]: !s[c] }))}>
                            {c}
                          </Button>
                        );
                      })}
                    </div>
                    {selectedCategoryList.length === 0 && <div className="text-xs text-black/60">Selecciona al menos 1.</div>}
                  </div>

                  <Separator />

                  <div className="grid gap-2">
                    <Label>Impostores</Label>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" onClick={() => setImpostorCount((n) => clamp(n - 1, 1, Math.max(1, validPlayers.length - 1)))}>
                        -
                      </Button>
                      <div className="min-w-10 text-center font-semibold text-lg">{impostorCount}</div>
                      <Button variant="outline" onClick={() => setImpostorCount((n) => clamp(n + 1, 1, Math.max(1, validPlayers.length - 1)))}>
                        +
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <div className="grid gap-1">
                        <Label>Pista al impostor</Label>
                        <div className="text-xs text-black/60">Todos los impostores verán la misma pista</div>
                      </div>
                      <Switch checked={giveImpostorHint} onCheckedChange={setGiveImpostorHint} />
                    </div>

                    {giveImpostorHint && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant={hintStyle === "random_hint" ? "default" : "outline"} onClick={() => setHintStyle("random_hint")}>
                          Relacionada
                        </Button>
                        <Button variant={hintStyle === "category" ? "default" : "outline"} onClick={() => setHintStyle("category")}>
                          Categoría
                        </Button>
                        <Button variant={hintStyle === "first_letter" ? "default" : "outline"} onClick={() => setHintStyle("first_letter")}>
                          1ª letra
                        </Button>
                      </div>
                    )}
                  </div>

                  {!!startError && <div className="text-xs text-black/60 whitespace-pre-line">{startError}</div>}

                  <Button className="w-full h-12 text-base" disabled={!canStart} onClick={startGame}>
                    {starting ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Empezando…
                      </span>
                    ) : (
                      "Empezar"
                    )}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {phase === PHASES.REVEAL && (
            <motion.div key="reveal" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Privado</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-black/60">Jugador</div>
                      <div className="text-xl font-semibold">{currentRevealPlayer()?.name || ""}</div>
                    </div>
                    <Badge variant="secondary">
                      {Object.keys(revealed).length}/{validPlayers.length}
                    </Badge>
                  </div>

                  {(() => {
                    const p = currentRevealPlayer();
                    if (!p) return null;
                    const isImp = impostorIds.includes(p.id);
                    const hint = giveImpostorHint ? impostorHintText : "";
                    return (
                      <RevealPanel
                        key={p.id}
                        playerName={p.name}
                        isImpostor={isImp}
                        secretWord={secret?.word || ""}
                        impostorHintText={hint}
                        showHint={giveImpostorHint}
                        shown={revealShown}
                        onToggle={toggleRevealForCurrent}
                      />
                    );
                  })()}

                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => nextReveal(-1)} disabled={revealIndex === 0}>
                      Anterior
                    </Button>
                    <Button variant="outline" className="flex-1" onClick={() => nextReveal(1)} disabled={revealIndex === validPlayers.length - 1}>
                      Siguiente
                    </Button>
                  </div>

                  <Button className="w-full h-12 text-base gap-2" onClick={goVote} disabled={!revealDone()}>
                    <Vote className="w-4 h-4" /> Empezar votación
                  </Button>

                  {!revealDone() && <div className="text-xs text-black/60">Todos deben ver su pantalla antes de votar.</div>}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {phase === PHASES.VOTE && (
            <motion.div key="vote" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Votación</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="text-sm text-black/70">
                    Votad señalando y elige aquí al <span className="font-medium">más votado</span>.
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {validPlayers.map((p) => (
                      <Button
                        key={p.id}
                        variant={mostVotedId === p.id ? "default" : "outline"}
                        className="h-12"
                        onClick={() => setMostVotedId(p.id)}
                      >
                        {p.name}
                      </Button>
                    ))}
                  </div>

                  <Button className="w-full h-12 text-base" onClick={submitVote} disabled={!mostVotedId}>
                    Confirmar más votado
                  </Button>

                  <Button variant="outline" className="w-full" onClick={() => setMostVotedId(null)}>
                    Limpiar selección
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {phase === PHASES.RESULT && (
            <motion.div key="result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Resultado</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="rounded-2xl border border-black/10 p-4">
                    <div className="text-xs text-black/60">Más votado</div>
                    <div className="text-xl font-semibold">{validPlayers.find((p) => p.id === mostVotedId)?.name || ""}</div>
                  </div>

                  {resultHit ? (
                    <div className="rounded-2xl border border-black/10 p-4">
                      <div className="text-sm font-semibold">✅ Victoria de los tripulantes</div>
                      <div className="text-sm text-black/60 mt-1">Habéis encontrado al impostor.</div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-black/10 p-4">
                      <div className="text-sm font-semibold">❌ No acierto</div>
                      <div className="text-sm text-black/60 mt-1">El más votado era tripulante.</div>
                    </div>
                  )}

                  {resultHit ? (
                    <Button className="w-full h-12 text-base" onClick={resetAll}>
                      Nueva partida
                    </Button>
                  ) : (
                    <Button
                      className="w-full h-12 text-base"
                      onClick={() => {
                        setMostVotedId(null);
                        setPhase(PHASES.VOTE);
                      }}
                    >
                      Volver a votar
                    </Button>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function RevealPanel({
  playerName,
  isImpostor,
  secretWord,
  impostorHintText,
  showHint,
  shown,
  onToggle
}: {
  playerName: string;
  isImpostor: boolean;
  secretWord: string;
  impostorHintText: string;
  showHint: boolean;
  shown: boolean;
  onToggle: () => void;
}) {
  const isShown = !!shown;

  return (
    <div className="rounded-2xl border border-black/10 p-4 grid gap-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Ver mi pantalla</div>
        <Button variant="outline" onClick={onToggle} className="gap-2">
          {isShown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {isShown ? "Ocultar" : "Mostrar"}
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {!isShown ? (
          <motion.div key="hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm text-black/60">
            Pulsa “Mostrar”, mira tu rol y vuelve a “Ocultar” antes de pasar el móvil.
          </motion.div>
        ) : (
          <motion.div key="shown" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="grid gap-2">
            <div className="flex items-center gap-2">
              <Badge variant={isImpostor ? "destructive" : "default"}>{isImpostor ? "IMPOSTOR" : "TRIPULANTE"}</Badge>
              <div className="text-xs text-black/60">{playerName}</div>
            </div>

            <div className="rounded-2xl bg-black/5 p-4">
              {isImpostor ? (
                <div className="grid gap-2">
                  <div className="text-sm">No conoces la palabra. Encaja con las pistas.</div>
                  {showHint && impostorHintText ? <div className="text-sm font-medium">{impostorHintText}</div> : null}
                </div>
              ) : (
                <div className="grid gap-1">
                  <div className="text-xs text-black/60">La palabra es</div>
                  <div className="text-2xl font-semibold">{secretWord}</div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
