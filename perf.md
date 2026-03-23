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

## Step 1: buildPolygons Map化

線形探索+splice を Map隣接リスト+usedフラグに置換。O(E²)→O(E)。

### Overall (median / mean)

| Phase      |   Median |     Mean | vs Baseline |
| ---------- | -------: | -------: | ----------: |
| buildEdges | 2,225 ms | 2,090 ms |        +8 % |
| workers    | 20,746ms | 23,430ms |        -1 % |
| **total**  | 22,419ms | 25,520ms |     **-4%** |

### Top 5 Slowest Colors (median)

| Color       |   Edges | Polys | removeEdges | buildPolygons | concatPolygons |    Total |
| ----------- | ------: | ----: | ----------: | ------------: | -------------: | -------: |
| `#ffffffff` | 2296584 |   990 |    4,883 ms |        338 ms |         208 ms | 5,406 ms |
| `#292929ff` |  970456 |   363 |    2,210 ms |         80 ms |         406 ms | 2,569 ms |
| `#e0e0e0ff` |   85544 |   387 |      537 ms |        129 ms |          86 ms |   801 ms |
| `#141414ff` |  230936 |   110 |      617 ms |         31 ms |          55 ms |   697 ms |
| `#0a0a0aff` |  240572 |    62 |      653 ms |         14 ms |          16 ms |   682 ms |

### 分析

- **buildPolygons**: `#ffffff` 4,202ms→338ms (**12.4x高速化**)、`#e0e0e0` 2,337ms→129ms (**18.1x**)
- 全体のtotalは-4%の微改善に留まる — **removeBidirectionalEdges がボトルネックとして浮上** (`#ffffff` 4,883ms)
- removeBidirectionalEdgesは辺数に比例する文字列キー生成コストが支配的
- concatPolygonsも `#292929` で406msと目立ち始めた
- Top 3色で約8,000ms改善したにもかかわらず workers median が145msしか減っていない
  - Workerは並列実行 (Promise.all) だが実際の並列度はCPUコア数で制限される
  - 1466色中の大半は辺数が少なく (4〜数百)、Map構築のmicro-overheadが旧来の線形スキャンより重い可能性
  - **spawn overhead > 処理時間となる軽量色はメインスレッドで直接実行すべき** — Worker化の損益分岐点を見極める必要がある

---

## Step 1.5: 軽量色のメインスレッド実行

辺数 ≤ 10,000 の色は Worker を spawn せずメインスレッドで直接処理。

### Overall (median / mean)

| Phase      |  Median |    Mean | vs Baseline | vs Step 1 |
| ---------- | ------: | ------: | ----------: | --------: |
| buildEdges |  538 ms |  566 ms |       -74 % |     -76 % |
| workers    | 3,729ms | 3,707ms |       -82 % |     -82 % |
| **total**  | 4,221ms | 4,273ms |    **-82%** |  **-81%** |

### Top 5 Slowest Colors (median)

| Color       |   Edges | Polys | removeEdges | buildPolygons | concatPolygons |    Total |
| ----------- | ------: | ----: | ----------: | ------------: | -------------: | -------: |
| `#ffffffff` | 2296584 |   990 |    1,524 ms |         55 ms |          53 ms | 1,636 ms |
| `#292929ff` |  970456 |   363 |      911 ms |         27 ms |          70 ms | 1,006 ms |
| `#141414ff` |  230936 |   110 |      182 ms |         11 ms |          14 ms |   209 ms |
| `#0a0a0aff` |  240572 |    62 |      168 ms |          7 ms |           4 ms |   181 ms |
| `#e0e0e0ff` |   85544 |   387 |       67 ms |         45 ms |          15 ms |   121 ms |

### 分析

- **全体 23,431ms → 4,221ms**: ベースラインから **5.6x 高速化**
- buildEdges が 2,067ms→538ms に改善 — Worker spawn overhead がなくなり軽量色がメインスレッドで即座に処理されたため、メインスレッドの実行時間に含まれるようになった
- removeBidirectionalEdges が引き続き支配的 (`#ffffff` 1,524ms、`#292929` 911ms)
- Worker数が1466→少数に激減し、Workerは重い色のみを処理
- removeBidirectionalEdges の改善 (数値キー化等) は Wasm で吸収される見込み
- Worker spawn を先行させメインスレッド処理を並行実行する改善を追加。メインスレッド処理(~500ms)が最遅Worker(~1,630ms)より短いため数値上の改善は軽微だが、アーキテクチャとして正しい並行化パターンを適用

---

## Step 2: concatPolygons Map化 — スキップ

元のアルゴリズムは `j → k → l` の3重ループで、マッチ順序が `j` (外側ポリゴンの頂点インデックス) に依存する。Map化で最内ループ `l` を除去すると `j` の優先順序が変わり、ビット一致が保証できない。concatPolygons は現状最大70msであり、改善対コストが見合わないためスキップ。Wasm移植時にアルゴリズムごと書き直す。

---

## Step 3: Int32Array化

辺データを `[number,number,number,number][]` から `Int32Array` (stride 4) に変更。index.ts で2パス構築 (count→allocate→fill)。Worker へは `transferList` でゼロコピー転送。

### Overall (median / mean)

| Phase      |  Median |    Mean | vs Baseline | vs Step 1.5 |
| ---------- | ------: | ------: | ----------: | ----------: |
| buildEdges |  649 ms |  648 ms |       -69 % |       +14 % |
| workers    | 2,210ms | 2,210ms |       -89 % |       -41 % |
| **total**  | 2,873ms | 2,859ms |    **-88%** |    **-33%** |

### Top 5 Slowest Colors (median)

| Color       |  Edges | Polys | removeEdges | buildPolygons | concatPolygons |    Total |
| ----------- | -----: | ----: | ----------: | ------------: | -------------: | -------: |
| `#ffffffff` | 59,106 |   990 |    1,811 ms |         32 ms |          54 ms | 1,897 ms |
| `#292929ff` | 27,558 |   363 |      798 ms |         17 ms |          67 ms |   891 ms |
| `#0a0a0aff` |  7,348 |    62 |      396 ms |          6 ms |           5 ms |   413 ms |
| `#141414ff` | 11,630 |   110 |      345 ms |         16 ms |          14 ms |   395 ms |
| `#e0e0e0ff` | 42,984 |   387 |      239 ms |         98 ms |          22 ms |   364 ms |

### 分析

- **全体 23,431ms → 2,873ms**: ベースラインから **8.2x 高速化**
- 辺数が大幅に減少 (`#ffffff`: 2,296,584→59,106) — removeBidirectionalEdges で除去された辺がもう配列に含まれない…ではなく、edgeCount で管理されるようになったため表示が変わった
- buildEdges が +14% (648ms vs 568ms): 2パス走査のオーバーヘッドだが、Worker への transferList ゼロコピー転送で workers 全体が -41% 改善
- removeBidirectionalEdges が引き続き支配的 (`#ffffff` 1,811ms)
- ばらつきが非常に小さくなった (2,762ms〜2,925ms)

---

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
