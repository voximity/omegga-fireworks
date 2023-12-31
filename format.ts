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
  velocity?: VecRange;
  /** Whether or not the base velocity will be multiplied by a random unit vector. */
  randomVelocity?: boolean;
  /** Whether or not to inherit velocity from the parent. */
  inheritVelocity?: boolean;

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

  /** The types of children this particle can generate on death. */
  children?: ParticleChild[];
};

export type ParticleDefRef = ParticleDef | string;

export type ParticleChild = {
  /** Either a single particle, or a list of particles to choose from. */
  def: ParticleDefRef | ParticleDefRef[];

  /** The number of child particles to spawn. When absent, only spawns one particle. */
  count?: Range;
};

export function computeRange(
  range: number | [number, number],
  integer?: boolean
) {
  if (typeof range === 'number') return range;

  const result = Math.random() * (range[1] - range[0]) + range[0];
  if (integer) return Math.round(result);
  else return result;
}

export function computeVecRange(range: VecRange): [number, number, number] {
  if (typeof range === 'number') return [range, range, range];
  if (range.length === 2) {
    const result = computeRange(range);
    return [result, result, result];
  }

  return range.map((c) => computeRange(c)) as [number, number, number];
}

export type CategoryDef = {
  /** how often this category of emitters will fire, in seconds */
  interval: Range;

  /** the types of particles that can start at this category */
  defs: string[];
};

export type ShowDef = {
  /** The emitter categories for the show. All emitters have `all` applied, and emitters that do not fit into any other category have `other` applied. */
  categories: {
    all?: Partial<CategoryDef>;
    other: Partial<CategoryDef>;
  } & Record<string, CategoryDef>;

  /** How long the show will last. */
  length: number;
};

export type ParticleFile = {
  defs: Record<string, ParticleDef>;
  shows: Record<string, ShowDef>;
};
