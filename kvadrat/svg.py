import abc
import logging
import math
import typing
import xml.etree.ElementTree as ET

import shapely  # type: ignore

from .util import EPSILON


class SVGBoundingBox(typing.NamedTuple):
    x: float
    y: float
    width: float
    height: float


def convert_to_int_if_possible(value: "int | float") -> "int | float":
    return int(value) if isinstance(value, float) and value.is_integer() else value


def is_rect(
    polygon: shapely.Polygon,
) -> bool:
    if isinstance(polygon, shapely.MultiPolygon):
        return False

    polygon = polygon.simplify(EPSILON)
    if len(polygon.exterior.coords) != 5:
        return False

    points = tuple(polygon.exterior.coords[:-1])
    for i in range(4):
        p1 = [convert_to_int_if_possible(x) for x in points[i - 1]]
        p2 = [convert_to_int_if_possible(x) for x in points[i]]
        p3 = [convert_to_int_if_possible(x) for x in points[(i + 1) % 4]]
        angle = convert_to_int_if_possible(
            math.degrees(
                math.atan2(p3[1] - p2[1], p3[0] - p2[0])
                - math.atan2(p1[1] - p2[1], p1[0] - p2[0])
            )
        )
        if not (isinstance(angle, int) and angle % 90 == 0):
            return False

    return True


def extract_x_y_width_height_attributes(
    rect: shapely.Polygon,
) -> "tuple[int | float, int | float, int | float, int | float]":
    x_coords, y_coords = typing.cast(
        tuple[typing.Iterable[float], typing.Iterable[float]],
        zip(*rect.exterior.coords[:-1]),
    )
    min_x = convert_to_int_if_possible(min(x_coords))
    max_x = convert_to_int_if_possible(max(x_coords))
    min_y = convert_to_int_if_possible(min(y_coords))
    max_y = convert_to_int_if_possible(max(y_coords))
    width = max_x - min_x
    height = max_y - min_y
    return min_x, min_y, width, height


def get_x_y_width_height_attributes_str(rect: shapely.Polygon) -> str:
    x, y, width, height = extract_x_y_width_height_attributes(rect)
    return f'x="{x}" y="{y}" width="{width}" height="{height}"'


def get_points_attribute_str(polygon: shapely.Polygon) -> str:
    return " ".join(
        f"{convert_to_int_if_possible(x)},{convert_to_int_if_possible(y)}"
        for x, y in polygon.exterior.coords
    )


def prefer_rect(polygon: shapely.Polygon) -> bool:
    return is_rect(polygon) and len(get_x_y_width_height_attributes_str(polygon)) < len(
        f'points="{get_points_attribute_str(polygon)}"'
    )


class SVGElement(ET.Element, metaclass=abc.ABCMeta):
    @property
    @abc.abstractmethod
    def bbox(self) -> SVGBoundingBox:
        raise NotImplementedError()

    @classmethod
    def from_polygon(
        cls,
        polygon: shapely.Polygon,
        attrib: dict[str, str] = {},
        **extra: str,
    ) -> "SVGElement":
        return (
            (SVGRect if prefer_rect(polygon) else SVGPolygon)(
                polygon, attrib=attrib, **extra
            )
            if not isinstance(polygon, shapely.MultiPolygon)
            else SVGGroup(
                [cls.from_polygon(p) for p in polygon.geoms], attrib=attrib, **extra
            )
        )


def calculate_bbox(elements: "typing.Collection[SVGElement]") -> SVGBoundingBox:
    if len(elements) == 0:
        return SVGBoundingBox(0, 0, 0, 0)

    min_x = float("inf")
    min_y = float("inf")
    max_x = float("-inf")
    max_y = float("-inf")

    for element in elements:
        bbox = element.bbox
        min_x = min(min_x, bbox.x)
        min_y = min(min_y, bbox.y)
        max_x = max(max_x, bbox.x + bbox.width)
        max_y = max(max_y, bbox.y + bbox.height)

    width = max_x - min_x
    height = max_y - min_y

    return SVGBoundingBox(min_x, min_y, width, height)


class SVGRoot(ET.Element):
    def __init__(
        self,
        elements: "typing.Collection[SVGElement]",
        attrib: dict[str, str] = {},
        **extra: str,
    ) -> None:
        bbox = calculate_bbox(elements)
        super().__init__(
            "svg",
            xmlns="http://www.w3.org/2000/svg",
            width=str(convert_to_int_if_possible(bbox.width)),
            height=str(convert_to_int_if_possible(bbox.height)),
            viewBox=f"{convert_to_int_if_possible(bbox.x)} "
            f"{convert_to_int_if_possible(bbox.y)} "
            f"{convert_to_int_if_possible(bbox.width)} "
            f"{convert_to_int_if_possible(bbox.height)}",
            attrib=attrib,
            **extra,
        )
        for element in elements:
            self.append(element)


class SVGGroup(SVGElement):
    def __init__(
        self,
        elements: "typing.Collection[SVGElement]",
        attrib: dict[str, str] = {},
        **extra: str,
    ) -> None:
        super().__init__("g", attrib=attrib, **extra)
        for element in elements:
            self.append(element)
        self.__bbox = calculate_bbox(elements)

    @property
    def bbox(self) -> SVGBoundingBox:
        return self.__bbox


class SVGPolygon(SVGElement):
    def __init__(
        self,
        polygon: shapely.Polygon,
        attrib: dict[str, str] = {},
        **extra: str,
    ) -> None:
        if isinstance(polygon, shapely.MultiPolygon):
            raise Exception()
        super().__init__(
            "polygon", points=get_points_attribute_str(polygon), attrib=attrib, **extra
        )

        min_x, min_y, max_x, max_y = polygon.bounds
        width = max_x - min_x
        height = max_y - min_y
        self.__bbox = SVGBoundingBox(min_x, min_y, width, height)

    @property
    def bbox(self) -> SVGBoundingBox:
        return self.__bbox


class SVGRect(SVGElement):
    def __init__(
        self,
        rect: shapely.Polygon,
        attrib: dict[str, str] = {},
        **extra: str,
    ) -> None:
        if not is_rect(rect):
            raise Exception()
        x, y, width, height = extract_x_y_width_height_attributes(rect)
        super().__init__(
            "rect",
            x=str(convert_to_int_if_possible(x)),
            y=str(convert_to_int_if_possible(y)),
            width=str(convert_to_int_if_possible(width)),
            height=str(convert_to_int_if_possible(height)),
            attrib=attrib,
            **extra,
        )
        self.__bbox = SVGBoundingBox(x, y, width, height)

    @property
    def bbox(self) -> SVGBoundingBox:
        return self.__bbox
