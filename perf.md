# Rectangle Mode Optimization

## Target

Minimize rectangle count in rectangle mode output.
Also: eliminate subpixel gaps at color boundaries (polygon mode).

## Benchmark: test/input.png (1390×900, 1466 colors)

| Approach | Rects | Layers | Time (JS) | Notes |
|---|---:|---:|---:|---|
| Greedy row-run + vertical ext (baseline) | 34,255 | 1,466 | ~13s | Current `build_rectangles` in core.c (Wasm) |
| Layered v1 (raw comp fallback) | 122,610 | 15,912 | ~10s | Guard blocks outerFill → holey regions → rect explosion |
| **Layered v2 (flat per-color fallback)** | **32,655** | **1,810** | **~3s** | **-4.7% vs baseline, correct (0 diff)** |

## Algorithm: Layered Recursive Decomposition (poc/layered-decompose.mjs)

```
SOLVE(R, C):
  c* = most_frequent_color(R)
  emit layer (c*, R)
  remaining = {p ∈ R : C(p) ≠ c*}
  for each 4-connected component K of remaining:
    R_K = chooseRegion(K)  // bbox expansion or outerFill
    if R_K is not null:
      push SOLVE(R_K, C|R_K)
    else:
      // Guard fired: flat per-color decomposition
      for each color c in K:
        emit layer (c, greedy_decompose(pixels of c in K))
```

### chooseRegion strategy

1. **bbox expansion**: comp の bbox 内の非 comp ピクセルが全て bg かつ parent 内 → bbox に拡張
2. **outerFill**: comp の穴を埋めた結果が parent より小さい → 穴埋め版を使用
3. **null (flat fallback)**: 上記いずれも不可 → 色ごとにフラット分解

### VRT結果

| Crop | Colors | Rects | Naive | Reduction | Pixel diff |
|---|---:|---:|---:|---:|---:|
| 50×50 (0,0) | 88 | 321 | 2,500 | 87% | 0 |
| 100×100 (0,0) | 118 | 1,010 | 10,000 | 90% | 0 |
| 200×100 (0,0) | 203 | 2,918 | 20,000 | 85% | 0 |
| 200×100 (200,0) | 164 | 2,523 | 20,000 | 87% | 0 |
| Full 1390×900 | 1,466 | 32,655 | 1,251,000 | 97% | 0 |
