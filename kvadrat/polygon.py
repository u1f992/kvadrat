import functools
import typing

import shapely  # type: ignore
import shapely.geometry.base  # type: ignore
import shapely.geometry.polygon  # type: ignore

import kvadrat.util

_round = round


def _normalize(polygon: shapely.Polygon) -> shapely.Polygon:
    oriented = shapely.geometry.polygon.orient(polygon, sign=1.0)
    coords = oriented.exterior.coords
    min_index = min(range(len(coords)), key=lambda i: coords[i])
    return shapely.Polygon(coords[min_index:] + coords[1 : min_index + 1])


def _are_parallel(v1: tuple[float, float], v2: tuple[float, float]) -> bool:
    return v1[0] * v2[1] == v1[1] * v2[0]


def _are_equal_length(v1: tuple[float, float], v2: tuple[float, float]) -> bool:
    return (v1[0] ** 2 + v1[1] ** 2) == (v2[0] ** 2 + v2[1] ** 2)


def _are_perpendicular(v1: tuple[float, float], v2: tuple[float, float]) -> bool:
    return v1[0] * v2[0] + v1[1] * v2[1] == 0


class Polygon:
    @classmethod
    def from_shapely(
        cls, polygon: "shapely.Polygon | shapely.MultiPolygon"
    ) -> "Polygon":
        return Polygon(
            map(_normalize, polygon.geoms)
            if isinstance(polygon, shapely.MultiPolygon)
            else [_normalize(polygon)]
        )

    def __init__(self, polygons: "typing.Iterable[shapely.Polygon]") -> None:
        self.__polygons = tuple(polygons)
        if len(self.__polygons) == 0:
            raise RuntimeError()

    @functools.cached_property
    def geoms(self) -> "tuple[Polygon, ...]":
        return tuple(
            [self]
            if len(self.__polygons) == 1
            else [Polygon.from_shapely(p) for p in self.__polygons]
        )

    @functools.cached_property
    def coords(self) -> "tuple[tuple[tuple[int | float, int | float], ...], ...]":
        return tuple(
            [
                tuple(
                    (
                        kvadrat.util.int_if_possible(coord[0]),
                        kvadrat.util.int_if_possible(coord[1]),
                    )
                    for coord in self.__polygons[0].exterior.coords
                )
            ]
            if len(self.__polygons) == 1
            else [p.coords[0] for p in self.geoms]
        )

    def round(
        self,
        ndigits: "int | None" = None,
    ) -> "Polygon":
        return Polygon.from_shapely(
            shapely.MultiPolygon(
                [
                    shapely.Polygon(
                        [(_round(x, ndigits), _round(y, ndigits)) for x, y in coords]
                    )
                    for coords in self.coords
                ]
            )
        )

    def simplify(self, tolerance: float) -> "Polygon":
        """
        The result of `shapely.Polygon.simplify` depends on the starting point.

        ```
        >>> shapely.__version__
        '2.0.6'
        >>> shapely.Polygon([(0,0),(0,5),(0,10),(10,10),(10,0)]).simplify(0.1)
        <POLYGON ((0 0, 0 10, 10 10, 10 0, 0 0))>
        >>> shapely.Polygon([(0,5),(0,10),(10,10),(10,0),(0,0)]).simplify(0.1)
        <POLYGON ((0 5, 0 10, 10 10, 10 0, 0 0, 0 5))>
        ```
        """
        return Polygon.from_shapely(
            shapely.MultiPolygon(
                [
                    typing.cast(shapely.Polygon, p.simplify(tolerance))
                    for p in self.__polygons
                ]
            )
        )

    def is_rect(self) -> bool:
        if len(self.__polygons) != 1 or len(self.coords[0]) != 5:
            return False

        coords = self.coords[0]
        p1, p2, p3, p4, _ = coords

        vec1 = (p2[0] - p1[0], p2[1] - p1[1])
        vec2 = (p3[0] - p2[0], p3[1] - p2[1])
        vec3 = (p4[0] - p3[0], p4[1] - p3[1])
        vec4 = (p1[0] - p4[0], p1[1] - p4[1])

        return (
            _are_parallel(vec1, vec3)
            and _are_equal_length(vec1, vec3)
            and _are_parallel(vec2, vec4)
            and _are_equal_length(vec2, vec4)
            and _are_perpendicular(vec1, vec2)
        )


def merge(
    polygons: "typing.Iterable[Polygon]",
    buffer_amount: float,
) -> "Polygon":
    """
    `shapely.unary_union` typically does not combine polygons that only touch at a point.

    ```
    >>> shapely.__version__
    '2.0.6'
    >>> polygons = [shapely.Polygon([(0, 0), (0, 1), (1, 1), (1, 0)]), shapely.Polygon([(1, 1), (1, 2), (2, 2), (2, 1)]), shapely.Polygon([(2, 2), (2, 3), (3, 3), (3, 2)])]
    >>> shapely.unary_union(polygons)
    <MULTIPOLYGON (((0 1, 1 1, 1 0, 0 0, 0 1)), ((2 2, 2 1, 1 1, 1 2, 2 2)), ((3...>
    ```
    """
    return Polygon.from_shapely(
        shapely.unary_union(
            [
                shapely.Polygon(coords).buffer(buffer_amount)
                for polygon in polygons
                for coords in polygon.coords
            ]
        ).buffer(-buffer_amount)
    )
