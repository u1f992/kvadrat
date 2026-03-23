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

Map化を試行した結果:

1. **j 優先順序の問題**: Map 化で `l` ループを除去すると `j` の優先順序が変わり SVG 文字列が変化。ビジュアルリグレッションテスト (Puppeteer) でレンダリング結果のピクセル一致は確認できたが、文字列一致は不可
2. **Map rebuild コスト**: マージのたびに polygon 全頂点を再スキャンして Map を再構築するため、ポリゴン数が多い色で逆に悪化 (`#ffffff` concatPolygons: 44ms→134ms)
3. **差分更新の困難さ**: splice によるインデックスシフトがあるため、差分追加だけでは不十分でインデックス補正が必要。実装の複雑さに対して効果が見合わない

concatPolygons は現状最大 44ms。Wasm 移植時にアルゴリズムごと書き直す。

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

## Step 4: Workerプール

`os.cpus().length` 個の常駐Workerプール + タスクキュー方式に変更。アイドルWorkerにメッセージベースでタスクを割り当て。`worker.unref()` でプロセス終了をブロックしない。

### Overall (median / mean)

| Phase      |  Median |    Mean | vs Baseline | vs Step 3 |
| ---------- | ------: | ------: | ----------: | --------: |
| buildEdges |  654 ms |  652 ms |       -68 % |      +1 % |
| workers    | 1,780ms | 1,804ms |       -91 % |     -19 % |
| **total**  | 2,439ms | 2,456ms |    **-90%** |  **-15%** |

### Top 5 Slowest Colors (median)

| Color       |  Edges | Polys | removeEdges | buildPolygons | concatPolygons |    Total |
| ----------- | -----: | ----: | ----------: | ------------: | -------------: | -------: |
| `#ffffffff` | 59,106 |   990 |    1,710 ms |         26 ms |          44 ms | 1,777 ms |
| `#292929ff` | 27,558 |   363 |      702 ms |          9 ms |          52 ms |   765 ms |
| `#141414ff` | 11,630 |   110 |      190 ms |          4 ms |           4 ms |   197 ms |
| `#0a0a0aff` |  7,348 |    62 |      187 ms |          2 ms |           1 ms |   191 ms |
| `#e0e0e0ff` | 42,984 |   387 |       80 ms |         27 ms |           7 ms |   111 ms |

### 分析

- **全体 23,431ms → 2,439ms**: ベースラインから **9.6x 高速化**
- Worker spawn overhead 除去で workers -19% (2,210ms→1,780ms)
- ばらつきがさらに安定 (2,385ms〜2,624ms)
- removeBidirectionalEdges が全体の ~70% を占有。Wasm化で吸収される部分

---

## Wasm化: removeBidirectionalEdges を C/Emscripten に移植

JS の文字列キー `Map<string, number>` を C の uint64 数値キーハッシュテーブル (open addressing, linear probing) に置換。

### Overall (median / mean)

| Phase      | Median |   Mean | vs Baseline | vs Step 4 |
| ---------- | -----: | -----: | ----------: | --------: |
| buildEdges | 719 ms | 720 ms |       -65 % |     +10 % |
| workers    | 219 ms | 248 ms |       -99 % |     -88 % |
| **total**  | 943 ms | 968 ms |    **-96%** |  **-61%** |

### Top 5 Slowest Colors (median)

| Color       |   Edges | Polys | removeEdges | buildPolygons | concatPolygons |  Total |
| ----------- | ------: | ----: | ----------: | ------------: | -------------: | -----: |
| `#ffffffff` | 2296584 |   990 |      128 ms |         39 ms |          49 ms | 215 ms |
| `#292929ff` |  970456 |   363 |       59 ms |         17 ms |          56 ms | 132 ms |
| `#e0e0e0ff` |   85544 |   387 |        7 ms |         33 ms |           4 ms |  46 ms |
| `#141414ff` |  230936 |   110 |       17 ms |          7 ms |           6 ms |  31 ms |
| `#0a0a0aff` |  240572 |    62 |       18 ms |          3 ms |           1 ms |  24 ms |

### 分析

- **全体 23,431ms → 943ms**: ベースラインから **24.9x 高速化**
- `removeBidirectionalEdges`: `#ffffff` 1,710ms→128ms (**13.4x**)、`#292929` 702ms→59ms (**11.9x**)
- workers 全体が 1,780ms→219ms (**8.1x**) — Wasm の数値キーハッシュが文字列キー生成を完全に排除
- buildEdges (719ms) が全体の 76% を占有 — 次の改善ターゲット
- ばらつきは極めて小さい (907ms〜1,161ms)

---

## Wasm化: buildPolygons を C に移植 + concatPolygons の C 実装

`buildPolygons` を C に移植 (隣接ハッシュテーブル + 連結リスト)。`concatPolygons` も C 実装したが、フラットバッファ上の `poly_offset` O(n) 走査により `#ffffff` で 49ms→5,024ms に大幅悪化したため JS に戻した。C 実装はコードベースに残す (アルゴリズム改善で再利用する可能性)。

### Overall (median / mean)

| Phase      | Median |   Mean | vs Baseline | vs 前回 Wasm |
| ---------- | -----: | -----: | ----------: | -----------: |
| buildEdges | 683 ms | 678 ms |       -67 % |         -5 % |
| workers    | 171 ms | 198 ms |       -99 % |        -22 % |
| **total**  | 848 ms | 876 ms |    **-96%** |     **-10%** |

### Top 5 Slowest Colors (median)

| Color       |   Edges | Polys | removeEdges | buildPolygons | concatPolygons |  Total |
| ----------- | ------: | ----: | ----------: | ------------: | -------------: | -----: |
| `#ffffffff` | 2296584 |   990 |      110 ms |          3 ms |          41 ms | 155 ms |
| `#292929ff` |  970456 |   363 |       60 ms |          2 ms |          61 ms | 124 ms |
| `#141414ff` |  230936 |   110 |       16 ms |          1 ms |           5 ms |  23 ms |
| `#0a0a0aff` |  240572 |    62 |       15 ms |          0 ms |           1 ms |  17 ms |
| `#e0e0e0ff` |   85544 |   387 |        6 ms |          4 ms |           7 ms |  17 ms |

### 分析

- **全体 23,431ms → 848ms**: ベースラインから **27.6x 高速化**
- `buildPolygons` Wasm化: `#ffffff` 39ms→3ms (**13x**)
- `concatPolygons` C実装は `poly_offset` の線形走査が O(P²) を O(P³) に悪化させたため JS に戻した。C 実装のアルゴリズム改善 (ポリゴンオフセットのインデックス配列管理等) が今後の課題
- buildEdges (683ms) が全体の 81% — メインスレッドのピクセル走査がボトルネック

---

## Wasm化: concat_polygons のアルゴリズム改善

初回の C 実装は `poly_offset` でポリゴン位置を毎回先頭から走査 (O(P)) したため O(P³V) に悪化 (`#ffffff` 49ms→5,024ms)。オフセットインデックス配列を導入し O(1) アクセスに改善。

### Overall (median / mean)

| Phase      | Median |   Mean | vs Baseline | vs 前回 |
| ---------- | -----: | -----: | ----------: | ------: |
| buildEdges | 685 ms | 680 ms |       -67 % |    +0 % |
| workers    | 163 ms | 178 ms |       -99 % |    -5 % |
| **total**  | 843 ms | 858 ms |    **-96%** |  **0%** |

### concatPolygons 比較

| 実装                  | `#ffffff` (990 polys) | `#292929` (363 polys) |
| --------------------- | --------------------: | --------------------: |
| JS                    |                 41 ms |                 61 ms |
| C (poly_offset O(P))  |              5,024 ms |                687 ms |
| C (offset index O(1)) |                 23 ms |                 26 ms |

### 分析

- offset index 導入で C 版 concatPolygons が JS 版を上回る (`#ffffff` 41ms→23ms, **1.8x**)
- 全体は 848ms→843ms で微改善。concatPolygons はもはやボトルネックではない
- buildEdges (685ms, 81%) が支配的。メインスレッドの JS ピクセル走査

---

## embind 移行

cwrap + 手動 \_malloc/HEAP32 管理を embind に置換。core.c はそのまま、bindings.cpp で `EMSCRIPTEN_BINDINGS` を定義。`processEdges` が全パイプラインを 1 回の呼び出しで実行。worker.ts から手動ヒープ管理コードが消滅。total median 843ms→822ms。

---

## buildEdges ボトルネック分析

全体 822ms のうち buildEdges が ~680ms (81%)。内訳を計測:

| フェーズ                            |  時間 |
| ----------------------------------- | ----: |
| ピクセル読み取り (`getPixelColor`)  | 71 ms |
| + `intToRGBA` + `colorHex` 文字列化 | 350ms |
| + Map カウント (Pass1)              | 379ms |
| Pass2: 再読み + エッジ書き込み      | 437ms |

ボトルネックは `intToRGBA` + `colorHex` の **JS 文字列生成** (~280ms)。ピクセルの生データ読み取り自体は 71ms と軽い。2 パス構造による二重読み取りも無視できないコスト。

**判断**: ピクセルバッファ (RGBA Uint8Array) を C に渡し、色分類 + エッジ構築を C 側で行う。C では RGBA → 32bit 整数キーのハッシュテーブルで文字列生成を完全に排除できる。2 パスの二重読み取りも解消。

---

## Wasm化: processImage — ピクセルバッファから全パイプライン

RGBA ピクセルバッファを C に渡し、色分類 + エッジ構築 + 全パイプライン (remove/build/concat) を 1 回の呼び出しで実行。JS 側は SVG パス文字列生成のみ。Worker プール廃止 (シングルスレッド同期実行)。

### Overall (median / mean)

| Phase     | Median |   Mean | vs Baseline |  vs 前回 |
| --------- | -----: | -----: | ----------: | -------: |
| wasm      | 245 ms | 249 ms |       -99 % |    -70 % |
| **total** | 254 ms | 258 ms |    **-99%** | **-69%** |

### 分析

- **全体 23,431ms → 254ms**: ベースラインから **92.2x 高速化**
- buildEdges の JS 文字列生成 (~280ms) を C の uint32 ハッシュで完全排除
- Worker プール廃止でアーキテクチャが大幅にシンプル化
- 将来: Emscripten pthread による色ごとの並列化で更なる改善余地あり

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
