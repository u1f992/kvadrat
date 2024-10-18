import collections
import itertools
import logging
import typing

import shapely  # type: ignore

from .svg import SVGRoot, SVGElement
from .util import EPSILON

RGBAColor = tuple[int, int, int, int]
Coordinate = tuple[int, int]


def create_color_map(
    bitmap: "typing.Sequence[typing.Sequence[RGBAColor]]",
) -> "collections.defaultdict[RGBAColor, set[Coordinate]]":
    color_map = typing.cast(
        "collections.defaultdict[RGBAColor, set[Coordinate]]",
        collections.defaultdict(set),
    )
    for y, row in enumerate(bitmap):
        for x, color in enumerate(row):
            color_map[color].add((x, y))
    # return types.MappingProxyType(
    #     {color: frozenset(coord) for color, coord in color_map.items()}
    # )
    return color_map


def merge_polygons(
    polygons: "typing.Collection[shapely.Polygon]",
) -> shapely.Polygon:
    """
    Merges a collection of polygons into a single `shapely.Polygon`, handling cases where polygons only touch at a point.
    If the result cannot be merged into one polygon, it will return a `shapely.MultiPolygon`.

    `shapely.unary_union` typically does not combine polygons that only touch at a point.

    ```
    >>> import shapely
    >>> polygons = [shapely.Polygon([(0, 0), (0, 1), (1, 1), (1, 0)]), shapely.Polygon([(1, 1), (1, 2), (2, 2), (2, 1)]), shapely.Polygon([(2, 2), (2, 3), (3, 3), (3, 2)])]
    >>> shapely.unary_union(polygons)
    <MULTIPOLYGON (((0 1, 1 1, 1 0, 0 0, 0 1)), ((2 2, 2 1, 1 1, 1 2, 2 2)), ((3...>
    ```

    This function adds a small buffer around each polygon to allow `unary_union` to merge them, even when they only touch at a point.
    After merging, the buffer is subtracted, and the coordinates are cleaned to return a single `shapely.Polygon`.

    ```
    >>> merge_polygons(polygons)
    <POLYGON ((0 0, 0 1, 1 1, 1 2, 2 2, 2 3, 3 3, 3 2, 2 2, 2 1, 1 1, 1 0, 0 0))>
    ```
    """
    unified = shapely.unary_union([p.buffer(EPSILON) for p in polygons]).buffer(
        -EPSILON
    )
    return (
        shapely.Polygon(
            coord
            # Only remove consecutive duplicates. Removing all duplicates would break intersections.
            for coord, _ in itertools.groupby(
                (round(x), round(y)) for x, y in unified.exterior.coords
            )
        )
        if not isinstance(unified, shapely.MultiPolygon)
        else shapely.unary_union(polygons)
    ).simplify(EPSILON)


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
) -> SVGRoot:
    logger = logging.getLogger(__name__)

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
    logger.debug(f"{len(color_map)=}")

    polygons_attribs = [
        (
            merge_polygons(
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
                ]
            ),
            get_shortest_fill_attribute(color),
        )
        for color, coords in color_map.items()
    ]
    logger.debug(f"{len(polygons_attribs)=}")

    return SVGRoot(
        [
            SVGElement.from_polygon(polygon, attrib)
            for polygon, attrib in polygons_attribs
        ]
    )
