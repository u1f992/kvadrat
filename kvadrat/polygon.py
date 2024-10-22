from __future__ import annotations

import itertools
import logging
import math
import typing

import shapely  # type:ignore

import kvadrat.util

_logger = logging.getLogger(__name__)

BoundingBox = tuple["int | float", "int | float", "int | float", "int | float"]


def try_merge(
    polygon: shapely.MultiPolygon, buffer_amount: float = 0.000001
) -> "shapely.Polygon | shapely.MultiPolygon":
    unified = typing.cast(
        "shapely.Polygon | shapely.MultiPolygon",
        shapely.union_all(polygon),  # type:ignore
    )
    if isinstance(unified, shapely.Polygon):
        return unified

    unified_buffered = typing.cast(
        "shapely.Polygon | shapely.MultiPolygon",
        shapely.union_all(polygon.buffer(buffer_amount)),  # type:ignore
    )
    if isinstance(unified_buffered, shapely.Polygon):
        ndigits = -int(math.log10(buffer_amount) + 1)
        rounded = map(
            lambda xy: (
                kvadrat.util.int_if_possible(round(xy[0], ndigits)),
                kvadrat.util.int_if_possible(round(xy[1], ndigits)),
            ),
            unified_buffered.exterior.coords,
        )
        cleaned = map(lambda kg: kg[0], itertools.groupby(rounded))
        return shapely.Polygon(cleaned)

    return unified


@typing.overload
def normalize(
    polygon: shapely.Polygon, tolerance: float = 0.001
) -> shapely.Polygon: ...


@typing.overload
def normalize(  # type: ignore
    # error: Overloaded function signature 2 will never be matched:
    # signature 1's parameter type(s) are the same or broader  [misc]
    polygon: shapely.MultiPolygon,
    tolerance: float = 0.001,
) -> shapely.Polygon | shapely.MultiPolygon: ...


def normalize(
    polygon: shapely.Polygon | shapely.MultiPolygon, tolerance: float = 0.001
) -> shapely.Polygon | shapely.MultiPolygon:
    if isinstance(polygon, shapely.MultiPolygon):
        polygon = try_merge(polygon, tolerance / 1000)

    # Since the result of `simplify` is influenced by the reordering done by `normalize`,
    # `normalize` is necessary both before and after `simplify`.
    #
    # >>> shapely.__version__
    # '2.0.6'
    # >>> p=shapely.Polygon([(5,0),(10,0),(10,10),(0,10),(0,0)])
    # >>> p.simplify(0.01).normalize()
    # <POLYGON ((0 0, 0 10, 10 10, 10 0, 5 0, 0 0))>
    # >>> p.normalize().simplify(0.01).normalize()
    # <POLYGON ((0 0, 0 10, 10 10, 10 0, 0 0))>
    normalized = (
        typing.cast(shapely.Polygon, polygon.normalize())
        if isinstance(polygon, shapely.Polygon)
        else typing.cast(shapely.MultiPolygon, polygon.normalize())
    )
    simplified = (
        typing.cast(shapely.Polygon, normalized.simplify(tolerance))
        if isinstance(normalized, shapely.Polygon)
        else typing.cast(shapely.MultiPolygon, normalized.simplify(tolerance))
    )
    normalized = (
        typing.cast(shapely.Polygon, simplified.normalize())
        if isinstance(simplified, shapely.Polygon)
        else typing.cast(shapely.MultiPolygon, simplified.normalize())
    )
    return normalized


def _are_parallel(v1: tuple[float, float], v2: tuple[float, float]) -> bool:
    return v1[0] * v2[1] == v1[1] * v2[0]


def _are_equal_length(v1: tuple[float, float], v2: tuple[float, float]) -> bool:
    return (v1[0] ** 2 + v1[1] ** 2) == (v2[0] ** 2 + v2[1] ** 2)


def _are_perpendicular(v1: tuple[float, float], v2: tuple[float, float]) -> bool:
    return v1[0] * v2[0] + v1[1] * v2[1] == 0


@typing.overload
def is_rect(polygon: shapely.Polygon) -> bool: ...


@typing.overload
def is_rect(  # type: ignore
    # error: Overloaded function signature 2 will never be matched:
    # signature 1's parameter type(s) are the same or broader  [misc]
    polygon: shapely.MultiPolygon,
) -> typing.Literal[False]: ...


def is_rect(polygon: shapely.Polygon | shapely.MultiPolygon) -> bool:
    if (
        isinstance(polygon, shapely.MultiPolygon)
        or len(polygon.interiors) != 0
        or len(polygon.exterior.coords) != 5
    ):
        return False

    p1, p2, p3, p4, _ = polygon.exterior.coords
    vec1 = p2[0] - p1[0], p2[1] - p1[1]
    vec2 = p3[0] - p2[0], p3[1] - p2[1]
    vec3 = p4[0] - p3[0], p4[1] - p3[1]
    vec4 = p1[0] - p4[0], p1[1] - p4[1]

    return (
        _are_parallel(vec1, vec3)
        and _are_equal_length(vec1, vec3)
        and _are_parallel(vec2, vec4)
        and _are_equal_length(vec2, vec4)
        and _are_perpendicular(vec1, vec2)
    )


def bbox(
    polygon: shapely.Polygon | shapely.MultiPolygon,
) -> BoundingBox:
    if polygon.is_empty:
        return 0, 0, 0, 0

    min_x, min_y, max_x, max_y = polygon.bounds
    x = kvadrat.util.int_if_possible(min_x)
    y = kvadrat.util.int_if_possible(min_y)
    width = kvadrat.util.int_if_possible(max_x - x)
    height = kvadrat.util.int_if_possible(max_y - y)
    return x, y, width, height
