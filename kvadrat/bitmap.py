import collections
import logging
import types
import typing

import shapely  # type: ignore

import kvadrat.constants
import kvadrat.polygon
import kvadrat.svg

_logger = logging.getLogger(__name__)

RGBAColor = tuple[int, int, int, int]
Coordinate = tuple[int, int]


def create_color_map(
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


def format_rgba_as_hex(color: RGBAColor) -> str:
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


CSS_NAMED_COLOR = {
    typing.cast(RGBAColor, (255, 0, 0, 255)): "red",
    typing.cast(RGBAColor, (210, 180, 140, 255)): "tan",
}


def get_shortest_fill_attribute(color: RGBAColor) -> dict[str, str]:
    # red (#ff0000) and tan (#d2b48c) are shorter than their respective RGB values
    # https://developer.mozilla.org/docs/Web/CSS/named-color
    return {
        "fill": (
            CSS_NAMED_COLOR[color]
            if color in CSS_NAMED_COLOR.keys()
            else format_rgba_as_hex(color)
        )
    }


def convert_bitmap_to_svg(
    bitmap: "typing.Sequence[typing.Sequence[RGBAColor]]",
) -> kvadrat.svg.Root:
    height = len(bitmap)
    width = len(bitmap[0]) if height > 0 else 0
    if not all(len(row) == width for row in bitmap):
        raise Exception()
    if height > 0:
        expected_channels = len(bitmap[0][0]) if width > 0 else 0
        if expected_channels != 4:
            raise Exception()
        if not all(len(color) == expected_channels for row in bitmap for color in row):
            raise Exception()

    color_map = create_color_map(bitmap)
    _logger.debug(f"{len(color_map)=}")

    polygons_attribs = [
        (
            kvadrat.polygon.simplify(
                kvadrat.polygon.round(
                    kvadrat.polygon.merge(
                        [
                            shapely.Polygon(
                                (
                                    (coord[0], coord[1]),
                                    (coord[0], coord[1] + 1),
                                    (coord[0] + 1, coord[1] + 1),
                                    (coord[0] + 1, coord[1]),
                                )
                            )
                            for coord in coords
                        ],
                        kvadrat.constants.EPSILON,
                    ),
                ),
                0.1,
            ),
            get_shortest_fill_attribute(color),
        )
        for color, coords in color_map.items()
    ]
    _logger.debug(f"{len(polygons_attribs)=}")

    return kvadrat.svg.Root(
        [
            kvadrat.svg.Element.from_polygon(polygon, attrib)
            for polygon, attrib in polygons_attribs
        ]
    )
