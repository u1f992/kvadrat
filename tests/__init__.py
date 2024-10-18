import logging
import kvadrat

import shapely  # type: ignore

if __name__ == "__main__":
    logger = logging.getLogger("kvadrat")
    logger.addHandler(logging.StreamHandler())
    logger.setLevel(logging.DEBUG)

    svg_root = kvadrat.convert_bitmap_to_svg((((0, 0, 0, 0),),))
    print(kvadrat.convert_xml_to_str(svg_root))

    # merged into one polygon
    unified = kvadrat.bitmap.merge_polygons(
        (
            shapely.Polygon(((0, 0), (0, 10), (10, 10), (10, 0))),
            shapely.Polygon(((10, 10), (10, 20), (20, 20), (20, 10))),
            shapely.Polygon(((20, 20), (20, 30), (30, 30), (30, 20))),
        )
    )
    assert not isinstance(unified, shapely.MultiPolygon)
    svg = kvadrat.SVGElement.from_polygon(unified)
    assert svg.tag == "polygon"

    # `shapely.MultiPolygon` is converted to g
    unified = kvadrat.bitmap.merge_polygons(
        (
            shapely.Polygon(((0, 0), (0, 10), (10, 10), (10, 0))),
            # shapely.Polygon(((10, 10), (10, 20), (20, 20), (20, 10))),
            shapely.Polygon(((20, 20), (20, 30), (30, 30), (30, 20))),
        )
    )
    assert isinstance(unified, shapely.MultiPolygon)
    svg = kvadrat.SVGElement.from_polygon(unified)
    assert svg.tag == "g"
    assert len(svg) == 2 and all(child.tag == "polygon" for child in svg)

    # create MultiPolygon and then merge the Polygons that connect them into a single Polygon.
    unified = kvadrat.bitmap.merge_polygons(
        (
            kvadrat.bitmap.merge_polygons(
                (
                    shapely.Polygon(((0, 0), (0, 10), (10, 10), (10, 0))),
                    shapely.Polygon(((20, 20), (20, 30), (30, 30), (30, 20))),
                )
            ),
            shapely.Polygon(((10, 10), (10, 20), (20, 20), (20, 10))),
        )
    )
    assert not isinstance(unified, shapely.MultiPolygon)

    polygon = shapely.Polygon(((407,495), (407,496), (408,496), (408,495)))
    assert kvadrat.svg.is_rect(polygon)