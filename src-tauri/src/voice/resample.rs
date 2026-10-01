//! Conversión del audio del micrófono (cualquier frecuencia, f32 mono) a 16 kHz enteros de 16 bits,
//! que es lo que espera el modelo de Vosk. Interpolación lineal que conserva el estado entre bloques.
//!
//! Antes de bajar la frecuencia se aplica un filtro paso bajo (Butterworth de 4.º orden a 7 kHz):
//! sin él, todo lo que hay entre 8 y 24 kHz (ventiladores, siseo del micrófono del portátil) se
//! "pliega" dentro de la banda de voz como ruido falso (aliasing) y el reconocedor oye palabras inventadas.

pub const TARGET_RATE: u32 = 16_000;
const CUTOFF_HZ: f64 = 7_000.0;

/// Sección bicuadrática (RBJ) paso bajo, forma directa II transpuesta.
#[derive(Clone, Copy)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    fn low_pass(rate: f64, cutoff: f64, q: f64) -> Self {
        let w0 = 2.0 * std::f64::consts::PI * cutoff / rate;
        let alpha = w0.sin() / (2.0 * q);
        let cos = w0.cos();
        let a0 = 1.0 + alpha;
        Self {
            b0: ((1.0 - cos) / 2.0 / a0) as f32,
            b1: ((1.0 - cos) / a0) as f32,
            b2: ((1.0 - cos) / 2.0 / a0) as f32,
            a1: (-2.0 * cos / a0) as f32,
            a2: ((1.0 - alpha) / a0) as f32,
            z1: 0.0,
            z2: 0.0,
        }
    }

    fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

pub struct Resampler {
    step: f64,
    pos: f64,
    prev: Option<f32>,
    /// Dos secciones = Butterworth de 4.º orden. Vacío si el micrófono ya va a ≤ 17,6 kHz.
    filters: Vec<Biquad>,
}

fn to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

impl Resampler {
    pub fn new(input_rate: u32) -> Self {
        let rate = input_rate as f64;
        let filters = if rate > TARGET_RATE as f64 * 1.1 {
            // Factores Q de un Butterworth de 4.º orden repartido en dos secciones.
            vec![Biquad::low_pass(rate, CUTOFF_HZ, 0.541_196_1), Biquad::low_pass(rate, CUTOFF_HZ, 1.306_563)]
        } else {
            Vec::new()
        };
        Self { step: rate / TARGET_RATE as f64, pos: 0.0, prev: None, filters }
    }

    pub fn reset(&mut self) {
        self.pos = 0.0;
        self.prev = None;
        self.filters.iter_mut().for_each(Biquad::reset);
    }

    pub fn process(&mut self, input: &[f32], out: &mut Vec<i16>) {
        if input.is_empty() {
            return;
        }
        let mut src: Vec<f32> = Vec::with_capacity(input.len() + 1);
        if let Some(prev) = self.prev {
            src.push(prev);
        }
        let filters = &mut self.filters;
        src.extend(input.iter().map(|&x| filters.iter_mut().fold(x, |s, f| f.run(s))));

        let mut idx = self.pos;
        while idx + 1.0 < src.len() as f64 {
            let i = idx.floor() as usize;
            let frac = (idx - i as f64) as f32;
            out.push(to_i16(src[i] * (1.0 - frac) + src[i + 1] * frac));
            idx += self.step;
        }
        let last = src.len() - 1;
        self.prev = Some(src[last]);
        self.pos = idx - last as f64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn de_48k_a_16k_da_un_tercio_de_muestras() {
        let mut r = Resampler::new(48_000);
        let mut out = Vec::new();
        // Dos bloques: el estado se conserva entre ambos.
        r.process(&vec![0.5; 4800], &mut out);
        r.process(&vec![0.5; 4800], &mut out);
        assert!((out.len() as i64 - 3200).abs() <= 2, "salieron {}", out.len());
        // Tras el arranque del filtro, una señal constante se mantiene.
        assert!(out[200..].iter().all(|&s| (s as i32 - 16383).abs() <= 2), "una señal constante se mantiene");
    }

    fn rms(samples: &[i16]) -> f64 {
        (samples.iter().map(|&s| (s as f64).powi(2)).sum::<f64>() / samples.len() as f64).sqrt()
    }

    fn tone(freq: f64, rate: u32, seconds: f64) -> Vec<f32> {
        (0..(rate as f64 * seconds) as usize).map(|i| (0.5 * (2.0 * std::f64::consts::PI * freq * i as f64 / rate as f64).sin()) as f32).collect()
    }

    #[test]
    fn la_voz_pasa_y_el_ruido_agudo_no_se_pliega() {
        // 1 kHz (voz) pasa casi intacto.
        let mut out = Vec::new();
        Resampler::new(48_000).process(&tone(1_000.0, 48_000, 0.5), &mut out);
        let voice = rms(&out[800..]);
        // 15 kHz: sin filtro se plegaría a 1 kHz con la misma fuerza; con filtro queda muy atenuado.
        let mut out = Vec::new();
        Resampler::new(48_000).process(&tone(15_000.0, 48_000, 0.5), &mut out);
        let noise = rms(&out[800..]);
        assert!(voice > 10_000.0, "la voz se atenuó: {voice}");
        assert!(noise < voice / 15.0, "el agudo se coló: {noise} vs {voice}");
    }

    #[test]
    fn a_16k_es_casi_identico() {
        let mut r = Resampler::new(16_000);
        let mut out = Vec::new();
        r.process(&[0.0, 0.25, 0.5, 0.75, 1.0], &mut out);
        assert_eq!(out.len(), 4);
        assert_eq!(out[0], 0);
    }

    #[test]
    fn frecuencias_no_enteras_como_44100() {
        let mut r = Resampler::new(44_100);
        let mut out = Vec::new();
        r.process(&vec![0.1; 44_100], &mut out);
        assert!((out.len() as i64 - 16_000).abs() <= 2, "salieron {}", out.len());
    }
}
