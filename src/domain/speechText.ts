/**
 * Prepara un texto para leerlo en voz alta: sin Markdown, sin bloques de código ni URLs
 * (leer "https dos puntos barra barra..." es ruido). Igual que SpeechOutput en Android.
 */
const MAX_SPOKEN_CHARS = 1200;
/** Cada trozo que se envía a la síntesis: evita que el motor corte lecturas largas. */
const CHUNK_CHARS = 220;

export function toSpeakable(text: string): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ") // bloques de código
    .replace(/`([^`]*)`/g, "$1") // código en línea
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // imágenes
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [texto](url) → texto
    .replace(/https?:\/\/\S+/g, " ") // URLs sueltas
    .replace(/^\s{0,3}#{1,6}\s*/gm, "") // encabezados
    .replace(/^\s*>\s?/gm, "") // citas
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "") // viñetas y listas numeradas
    .replace(/[*_~|]+/g, "") // énfasis y tablas
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= MAX_SPOKEN_CHARS) return cleaned;
  // Corta en el último fin de frase antes del límite para no dejar una oración a medias.
  const head = cleaned.slice(0, MAX_SPOKEN_CHARS);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  return (end > 80 ? head.slice(0, end + 1) : head).trim();
}

/** Parte el texto en trozos de frases (≤ CHUNK_CHARS) sin cortar palabras. */
export function splitForSpeech(text: string, limit = CHUNK_CHARS): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const sentence of sentences) {
    if (sentence.length > limit) {
      flush();
      // Frase larguísima: se parte por palabras.
      for (const word of sentence.split(/\s+/)) {
        if ((current + " " + word).trim().length > limit) flush();
        current = (current + " " + word).trim();
      }
      flush();
    } else if ((current + sentence).length > limit) {
      flush();
      current = sentence;
    } else {
      current += sentence;
    }
  }
  flush();
  return chunks;
}

/** Prefiere voces en español y, entre ellas, las "naturales"/en línea de Windows. */
export function pickSpanishVoice(voices: { name: string; lang: string }[]): number {
  const score = (v: { name: string; lang: string }) => {
    const lang = v.lang.toLowerCase().replace("_", "-");
    if (!lang.startsWith("es")) return -1;
    let points = 1;
    if (lang === "es-es" || lang === "es-mx" || lang === "es-co") points += 1;
    if (/natural|online/i.test(v.name)) points += 3;
    return points;
  };
  let best = -1;
  let bestScore = -1;
  voices.forEach((voice, index) => {
    const s = score(voice);
    if (s > bestScore) {
      best = index;
      bestScore = s;
    }
  });
  return bestScore > 0 ? best : -1;
}

/** Lee el texto con la voz del sistema. `onEnd` se llama al terminar (o de inmediato si no hay nada que leer). */
export function speak(text: string, onEnd?: () => void): void {
  const spoken = toSpeakable(text);
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !spoken) {
    onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const voices = synth.getVoices();
  const index = pickSpanishVoice(voices);
  const chunks = splitForSpeech(spoken);
  chunks.forEach((chunk, i) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    if (index >= 0) utterance.voice = voices[index];
    utterance.lang = index >= 0 ? voices[index].lang : "es-ES";
    // Solo el último trozo reanuda la escucha. (cancel() dispara onerror, no onend, en los demás.)
    if (i === chunks.length - 1) utterance.onend = () => onEnd?.();
    synth.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
