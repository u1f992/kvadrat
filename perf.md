# Performance Analysis

## Environment

- Image: `test/input.png` (1390x900, 1466 colors, 5,004,000 edges)
- Runs: 10
- Runtime: Node.js v22.20.0

## Overall (median / mean)

| Phase      |   Median |     Mean |
| ---------- | -------: | -------: |
| buildEdges | 2,067 ms | 2,088 ms |
| workers    | 20,891ms | 23,134ms |
| **total**  | 23,431ms | 25,222ms |

## Top 10 Slowest Colors (median)

| Color       |   Edges | Polys | removeEdges | buildPolygons | concatPolygons | generateSVG |    Total |
| ----------- | ------: | ----: | ----------: | ------------: | -------------: | ----------: | -------: |
| `#ffffffff` | 2296584 |   990 |    4,888 ms |      4,202 ms |         290 ms |        2 ms | 9,501 ms |
| `#292929ff` |  970456 |   363 |    2,179 ms |      1,746 ms |         392 ms |        2 ms | 4,258 ms |
| `#e0e0e0ff` |   85544 |   387 |      494 ms |      2,337 ms |          58 ms |        1 ms | 3,005 ms |
| `#7a7a7aff` |   36192 |     5 |      441 ms |        726 ms |           0 ms |        0 ms | 1,416 ms |
| `#141414ff` |  230936 |   110 |      673 ms |        356 ms |          18 ms |        0 ms | 1,051 ms |
| `#0a0a0aff` |  240572 |    62 |      567 ms |        201 ms |          11 ms |        0 ms |   789 ms |
| `#666666ff` |   16956 |    29 |      248 ms |        341 ms |           1 ms |        0 ms |   618 ms |
| `#999999ff` |   39700 |    12 |      304 ms |        290 ms |           1 ms |        0 ms |   608 ms |
| `#424242ff` |    7404 |    11 |       38 ms |        267 ms |           0 ms |        0 ms |   389 ms |
| `#1f1f1fff` |   66936 |    17 |      300 ms |         90 ms |           3 ms |        0 ms |   379 ms |

## Bottleneck Analysis

### 1. `buildPolygons` — O(E²) linear scan + splice

- `worker.ts:48`: inner loop scans all remaining edges to find the next connected edge
- `edges.splice(i, 1)` shifts the array on every removal → O(E) per removal
- `#e0e0e0` has only 85k edges but takes 2,337 ms — confirms quadratic behavior
- **Fix**: build a `Map<startPoint, Edge[]>` for O(1) lookup

### 2. `removeBidirectionalEdges` — string key hashing

- Template literal `` `${x1},${y1},${x2},${y2}` `` generated per edge (4 × W × H times)
- `#ffffff` with 2.3M edges takes 4,888 ms here alone
- **Fix**: numeric key encoding `((x1 * H + y1) << 16) | (x2 * H + y2)` or similar

### 3. `buildEdges` (main thread) — ~2s / ~9% of total

- Creates 4 tuple objects per pixel, pushed into per-color arrays
- Structured clone cost when transferring to Workers
- **Fix**: use `Int32Array` flat buffer per color

### 4. Worker spawn overhead

- 1466 `new Worker()` calls per run
- **Fix**: worker pool sized to CPU core count

### 5. `concatPolygons` — O(P²V²) but currently tolerable

- 4-nested loop, but polygon counts are small enough (max ~990)
- Mean/median divergence suggests occasional spikes
- **Fix (deferred)**: point-to-polygon index Map

### 6. `generateSVGPathData` — negligible (<2 ms)

## Optimization Plan (Wasm migration aware)

### Before Wasm

| Priority | Task                              | Rationale                                                    |
| -------- | --------------------------------- | ------------------------------------------------------------ |
| 1        | Flatten edge data to `Int32Array` | Defines JS⇔Wasm boundary; reduces buildEdges + transfer cost |
| 2        | Worker pool                       | Architecture decision; affects Wasm module init strategy     |
| 3        | `buildPolygons` Map lookup        | Algorithm change — validate correctness in JS before porting |
| 3        | `concatPolygons` point index Map  | Same rationale                                               |

### After Wasm (or absorbed by Wasm implementation)

| Task                             | Rationale                                     |
| -------------------------------- | --------------------------------------------- |
| Numeric keys for edge dedup      | Language-specific; Wasm uses integer hashing  |
| Memory layout optimization       | Depends on Wasm linear memory design          |
| SVG path generation optimization | May stay in JS depending on boundary decision |
