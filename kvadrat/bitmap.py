import collections

# import concurrent.futures
# import functools
import logging
import types
import typing

import shapely  # type: ignore

import kvadrat.polygon
import kvadrat.svg_
import kvadrat.util

_logger = logging.getLogger(__name__)

RGBAColor = tuple[int, int, int, int]
Coordinate = tuple[int, int]


def _create_color_map(
    bitmap: "typing.Sequence[typing.Sequence[RGBAColor]]",
) -> "types.MappingProxyType[RGBAColor, frozenset[Coordinate]]":
    color_map = typing.cast(
        "collections.defaultdict[RGBAColor, set[Coordinate]]",
        collections.defaultdict(set),
    )
    for y, row in enumerate(bitmap):
        for x, color in enumerate(row):
            color_map[color].add((x, y))
    return types.MappingProxyType(
        {color: frozenset(coord) for color, coord in color_map.items()}
    )


def _format_rgba_as_hex(color: RGBAColor) -> str:
    """
    Converts an RGBA color value to a hexadecimal string representation.

    https://developer.mozilla.org/docs/Web/CSS/hex-color
    """
    r, g, b, a = map(lambda x: format(x, "02x"), color)
    return (
        (
            f"#{r[0]}{g[0]}{b[0]}"
            if all(map(lambda x: x[0] == x[1], (r, g, b)))
            else ((f"#{r}{g}{b}"))
        )
        if a == "ff"
        else (
            f"#{r[0]}{g[0]}{b[0]}{a[0]}"
            if all(map(lambda x: x[0] == x[1], (r, g, b, a)))
            else f"#{r}{g}{b}{a}"
        )
    )


_CSS_NAMED_COLOR = types.MappingProxyType(
    {
        typing.cast(RGBAColor, (255, 0, 0, 255)): "red",
        typing.cast(RGBAColor, (210, 180, 140, 255)): "tan",
    }
)


def _shortest_fill_attribute(color: RGBAColor) -> dict[str, str]:
    # red (#ff0000) and tan (#d2b48c) are shorter than their respective RGB values
    # https://developer.mozilla.org/docs/Web/CSS/named-color
    return {
        "fill": (
            _CSS_NAMED_COLOR[color]
            if color in _CSS_NAMED_COLOR.keys()
            else _format_rgba_as_hex(color)
        )
    }


def cluster_adjacent(
    coords: frozenset[tuple[int, int]]
) -> tuple[frozenset[tuple[int, int]], ...]:
    clusters: list[frozenset[tuple[int, int]]] = []
    remaining = set(coords)

    while len(remaining) > 0:
        coord = remaining.pop()
        cluster = {coord}
        stack = [coord]

        while len(stack) > 0:
            current = stack.pop()
            for neighbor in (
                (current[0] - 1, current[1]),
                (current[0] + 1, current[1]),
                (current[0], current[1] - 1),
                (current[0], current[1] + 1),
            ):
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    cluster.add(neighbor)
                    stack.append(neighbor)

        clusters.append(frozenset(cluster))

    return tuple(clusters)


def svg(
    bitmap: "typing.Sequence[typing.Sequence[RGBAColor]]",
) -> kvadrat.svg_.Root:
    height = len(bitmap)
    width = len(bitmap[0]) if height > 0 else 0
    if not all(len(row) == width for row in bitmap):
        raise RuntimeError()
    if height > 0:
        expected_channels = len(bitmap[0][0]) if width > 0 else 0
        if expected_channels != 4:
            raise RuntimeError()
        if not all(len(color) == expected_channels for row in bitmap for color in row):
            raise RuntimeError()

    color_map = _create_color_map(bitmap)
    _logger.info(f"{len(color_map)=}")

    elements: list[kvadrat.svg_.Element] = []
    for i, color_coords in enumerate(
        sorted(color_map.items(), key=lambda x: len(x[1]))
    ):
        color, coords = color_coords
        attrib = _shortest_fill_attribute(color)
        polygon = kvadrat.polygon.normalize(
            shapely.MultiPolygon(
                [
                    shapely.Polygon(
                        [
                            (coord[0], coord[1]),
                            (coord[0], coord[1] + 1),
                            (coord[0] + 1, coord[1] + 1),
                            (coord[0] + 1, coord[1]),
                        ]
                    )
                    for coord in coords
                ]
            )
        )

        elements.append(kvadrat.svg_.Element.from_polygon(polygon, attrib))
        _logger.info(f"{i + 1}/{len(color_map)} {color}")

    return kvadrat.svg_.Root(elements)
