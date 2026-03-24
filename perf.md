# Rectangle Mode Optimization

## Target

Minimize rectangle count in rectangle mode output.
Also: eliminate subpixel gaps at color boundaries (polygon mode).

## Benchmark: test/input.png (1390×900, 1466 colors)

| Approach | Rects | Time | Notes |
|---|---:|---:|---|
| Greedy row-run + vertical ext (baseline) | 34,255 | ~13s | Current `build_rectangles` in core.c |
| Layered decompose PoC (JS) | 122,610 | ~18s | Correct (0 pixel diff), but rect count 3.6× worse |

## Approach: Layered Recursive Decomposition

Z-order + 領域重なりで穴なし保証 → 矩形分割最適化 + 白筋解消を同時に狙う。

### 定式化 (poc/layered-decompose.mjs)

```
SOLVE(R, C):
  c* = most_frequent_color(R)
  emit layer (c*, R)
  remaining = {p ∈ R : C(p) ≠ c*}
  for each 4-connected component K of remaining:
    R_K = chooseRegion(K)   // bbox拡張 or outerFill or comp自体
    push SOLVE(R_K, C|R_K)
```

### VRT結果 (crops)

| Crop | Colors | Rects | Naive | Reduction | Pixel diff |
|---|---:|---:|---:|---:|---:|
| 50×50 (0,0) | 88 | 321 | 2,500 | 87% | 0 |
| 100×100 (0,0) | 118 | 1,015 | 10,000 | 90% | 0 |
| 200×100 (0,0) | 203 | 2,923 | 20,000 | 85% | 0 |
| Full 1390×900 | 1,466 | 122,610 | 1,251,000 | 90% | 0 |

### 問題: naive比では削減だが baseline比では3.6倍悪化

原因: `outerFill` が親領域と同サイズになる場合（穴が大きい場合）、
無限ループ防止のため穴埋めをスキップ → 穴あり領域を greedy 分割 → 小矩形大量発生。
同じ色が多層に分散（15,912層）するオーバーヘッドも大きい。

### 次のステップ

穴埋めスキップ時の代替戦略が必要:
- 穴あり領域を bridge 分割して穴なしに変換する
- outerFill ガードの条件を緩和する（親と同サイズでも bg が変われば収束する）
- 層の統合: 同色の層をマージして重複を削減
