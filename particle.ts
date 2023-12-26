import { Brick } from 'omegga';
import { Config } from 'omegga.plugin';

/**
 * A value that can be either a fixed number or a range of numbers.
 * When Particles see this value and it is a range (`[number, number]`),
 * they will choose a random number between those two numbers.
 *
 * ## Examples
 *
 * * if the value was `0.5`, then the output is always `0.5`.
 * * if the value was `[0, 1]`, then the output is a random number from 0 to 1, like `0.7`.
 */
export type Range = number | [number, number];

/**
 * A vector value that can be either a Range, or a vector of Ranges.
 * When Particles see this value as a `Range`, it computes the value like
 * it would a normal Range, but then sticks it into a vector for all three
 * components. When it sees a vector of Ranges, it computes the range
 * for each individual component.
 *
 * ## Examples
 *
 * * if the value was `[0, 1]`, a valid output might be `[0.7, 0.7, 0.7]`.
 * * if the value was `[[0, 1], [0, 1], [0, 1]]`, a valid output might be `[0.4, 0.1, 0.8]`.
 */
export type VecRange = Range | [Range, Range, Range];

/**
 * A definition of a particle. Can be used to make entire fireworks.
 * Use `Particle.fromDef` to create particles and add them to the system.
 */
export type ParticleDef = {
  /** The color of the particle. RGB by default (0-255), but treated like HSV (0-360) if `hsv` is true. */
  color: [Range, Range, Range];
  /** Whether or not to treat `color` as HSV instead of RGB. */
  hsv?: boolean;

  /** The size of the particle in micros. */
  size?: Range;

  /** The base velocity of the particle in units per second. */
  velocity: VecRange;
  /** Whether or not the base velocity will be multiplied by a random unit vector. */
  randomVelocity?: boolean;

  /** The lifespan of the particle in seconds. The particle is removed when it reaches its lifespan. */
  lifespan: Range;

  /** The gravity factor on the particle. By default, `1` means it uses default gravity. */
  gravity?: Range;

  /**
   * How much to spatially simulate the particle ahead before introducing it to the system.
   * Useful to simulate child particles ahead a bit instead of spawning them inside of their
   * parent particle immediately.
   */
  preSimulate?: number;

  /** The number of children this particle will generate when it dies. */
  numChildren?: Range;
  /** The types of children this particle can generate on death. */
  children?: ParticleDef[];
};

function computeRange(range: number | [number, number], integer?: boolean) {
  if (typeof range === 'number') return range;

  const result = Math.random() * (range[1] - range[0]) + range[0];
  if (integer) return Math.round(result);
  else return result;
}

function computeVecRange(range: VecRange): [number, number, number] {
  if (typeof range === 'number') return [range, range, range];
  if (range.length === 2) {
    const result = computeRange(range);
    return [result, result, result];
  }

  return range.map((c) => computeRange(c)) as [number, number, number];
}

function hsvToRgb(h: number, s: number, v: number) {
  let r: number, g: number, b: number;

  let i = Math.floor(h * 6);
  let f = h * 6 - i;
  let p = v * (1 - s);
  let q = v * (1 - f * s);
  let t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0:
      (r = v), (g = t), (b = p);
      break;
    case 1:
      (r = q), (g = v), (b = p);
      break;
    case 2:
      (r = p), (g = v), (b = t);
      break;
    case 3:
      (r = p), (g = q), (b = v);
      break;
    case 4:
      (r = t), (g = p), (b = v);
      break;
    case 5:
      (r = v), (g = p), (b = q);
      break;
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export class ParticleSystem {
  config: Config;
  root?: Particle;

  constructor(config: Config) {
    this.config = config;
  }

  addParticle = (particle: Particle) => {
    let last = particle;
    while (last.next) {
      last = last.next;
    }
    last.next = this.root;
    if (this.root) this.root.prev = last;
    this.root = particle;
  };

  simulate = (delta: number) => {
    let cur = this.root;
    while (cur) {
      const isAlive = cur.simulate(delta);

      if (!isAlive && cur === this.root) this.root = cur.next;
      cur = cur.next;
    }
  };
}

export default class Particle {
  static default_gravity: number = -9.8 * 15;

  prev?: Particle;
  next?: Particle;

  x: number;
  y: number;
  z: number;

  size: number = 1;

  r: number = 255;
  g: number = 255;
  b: number = 255;

  vx: number = 0;
  vy: number = 0;
  vz: number = 0;

  age: number = 0;
  lifespan: number = 0;
  gravity: number = Particle.default_gravity;

  deathCalled: boolean = false;

  onUpdate?: (this: Particle, delta: number, progress: number) => void;
  onDeath?: (this: Particle) => void;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  static fromDef(
    system: ParticleSystem,
    def: ParticleDef,
    x: number,
    y: number,
    z: number
  ) {
    const p = new Particle(x, y, z);

    if (def.hsv) {
      [p.r, p.g, p.b] = hsvToRgb(
        ...(def.color.map((c) => computeRange(c)) as [number, number, number])
      ).map(Math.round);
    } else {
      [p.r, p.g, p.b] = def.color.map((c) => computeRange(c, true));
    }

    [p.vx, p.vy, p.vz] = computeVecRange(def.velocity);
    if (def.randomVelocity) {
      const theta = Math.random() * 2 * Math.PI;
      const z = Math.random() * 2 - 1;
      const z2 = Math.sqrt(1 - z * z);
      const x = z2 * Math.cos(theta);
      const y = z2 * Math.sin(theta);

      p.vx *= x;
      p.vy *= y;
      p.vz *= z;
    }

    p.lifespan = computeRange(def.lifespan);
    if ('gravity' in def) p.gravity *= computeRange(def.gravity);
    if ('size' in def) p.size = computeRange(def.size, true);

    if (def.preSimulate) {
      p.simulateSpatial((system.config.update_rate / 1000) * def.preSimulate);
    }

    if (def.numChildren && def.children && def.children.length) {
      const n = computeRange(def.numChildren, true);
      if (n) {
        p.onDeath = function () {
          let first: Particle;
          let cur: Particle;

          for (let i = 0; i < n; i++) {
            const childDef =
              def.children.length === 1
                ? def.children[0]
                : def.children[Math.floor(Math.random() * def.children.length)];

            const child = Particle.fromDef(
              system,
              childDef,
              this.x,
              this.y,
              this.z
            );

            if (!first) {
              first = child;
              cur = child;
            } else {
              cur.next = child;
              child.prev = cur;
              cur = child;
            }
          }

          if (first) system.addParticle(first);
        };
      }
    }

    return p;
  }

  /** Simulates the particle's position and velocity ahead by delta */
  simulateSpatial = (delta: number) => {
    this.x += this.vx * delta;
    this.y += this.vy * delta;
    this.z += this.vz * delta;

    this.vz += this.gravity * delta;
  };

  /** Simulates the entire particle ahead by delta, handling death */
  simulate = (delta: number): boolean => {
    this.simulateSpatial(delta);

    this.age += delta;

    if (this.lifespan !== 0 && this.age >= this.lifespan) {
      if (this.prev) this.prev.next = this.next;
      if (this.next) this.next.prev = this.prev;
      if (!this.deathCalled) {
        this.deathCalled = true;
        this.onDeath?.bind(this)();
      }
      return false;
    }

    this.onUpdate?.bind(this)(delta, this.age / this.lifespan);
    return true;
  };

  /** Convert the particle's current state to a brick */
  brick = (): Brick => {
    return {
      position: [Math.round(this.x), Math.round(this.y), Math.round(this.z)],
      size: [this.size, this.size, this.size],
      asset_name_index: 0,
      owner_index: 1,
      color: [this.r, this.g, this.b, 255],
      collision: false,
    };
  };
}
