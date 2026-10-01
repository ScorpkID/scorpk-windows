//! Conversión del audio del micrófono (cualquier frecuencia, f32 mono) a 16 kHz enteros de 16 bits,
//! que es lo que espera el modelo de Vosk. Interpolación lineal que conserva el estado entre bloques.

pub const TARGET_RATE: u32 = 16_000;

pub struct Resampler {
    step: f64,
    pos: f64,
    prev: Option<f32>,
}

fn to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

impl Resampler {
    pub fn new(input_rate: u32) -> Self {
        Self { step: input_rate as f64 / TARGET_RATE as f64, pos: 0.0, prev: None }
    }

    pub fn reset(&mut self) {
        self.pos = 0.0;
        self.prev = None;
    }

    pub fn process(&mut self, input: &[f32], out: &mut Vec<i16>) {
        if input.is_empty() {
            return;
        }
        let mut src: Vec<f32> = Vec::with_capacity(input.len() + 1);
        if let Some(prev) = self.prev {
            src.push(prev);
        }
        src.extend_from_slice(input);

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
        assert!(out.iter().all(|&s| (s as i32 - 16383).abs() <= 1), "una señal constante se mantiene");
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
