# Kvadrat

Vectorizes bitmap images into SVG or CSS.

|          Input          |          Output          |
| :---------------------: | :----------------------: |
| ![](./assets/input.png) | ![](./assets/output.svg) |

Three decomposition modes are available:

- **layered** (default) — Overlapping rectangles via layered recursive decomposition. Picks the most frequent color as background, paints the entire region, then recurses on remaining components. Layers are rendered back-to-front with z-ordering, eliminating subpixel gaps at color boundaries.
- **flat** — Non-overlapping rectangles. Groups pixels by color and applies greedy row-run merging. Each pixel belongs to exactly one rectangle.
- **outline** — Non-overlapping polygon outlines. Traces pixel boundaries per color, removes shared interior edges, and merges touching polygons into minimal contours.

Output formats:

| Decompose \ Format | `path` | `rect` | `polygon` | `css-background` |
| :-: | :-: | :-: | :-: | :-: |
| `layered` | SVG `<path>` (compact) | SVG `<rect>` | SVG `<path>` (polygon) | CSS `background` |
| `flat` | SVG `<path>` (compact) | SVG `<rect>` | SVG `<path>` (polygon) | CSS `background` |
| `outline` | — | — | SVG `<path>` (outline) | — |

<details>
<summary>With optimizations</summary>

```
$ magick input.png +dither -colors 64 input+dither-colors_64.png
$ kvadrat --input input+dither-colors_64.png --output input+dither-colors_64.svg
$ svgo input+dither-colors_64.svg -o output+dither-colors_64+svgo.svg
```

|          Input          |                     Output                     |
| :---------------------: | :--------------------------------------------: |
| ![](./assets/input.png) | ![](./assets/output+dither-colors_64+svgo.svg) |

</details>

The output may show grid-like artifacts or wrinkles at non-integer scale factors due to subpixel rounding in the renderer. This is inherent to vector representations of pixel data. Displaying at an integer multiple of the original pixel dimensions may help.

## Usage

```
kvadrat [options]

Options:
  -i, --input <file>
  -o, --output <file>
  -d, --decompose <mode>    layered (default), flat, or outline
  -f, --format <format>     path (default), rect, polygon, or css-background
  --css-selector <sel>      CSS selector (default: .image)
  --css-material <type>     linear-gradient (default) or svg
  --rgba                    use #RRGGBBAA instead of fill-opacity attribute
  -v, --version
  -h, --help
```

## Performance

```
$ grep "model name" /proc/cpuinfo | head -1
model name	: Intel(R) Core(TM) Ultra 7 155U

$ time node dist/cli.js --input assets/input.png --output assets/output.svg

real	0m0.42s
user	0m1.18s
sys	0m0.16s
```
