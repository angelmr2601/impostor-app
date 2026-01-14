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
import { Users, Vote, RotateCcw, Loader2 } from "lucide-react";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function uniqueCaseInsensitive(list: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of list) {
    const key = s.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.trim());
  }
  return out;
}

const PHASES = {
  SETUP: "setup",
  REVEAL: "reveal",
  VOTE: "vote",
  RESULT: "result",
} as const;

type Phase = (typeof PHASES)[keyof typeof PHASES];

type Secret = {
  category: string;
  word: string;
  hints: string[];
};

const WORD_BANK: Record<string, { w: string; hints: string[] }[]> = {
  Lugares: [
    { w: "playa", hints: ["arena", "mar", "sombrilla"] },
    { w: "aeropuerto", hints: ["maletas", "vuelos", "terminal"] },
    { w: "biblioteca", hints: ["silencio", "libros", "préstamo"] },
    { w: "hospital", hints: ["urgencias", "médicos", "pacientes"] },
    { w: "museo", hints: ["arte", "exposiciones", "entradas"] },
  ],
  Comida: [
    { w: "pizza", hints: ["queso", "horno", "porciones"] },
    { w: "sushi", hints: ["arroz", "palillos", "pescado"] },
    { w: "paella", hints: ["arroz", "marisco", "sartén"] },
    { w: "tacos", hints: ["tortilla", "salsa", "relleno"] },
  ],
  Animales: [
    { w: "delfín", hints: ["mar", "saltos", "inteligente"] },
    { w: "jirafa", hints: ["cuello", "manchas", "sabana"] },
    { w: "pingüino", hints: ["hielo", "frío", "caminar"] },
    { w: "lobo", hints: ["aullido", "manada", "bosque"] },
  ],
  Objetos: [
    { w: "teléfono", hints: ["apps", "pantalla", "llamadas"] },
    { w: "paraguas", hints: ["lluvia", "abrir", "mojarse"] },
    { w: "llave", hints: ["cerradura", "metal", "abrir"] },
    { w: "gafas", hints: ["lentes", "vista", "montura"] },
  ],
  Ocio: [
    { w: "cine", hints: ["palomitas", "pantalla", "butacas"] },
    { w: "concierto", hints: ["música", "escenario", "entradas"] },
    { w: "fútbol", hints: ["balón", "gol", "equipo"] },
    { w: "camping", hints: ["tienda", "bosque", "fuego"] },
  ],
};

function pickRandom<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function chooseSecretFromLocal(selectedCategoryList: string[], usedWords: string[]): Secret {
  const used = new Set((usedWords || []).map((w) => String(w).toLowerCase()));
  const categories = selectedCategoryList.filter((c) => WORD_BANK[c]); // solo categorías locales
  const all: Secret[] = categories.flatMap((c) =>
    WORD_BANK[c].map((it) => ({ category: c, word: it.w, hints: it.hints || [] }))
  );
  const notUsed = all.filter((x) => !used.has(String(x.word).toLowerCase()));
  return pickRandom(notUsed.length ? notUsed : all);
}

function buildImpostorHintOnce(secret: Secret, hintStyle: string) {
  if (!secret) return "";
  if (hintStyle === "category") return `Categoría: ${secret.category}`;
  if (hintStyle === "first_letter")
    return `Empieza por: ${String(secret.word).slice(0, 1).toUpperCase()}`;
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

function loadDynamicCategories(): string[] {
  try {
    const raw = localStorage.getItem("dynamicCategories");
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return uniqueCaseInsensitive(parsed.map((x) => String(x)));
  } catch {
    return [];
  }
}

function saveDynamicCategories(list: string[]) {
  try {
    localStorage.setItem("dynamicCategories", JSON.stringify(uniqueCaseInsensitive(list)));
  } catch {
    // ignore
  }
}

function normalizeCategoryInput(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function isValidCategoryName(s: string) {
  const name = normalizeCategoryInput(s);
  if (name.length < 3 || name.length > 40) return false;
  // permitimos letras, números, espacios y algunos signos comunes
  return /^[\p{L}\p{N} áéíóúüñÁÉÍÓÚÜÑ'’\-]+$/u.test(name);
}

export default function ImpostorPalabraMobile() {
  const [phase, setPhase] = useState<Phase>(PHASES.SETUP);

  // Setup
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([{ id: uid(), name: "" }]);
  const [impostorCount, setImpostorCount] = useState(1);

  // Categorías dinámicas (persistentes)
  const [dynamicCategories, setDynamicCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState("");

  // Cargamos dinámicas desde localStorage al montar
  useEffect(() => {
    setDynamicCategories(loadDynamicCategories());
  }, []);

  // Guardamos dinámicas si cambian
  useEffect(() => {
    saveDynamicCategories(dynamicCategories);
  }, [dynamicCategories]);

  const baseCategoryNames = useMemo(() => Object.keys(WORD_BANK), []);

  const categoryNames = useMemo(() => {
    return uniqueCaseInsensitive([...baseCategoryNames, ...dynamicCategories]);
  }, [baseCategoryNames, dynamicCategories]);

  const [selectedCategories, setSelectedCategories] = useState<Record<string, boolean>>(() => {
    // solo base al inicio; dinámicas se inyectan luego con useEffect
    const init: Record<string, boolean> = {};
    for (const c of Object.keys(WORD_BANK)) init[c] = true;
    return init;
  });

  // Asegurar que cada categoría dinámica tenga estado seleccionable (por defecto true)
  useEffect(() => {
    setSelectedCategories((prev) => {
      const next = { ...prev };
      for (const c of dynamicCategories) {
        if (next[c] === undefined) next[c] = true;
      }
      return next;
    });
  }, [dynamicCategories]);

  // Hint
  const [giveImpostorHint, setGiveImpostorHint] = useState(true);
  const [hintStyle, setHintStyle] = useState("random_hint"); // random_hint | category | first_letter
  const [impostorHintText, setImpostorHintText] = useState("");

  // Game
  const [secret, setSecret] = useState<Secret | null>(null);
  const [impostorIds, setImpostorIds] = useState<string[]>([]);

  // Reveal
  const [revealIndex, setRevealIndex] = useState(0);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [revealShown, setRevealShown] = useState(false); // “destapando/viendo”
  const [pendingNav, setPendingNav] = useState(0); // -1 | +1

  // Vote
  const [mostVotedId, setMostVotedId] = useState<string | null>(null);
  const [resultHit, setResultHit] = useState<boolean | null>(null);

  // UX
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const selectedCategoryList = useMemo(
    () => categoryNames.filter((c) => selectedCategories[c]),
    [categoryNames, selectedCategories]
  );

  // Selector impostores: depende de inputs, no de nombres rellenados
  const playersCount = players.length;
  const maxImpostors = Math.max(1, playersCount - 1);

  useEffect(() => {
    setImpostorCount((n) => clamp(n, 1, Math.max(1, players.length - 1)));
  }, [players.length]);

  const validPlayers = useMemo(
    () => players.map((p) => ({ ...p, name: p.name.trim() })).filter((p) => p.name.length > 0),
    [players]
  );

  // Al menos 1 categoría seleccionada
  const hasAnyCategory = selectedCategoryList.length >= 1;

  const canStart =
    validPlayers.length >= 3 &&
    impostorCount >= 1 &&
    impostorCount < validPlayers.length &&
    hasAnyCategory &&
    !starting;

  // Cambiar de jugador => tapado
  useEffect(() => {
    setRevealShown(false);
  }, [revealIndex]);

  // Navegación 1 toque: si se está destapando, ocultamos y luego navegamos
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

  async function fetchSecretFromApi(categories: string[], usedWords: string[]): Promise<Secret> {
    const r = await fetch("/api/word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories, difficulty: "easy", usedWords }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(txt || `HTTP ${r.status}`);
    }
    return (await r.json()) as Secret;
  }

  async function startGame() {
    setStarting(true);
    setStartError("");

    // Roles: aleatorio (primeros N impostores tras barajar)
    const shuffled = [...validPlayers].sort(() => Math.random() - 0.5);
    const impostors = shuffled.slice(0, impostorCount).map((p) => p.id);

    // Palabra (API -> fallback local)
    const usedWords = typeof window !== "undefined" ? (getUsedWords() as string[]) : [];

    // Categorías locales seleccionadas (las que tienen pool)
    const selectedLocalCategories = selectedCategoryList.filter((c) => !!WORD_BANK[c]);

    let picked: Secret | null = null;

    try {
      picked = await fetchSecretFromApi(selectedCategoryList, usedWords);
    } catch {
      // Fallback local SOLO si hay categorías locales seleccionadas
      if (selectedLocalCategories.length === 0) {
        setStarting(false);
        setStartError(
          "La IA falló y no hay pool local para las categorías seleccionadas (solo temporales).\nSelecciona alguna categoría local (ej: Lugares/Comida) o revisa la API key."
        );
        return;
      }
      picked = chooseSecretFromLocal(selectedLocalCategories, usedWords);
      setStartError("No se pudo usar IA (usando pool local). Revisa /api/word y la API key.");
    }

    // Pista estable para TODOS los impostores
    const hint = giveImpostorHint ? buildImpostorHintOnce(picked!, hintStyle) : "";

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
            <motion.div
              key="setup"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Configurar</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {/* Jugadores */}
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

                    <div className="text-xs text-black/60">Mínimo 3 jugadores (con nombre).</div>
                  </div>

                  <Separator />

                  {/* Añadir categoría temporal */}
                  <div className="grid gap-2">
                    <Label>Añadir categoría temporal</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder='Ej: "estadios de fútbol"'
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        onClick={() => {
                          const name = normalizeCategoryInput(newCategory);
                          if (!isValidCategoryName(name)) {
                            setStartError(
                              "Nombre de categoría inválido.\nUsa 3–40 caracteres (letras/números/espacios) como: 'estadios de fútbol'."
                            );
                            return;
                          }
                          setDynamicCategories((list) => uniqueCaseInsensitive([...list, name]));
                          // por defecto seleccionada
                          setSelectedCategories((s) => ({ ...s, [name]: true }));
                          setNewCategory("");
                        }}
                      >
                        Añadir
                      </Button>
                    </div>
                    <div className="text-xs text-black/60">
                      Se guarda en este dispositivo. Puedes borrarla cuando quieras.
                    </div>

                    {dynamicCategories.length > 0 && (
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-black/60">Temporales guardadas: {dynamicCategories.length}</div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setDynamicCategories([]);
                            setSelectedCategories((s) => {
                              const next = { ...s };
                              for (const c of dynamicCategories) delete next[c];
                              return next;
                            });
                          }}
                        >
                          Limpiar temporales
                        </Button>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Categorías */}
                  <div className="grid gap-2">
                    <Label>Categorías</Label>

                    <div className="flex flex-wrap gap-2">
                      {categoryNames.map((c) => {
                        const on = !!selectedCategories[c];
                        const isDynamic = dynamicCategories.some((d) => d.toLowerCase() === c.toLowerCase());

                        return (
                          <button
                            key={c}
                            className={[
                              "inline-flex items-center gap-2 rounded-2xl px-3 h-10 text-sm border transition-colors",
                              on ? "bg-black text-white border-black" : "bg-white text-black border-black/20 hover:bg-black/5",
                            ].join(" ")}
                            onClick={() => setSelectedCategories((s) => ({ ...s, [c]: !s[c] }))}
                            type="button"
                          >
                            <span>{c}</span>
                            {isDynamic && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/15 border border-white/20">
                                TEMP
                              </span>
                            )}
                            {isDynamic && (
                              <span
                                className="ml-1 text-xs opacity-80 hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDynamicCategories((d) => d.filter((x) => x.toLowerCase() !== c.toLowerCase()));
                                  setSelectedCategories((s) => {
                                    const next = { ...s };
                                    delete next[c];
                                    return next;
                                  });
                                }}
                                title="Eliminar categoría"
                              >
                                ✕
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {selectedCategoryList.length === 0 && <div className="text-xs text-black/60">Selecciona al menos 1.</div>}
                  </div>

                  <Separator />

                  {/* Impostores */}
                  <div className="grid gap-2">
                    <Label>Impostores</Label>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" onClick={() => setImpostorCount((n) => clamp(n - 1, 1, maxImpostors))}>
                        -
                      </Button>
                      <div className="min-w-10 text-center font-semibold text-lg">{impostorCount}</div>
                      <Button variant="outline" onClick={() => setImpostorCount((n) => clamp(n + 1, 1, maxImpostors))}>
                        +
                      </Button>
                    </div>
                    <div className="text-xs text-black/60">Máximo ahora: {maxImpostors} (según nº de inputs).</div>
                  </div>

                  <Separator />

                  {/* Pista */}
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
                        <Button
                          variant={hintStyle === "first_letter" ? "default" : "outline"}
                          onClick={() => setHintStyle("first_letter")}
                        >
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
            <motion.div
              key="reveal"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
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
                    if (!p || !secret) return null;

                    const isImp = impostorIds.includes(p.id);
                    const hint = giveImpostorHint ? impostorHintText : "";

                    return (
                      <div className="relative">
                        {/* Privacy shield */}
                        {revealShown && (
                          <div className="fixed inset-0 z-40 pointer-events-none">
                            <div className="absolute inset-0 bg-black/70" />
                          </div>
                        )}

                        <div className="relative z-50">
                          <RevealPanel
                            key={p.id}
                            playerName={p.name}
                            isImpostor={isImp}
                            secretWord={secret.word}
                            impostorHintText={hint}
                            showHint={giveImpostorHint}
                            shown={revealShown}
                            onShow={() => {
                              markRevealed(p.id);
                              setRevealShown(true);
                            }}
                            onHide={() => setRevealShown(false)}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => nextReveal(-1)} disabled={revealIndex === 0}>
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => nextReveal(1)}
                      disabled={revealIndex === validPlayers.length - 1}
                    >
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
            <motion.div
              key="vote"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
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
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Resultado</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="rounded-2xl border border-black/10 p-4">
                    <div className="text-xs text-black/60">Más votado</div>
                    <div className="text-xl font-semibold">
                      {validPlayers.find((p) => p.id === mostVotedId)?.name || ""}
                    </div>
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

/**
 * RevealPanel “destapar tarjeta”
 * - Rol/palabra debajo
 * - Cortina tapa arriba con overflow-hidden (sin solapes)
 * - Al deslizar hacia arriba: se destapa progresivo
 * - Al soltar: se tapa
 */
function RevealPanel({
  playerName,
  isImpostor,
  secretWord,
  impostorHintText,
  showHint,
  shown,
  onShow,
  onHide,
}: {
  playerName: string;
  isImpostor: boolean;
  secretWord: string;
  impostorHintText: string;
  showHint: boolean;
  shown: boolean;
  onShow: () => void;
  onHide: () => void;
}) {
  const COVER_MAX_PX = 220;
  const START_SHOW_PX = 6;
  const HAPTIC_TRIGGER_PX = 45;

  const [holding, setHolding] = useState(false);
  const [startY, setStartY] = useState<number | null>(null);
  const [dy, setDy] = useState(0);
  const [vibrated, setVibrated] = useState(false);

  function tryVibrate() {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      // @ts-ignore
      navigator.vibrate(12);
    }
  }

  function resetGesture() {
    setHolding(false);
    setStartY(null);
    setDy(0);
    setVibrated(false);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setHolding(true);
    setStartY(e.clientY);
    setDy(0);
    setVibrated(false);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!holding || startY === null) return;

    const raw = startY - e.clientY; // arriba => positivo
    const nextDy = clamp(raw, 0, COVER_MAX_PX);
    setDy(nextDy);

    if (nextDy >= START_SHOW_PX && !shown) onShow();
    if (nextDy < START_SHOW_PX && shown) onHide();

    if (nextDy >= HAPTIC_TRIGGER_PX && !vibrated) {
      tryVibrate();
      setVibrated(true);
    }
    if (nextDy < HAPTIC_TRIGGER_PX) setVibrated(false);
  }

  function handlePointerUp() {
    onHide();
    resetGesture();
  }

  function handlePointerCancel() {
    onHide();
    resetGesture();
  }

  const coverHeight = Math.max(0, COVER_MAX_PX - dy);
  const progress = Math.min(1, dy / COVER_MAX_PX);

  return (
    <div
      className="rounded-2xl border border-black/10 p-4 grid gap-3 select-none touch-none bg-white"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div className="flex items-center justify-between">
        <div className="font-semibold">Desliza para destapar</div>
        <Badge variant="secondary">{shown ? "DESTAPANDO" : "TAPADO"}</Badge>
      </div>

      <div className="text-xs text-black/60">Mantén el dedo y desliza hacia arriba. Al soltar, se oculta.</div>

      <div className="relative rounded-2xl border border-black/10 overflow-hidden bg-white">
        {/* Contenido real debajo */}
        <div className="relative z-10 p-4 grid gap-2">
          <div className="flex items-center gap-2">
            <Badge variant={isImpostor ? "destructive" : "default"}>{isImpostor ? "IMPOSTOR" : "TRIPULANTE"}</Badge>
            <div className="text-xs text-black/60">{playerName}</div>
          </div>

          <div className="rounded-2xl bg-black/5 p-4">
            {isImpostor ? (
              <div className="grid gap-2">
                <div className="text-sm">No conoces la palabra.</div>
                {showHint && impostorHintText ? <div className="text-sm font-medium">{impostorHintText}</div> : null}
              </div>
            ) : (
              <div className="grid gap-1">
                <div className="text-xs text-black/60">La palabra es</div>
                <div className="text-2xl font-semibold">{secretWord}</div>
              </div>
            )}
          </div>
        </div>

        {/* Cortina tapa (overflow-hidden para que NO se solapen textos) */}
        <div
          className="absolute inset-x-0 top-0 bg-white overflow-hidden z-20"
          style={{
            height: `${coverHeight}px`,
            transition: holding ? "none" : "height 120ms ease-out",
          }}
        >
          {/* Solo mostramos texto si hay altura suficiente */}
          {coverHeight > 72 && (
            <div className="p-4">
              <div className="text-sm font-semibold">Tarjeta tapada</div>
              <div className="text-xs text-black/60 mt-1">Desliza hacia arriba para revelar</div>

              <div className="mt-3 h-2 rounded-full bg-black/10 overflow-hidden">
                <div className="h-full bg-black/40" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>

              <div className="mt-3 text-xs text-black/50">Progreso: {Math.round(progress * 100)}%</div>
            </div>
          )}

          {/* Asa */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-14 h-1.5 rounded-full bg-black/20" />
        </div>
      </div>
    </div>
  );
}
