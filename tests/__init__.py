import logging
import sys

import shapely  # type: ignore

import kvadrat.constants
import kvadrat.polygon


def test_polygon_normalize():
    normalized = kvadrat.polygon.Polygon.from_shapely(
        shapely.Polygon([(0, 5), (0, 10), (10, 10), (10, 0), (0, 0)])
    )
    coords = normalized.coords[0]
    assert (0, 0) == coords[0]
    assert (10, 0) == coords[1]
    assert (10, 10) == coords[2]
    assert (0, 10) == coords[3]
    assert (0, 5) == coords[4]


def test_polygon_round():
    rounded = kvadrat.polygon.Polygon.from_shapely(
        shapely.Polygon([(0.1, 0), (9.9, 0), (10, 10.1), (0.4, 9.6)])
    ).round()
    coords = rounded.coords[0]
    assert (0, 0) == coords[0]
    assert (10, 0) == coords[1]
    assert (10, 10) == coords[2]
    assert (0, 10) == coords[3]


def test_polygon_simplify():
    simplified = kvadrat.polygon.Polygon.from_shapely(
        shapely.Polygon([(0, 5), (0, 0), (10, 0), (10, 10), (0, 10)])
    ).simplify(kvadrat.constants.EPSILON)
    coords = simplified.coords[0]
    assert (0, 0) == coords[0]
    assert (10, 0) == coords[1]
    assert (10, 10) == coords[2]
    assert (0, 10) == coords[3]


def test_polygon_merge():
    merged = kvadrat.polygon.merge(
        map(
            kvadrat.polygon.Polygon.from_shapely,
            (
                shapely.Polygon(((0, 0), (0, 10), (10, 10), (10, 0))),
                shapely.Polygon(((10, 10), (10, 20), (20, 20), (20, 10))),
                shapely.Polygon(((20, 20), (20, 30), (30, 30), (30, 20))),
            ),
        ),
        kvadrat.constants.EPSILON,
    )
    assert len(merged.geoms) == 1

    merged = kvadrat.polygon.merge(
        map(
            kvadrat.polygon.Polygon.from_shapely,
            (
                shapely.Polygon(((0, 0), (0, 10), (10, 10), (10, 0))),
                shapely.Polygon(((20, 20), (20, 30), (30, 30), (30, 20))),
            ),
        ),
        kvadrat.constants.EPSILON,
    )
    assert len(merged.geoms) != 1

    merged = kvadrat.polygon.merge(
        (
            kvadrat.polygon.merge(
                map(
                    kvadrat.polygon.Polygon.from_shapely,
                    (
                        shapely.Polygon(((0, 0), (0, 10), (10, 10), (10, 0))),
                        shapely.Polygon(((20, 20), (20, 30), (30, 30), (30, 20))),
                    ),
                ),
                kvadrat.constants.EPSILON,
            ),
            kvadrat.polygon.Polygon.from_shapely(
                shapely.Polygon(((10, 10), (10, 20), (20, 20), (20, 10)))
            ),
        ),
        kvadrat.constants.EPSILON,
    )
    assert len(merged.geoms) == 1


if __name__ == "__main__":
    logger = logging.getLogger("kvadrat")
    logger.addHandler(logging.StreamHandler(sys.stderr))
    logger.setLevel(logging.DEBUG)

    test_polygon_normalize()
    test_polygon_round()
    test_polygon_simplify()
    test_polygon_merge()
