/** A PRNG whose whole state is one number: `createRng(rng.state())` continues the same sequence. */
export interface Rng {
  (): number;
  state(): number;
}

/** Deterministic PRNG (mulberry32). Returns values in [0, 1). */
export const createRng = (seed: number): Rng => {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(next, { state: () => state });
};

/** FNV-1a hash of a string, used to derive seeds from IDs. */
export const seedFromString = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const normal = (rng: () => number): number => {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Gamma(shape, 1) sample via Marsaglia–Tsang. */
export const sampleGamma = (rng: () => number, shape: number): number => {
  if (shape < 1) {
    return sampleGamma(rng, shape + 1) * Math.pow(rng(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
};

export const sampleBeta = (rng: () => number, alpha: number, beta: number): number => {
  const x = sampleGamma(rng, alpha);
  const y = sampleGamma(rng, beta);
  return x / (x + y);
};

/** Poisson sample (Knuth for small means, normal approximation for large ones). */
export const samplePoisson = (rng: () => number, mean: number): number => {
  if (mean <= 0) {
    return 0;
  }
  if (mean > 50) {
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal(rng)));
  }
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
};

export const sampleBinomial = (rng: () => number, trials: number, probability: number): number => {
  if (trials <= 0 || probability <= 0) {
    return 0;
  }
  if (trials > 200) {
    const mean = trials * probability;
    const sd = Math.sqrt(mean * (1 - probability));
    return Math.min(trials, Math.max(0, Math.round(mean + sd * normal(rng))));
  }
  let successes = 0;
  for (let i = 0; i < trials; i++) {
    if (rng() < probability) {
      successes++;
    }
  }
  return successes;
};
