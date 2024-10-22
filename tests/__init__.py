import logging
import sys

import shapely  # type: ignore

import kvadrat.polygon


def test_polygon_normalize():
    polygon = shapely.Polygon([(0, 10), (10, 10), (10, 0), (0, 0)])
    oriented = kvadrat.polygon.normalize(polygon)
    assert shapely.Polygon([(0, 0), (0, 10), (10, 10), (10, 0)]) == oriented, oriented

    simplified = kvadrat.polygon.normalize(
        shapely.Polygon([(0, 5), (0, 0), (5, 0), (10, 0), (10, 5), (10, 10), (0, 10)])
    )
    assert (
        shapely.Polygon([(0, 0), (0, 10), (10, 10), (10, 0)]) == simplified
    ), simplified

    merged = kvadrat.polygon.normalize(
        shapely.MultiPolygon(
            [
                shapely.Polygon([(0, 0), (0, 10), (10, 10), (10, 0)]),
                shapely.Polygon([(10, 10), (10, 20), (0, 20), (0, 10)]),
            ]
        )
    )
    assert shapely.Polygon([(0, 0), (0, 20), (10, 20), (10, 0)]) == merged, merged

    merged = kvadrat.polygon.normalize(
        shapely.MultiPolygon(
            [
                shapely.Polygon([(0, 0), (0, 10), (10, 10), (10, 0)]),
                shapely.Polygon([(10, 10), (10, 20), (20, 20), (20, 10)]),
                shapely.Polygon([(20, 20), (20, 30), (30, 30), (30, 20)]),
            ]
        )
    )
    assert (
        shapely.Polygon(
            [
                (0.0, 0.0),
                (0.0, 10.0),
                (10.0, 10.0),
                (10.0, 20.0),
                (20.0, 20.0),
                (20.0, 30.0),
                (30.0, 30.0),
                (30.0, 20.0),
                (20.0, 20.0),
                (20.0, 10.0),
                (10.0, 10.0),
                (10.0, 0.0),
            ]
        )
        == merged
    ), merged

    assert (
        kvadrat.polygon.normalize(
            shapely.MultiPolygon(
                [
                    shapely.Polygon([(30, 30), (30, 20), (20, 20), (20, 30)]),
                    shapely.Polygon([(10, 10), (10, 20), (20, 20), (20, 10)]),
                    shapely.Polygon([(0, 0), (0, 10), (10, 10), (10, 0)]),
                ]
            )
        )
        == merged
    )


if __name__ == "__main__":
    logger = logging.getLogger("kvadrat")
    logger.addHandler(logging.StreamHandler(sys.stderr))
    logger.setLevel(logging.DEBUG)

    test_polygon_normalize()
