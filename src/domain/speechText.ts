/**
 * Prepara un texto para leerlo en voz alta: sin Markdown, sin bloques de código ni URLs
 * (leer "https dos puntos barra barra..." es ruido). Igual que SpeechOutput en Android.
 */
const MAX_SPOKEN_CHARS = 400;

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
  const utterance = new SpeechSynthesisUtterance(spoken);
  const voices = synth.getVoices();
  const index = pickSpanishVoice(voices);
  if (index >= 0) utterance.voice = voices[index];
  utterance.lang = index >= 0 ? voices[index].lang : "es-ES";
  // onerror también ocurre al cancelar una lectura para empezar otra: solo onend reanuda la escucha.
  utterance.onend = () => onEnd?.();
  synth.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
