// ARCHITECTURE.md §6 — the concrete seeded RNG implementation. scm-dsl only
// declares the RNG interface (needed for Distribution.sample's signature);
// this is the actual PCG-family generator, kept out of scm-dsl to avoid a
// reverse dependency.
import type { RNG, RNGState } from 'scm-dsl';

interface Mulberry32State {
  state: number;
  spareNormal: number | null;
}

class Mulberry32RNG implements RNG {
  private state: number;
  private spareNormal: number | null = null;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  normal(): number {
    if (this.spareNormal !== null) {
      const value = this.spareNormal;
      this.spareNormal = null;
      return value;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const mag = Math.sqrt(-2 * Math.log(u));
    const z0 = mag * Math.cos(2 * Math.PI * v);
    const z1 = mag * Math.sin(2 * Math.PI * v);
    this.spareNormal = z1;
    return z0;
  }

  fork(streamId: string): RNG {
    return new Mulberry32RNG((this.state ^ fnv1a(streamId)) >>> 0);
  }

  snapshot(): RNGState {
    const snapshot: Mulberry32State = { state: this.state, spareNormal: this.spareNormal };
    return snapshot;
  }

  restore(s: RNGState): void {
    const snapshot = s as Mulberry32State;
    this.state = snapshot.state;
    this.spareNormal = snapshot.spareNormal;
  }
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createRNG(seed: number): RNG {
  return new Mulberry32RNG(seed);
}
