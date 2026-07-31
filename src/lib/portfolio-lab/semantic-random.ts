export const PORTFOLIO_RANDOM_STREAM_VERSION = "semantic-keyed-streams@1";
export const PORTFOLIO_COMPARISON_GROUP = "portfolio-lab/request@1";

export type DiffusionStream =
  | "diffusion/stocks"
  | "diffusion/bonds-independent";
export type RegimeStream = "regime/initial" | "regime/transition";

export interface SemanticRandomAddress {
  readonly seed: number;
  readonly comparisonGroup: string;
  readonly pathIndex: number;
  readonly stepIndex: number;
}

export interface PortfolioRandomSource {
  normalAt(
    pathIndex: number,
    stepIndex: number,
    stream: DiffusionStream,
  ): number;
  uniformAt(
    pathIndex: number,
    stepIndex: number,
    stream: RegimeStream,
  ): number;
}

const UINT32_RANGE = 4_294_967_296;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function createPortfolioRandomSource(
  seed: number,
  comparisonGroup = PORTFOLIO_COMPARISON_GROUP,
): PortfolioRandomSource {
  const groupRoot = mixString(FNV_OFFSET_BASIS, comparisonGroup);
  const seedRoot = mixInteger(groupRoot, seed);
  const streamRoots = {
    "diffusion/stocks": mixString(seedRoot, "diffusion/stocks"),
    "diffusion/bonds-independent": mixString(
      seedRoot,
      "diffusion/bonds-independent",
    ),
    "regime/initial": mixString(seedRoot, "regime/initial"),
    "regime/transition": mixString(seedRoot, "regime/transition"),
  } as const;

  return {
    normalAt(pathIndex, stepIndex, stream) {
      const firstUniform = uniformFromHash(
        addressHash(streamRoots[stream], pathIndex, stepIndex, 0),
      );
      const secondUniform = uniformFromHash(
        addressHash(streamRoots[stream], pathIndex, stepIndex, 1),
      );
      const magnitude = Math.sqrt(-2 * Math.log(firstUniform));

      return magnitude * Math.cos(2 * Math.PI * secondUniform);
    },
    uniformAt(pathIndex, stepIndex, stream) {
      return uniformFromHash(
        addressHash(streamRoots[stream], pathIndex, stepIndex, 0),
      );
    },
  };
}

export function semanticNormalAt(
  address: SemanticRandomAddress,
  stream: DiffusionStream,
): number {
  return createPortfolioRandomSource(
    address.seed,
    address.comparisonGroup,
  ).normalAt(address.pathIndex, address.stepIndex, stream);
}

export function semanticUniformAt(
  address: SemanticRandomAddress,
  stream: RegimeStream,
): number {
  return createPortfolioRandomSource(
    address.seed,
    address.comparisonGroup,
  ).uniformAt(address.pathIndex, address.stepIndex, stream);
}

function addressHash(
  streamRoot: number,
  pathIndex: number,
  stepIndex: number,
  lane: number,
): number {
  const pathRoot = mixInteger(streamRoot, pathIndex);
  const stepRoot = mixInteger(pathRoot, stepIndex);
  return finalizeHash(mixInteger(stepRoot, lane));
}

function mixString(hash: number, value: string): number {
  let mixed = hash;
  for (let index = 0; index < value.length; index += 1) {
    mixed ^= value.charCodeAt(index);
    mixed = Math.imul(mixed, FNV_PRIME);
  }

  return mixed >>> 0;
}

function mixInteger(hash: number, value: number): number {
  const integer = Math.trunc(value);
  const lowWord = integer >>> 0;
  const highWord = Math.floor(integer / UINT32_RANGE) >>> 0;

  return mixWord(mixWord(hash, lowWord), highWord);
}

function mixWord(hash: number, word: number): number {
  let mixed = Math.imul(hash ^ word, 0x85ebca6b);
  mixed ^= mixed >>> 13;
  return mixed >>> 0;
}

function finalizeHash(hash: number): number {
  let mixed = hash;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function uniformFromHash(hash: number): number {
  return (hash + 0.5) / UINT32_RANGE;
}
