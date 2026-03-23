# Rectangle Decomposition Optimization

## Goal

Minimize rectangle count in rectangle mode output.

## Image: test/input.png (1390x900, 1466 colors)

| Approach | Rects | Time | Notes |
|---|---:|---:|---|
| Greedy row-run + vertical ext (baseline) | 34,255 | ~297ms | O(W×H), simple |
| Bidirectional greedy (h+v, take best) | 34,255 | ~600ms | No improvement for this image |
| Largest rectangle first | 12,954* | 23,608ms* | *smaller image; O(W×H×R), impractical |
| Polygon strip decomposition + vertical merge | 33,639 | ~404ms | -1.8% rects, +36% time |

## Current: Polygon strip decomposition

Pipeline: edges → remove_bidirectional → build_polygons → rect_decompose

`rect_decompose` uses polygon vertex y-coordinates to define horizontal strips.
Within each strip, vertical edge x-coordinates are XOR-paired to form intervals.
Post-pass merges vertically adjacent rectangles with same (x, w).
