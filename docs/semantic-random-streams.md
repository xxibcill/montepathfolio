# Semantic portfolio random streams

Version: `semantic-keyed-streams@1`

Portfolio simulations derive each random draw from an immutable semantic
address instead of consuming a mutable generator sequence. The address contains:

- the request seed;
- the comparison group;
- the simulation path index;
- the time-step index;
- the stream role; and
- an internal lane when a distribution needs more than one uniform draw.

Release 0 uses `portfolio-lab/request@1` as the comparison group, so every case
in one portfolio-lab request receives common diffusion shocks.

## Stream roles

| Role | Distribution | Purpose |
| --- | --- | --- |
| `diffusion/stocks` | Standard normal | Stock diffusion shock |
| `diffusion/bonds-independent` | Standard normal | Independent component of the correlated bond shock |
| `regime/initial` | Uniform on `(0, 1)` | Initial HMM regime |
| `regime/transition` | Uniform on `(0, 1)` | Per-step HMM transition |

The normal streams use Box–Muller with two separately addressed uniform lanes.
Uniforms are derived from deterministic 32-bit hashes and never equal zero or
one.

## Invariants

- Repeating an address returns the same value.
- Call order and unrelated draws cannot shift an existing value.
- Increasing path count or horizon preserves existing path and time prefixes.
- GBM and HMM cases in the same comparison group share diffusion shocks.
- Regime draws cannot alter diffusion streams.

Changing any version-one golden draw requires a new random-stream version and
updated provenance. The golden fixtures live in
`src/lib/portfolio-lab/semantic-random.test.ts`.
