//! Detección flexible de "Oye Scorpk". Port de WakeWordMatcher.kt (Android): compara cada palabra
//! transcrita (y cada par de palabras unidas, p. ej. "es corp") contra una lista de alias con
//! similitud de Levenshtein o coincidencia de prefijo. El modelo de Vosk no conoce "Scorpk", así
//! que suele transcribir cosas como "escorpión" o "es corp": por eso los alias.

pub const ALIASES: &[&str] = &[
    "scorpk", "scorp", "skorp", "escorp", "escor", "score", "escorpion", "escorpio", "scor", "scort", "skor",
];

pub const THRESHOLD: f64 = 0.75;
const MIN_TOKEN_LENGTH: usize = 3;
const MIN_PREFIX_LENGTH: usize = 4;

#[derive(Debug, PartialEq)]
pub struct Match {
    /// Texto normalizado que sigue al wake-word (posible orden encadenada).
    pub remainder: String,
}

/// Minúsculas, sin tildes, solo letras/números y espacios simples.
pub fn normalize(text: &str) -> String {
    let mapped: String = text
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            c if c.is_ascii_alphanumeric() => c,
            _ => ' ',
        })
        .collect();
    mapped.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current = vec![0; b.len() + 1];
    for i in 1..=a.len() {
        current[0] = i;
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            current[j] = (current[j - 1] + 1).min(previous[j] + 1).min(previous[j - 1] + cost);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[b.len()]
}

fn similarity(a: &str, b: &str) -> f64 {
    let longest = a.chars().count().max(b.chars().count());
    if longest == 0 {
        return 1.0;
    }
    1.0 - levenshtein(a, b) as f64 / longest as f64
}

fn score(token: &str, alias: &str) -> f64 {
    if token == alias {
        return 1.0;
    }
    let prefix = (alias.len() >= MIN_PREFIX_LENGTH && token.starts_with(alias))
        || (token.len() >= MIN_PREFIX_LENGTH && alias.starts_with(token));
    if prefix {
        1.0
    } else {
        similarity(token, alias)
    }
}

fn best_alias(token: &str) -> Option<f64> {
    if token.chars().count() < MIN_TOKEN_LENGTH {
        return None;
    }
    ALIASES.iter().map(|alias| score(token, alias)).fold(None, |best, s| Some(best.map_or(s, |b: f64| b.max(s))))
}

pub fn find(text: &str) -> Option<Match> {
    let normalized = normalize(text);
    let tokens: Vec<&str> = normalized.split(' ').filter(|t| !t.is_empty()).collect();
    for i in 0..tokens.len() {
        let single = best_alias(tokens[i]).map(|s| (s, i + 1));
        let joined = tokens.get(i + 1).and_then(|next| best_alias(&format!("{}{}", tokens[i], next))).map(|s| (s, i + 2));
        let best = [single, joined].into_iter().flatten().fold(None, |best: Option<(f64, usize)>, c| match best {
            Some(b) if b.0 >= c.0 => Some(b),
            _ => Some(c),
        });
        if let Some((s, consumed)) = best {
            if s >= THRESHOLD {
                return Some(Match { remainder: tokens[consumed..].join(" ") });
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detecta_variantes_de_scorpk() {
        assert!(find("oye scorpk").is_some());
        assert!(find("hey escorpion").is_some());
        assert!(find("oye es corp").is_some(), "dos palabras unidas");
        assert!(find("Oye, Escorpio!").is_some());
        assert!(find("skorp").is_some());
    }

    #[test]
    fn devuelve_la_orden_encadenada() {
        let m = find("oye scorpk abre la calculadora").unwrap();
        assert_eq!(m.remainder, "abre la calculadora");
        assert_eq!(find("oye scorpk").unwrap().remainder, "");
    }

    #[test]
    fn no_se_activa_con_otras_frases() {
        assert!(find("abre la calculadora").is_none());
        assert!(find("hola que tal").is_none());
        assert!(find("").is_none());
        assert!(find("oye").is_none());
    }

    #[test]
    fn normaliza_tildes_y_signos() {
        assert_eq!(normalize("¡Oye, Escorpión!"), "oye escorpion");
    }
}
