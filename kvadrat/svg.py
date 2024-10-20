import abc
import typing
import xml.etree.ElementTree as ET

import kvadrat.constants
import kvadrat.polygon
import kvadrat.util

_str = str


def str(xml: ET.Element, encoding: _str = "utf-8") -> _str:
    return ET.tostring(xml, encoding).decode(encoding)


class BoundingBox(typing.NamedTuple):
    x: typing.Union[int, float]
    y: typing.Union[int, float]
    width: typing.Union[int, float]
    height: typing.Union[int, float]


def _calculate_bbox(elements: "typing.Iterable[Element]") -> BoundingBox:
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

    x = min_x
    y = min_y
    width = max_x - min_x
    height = max_y - min_y

    x = kvadrat.util.int_if_possible(0 if x == float("inf") else x)
    y = kvadrat.util.int_if_possible(0 if y == float("inf") else y)
    # float("-inf") - float("inf") == float("-inf")
    width = kvadrat.util.int_if_possible(0 if width == float("-inf") else width)
    height = kvadrat.util.int_if_possible(0 if height == float("-inf") else height)

    return BoundingBox(x, y, width, height)


class Root(ET.Element):
    def __init__(
        self,
        elements: "typing.Iterable[Element]",
        attrib: dict[_str, _str] = {},
        **extra: _str,
    ) -> None:
        bbox = _calculate_bbox(elements)
        super().__init__(
            "svg",
            xmlns="http://www.w3.org/2000/svg",
            width=_str(bbox.width),
            height=_str(bbox.height),
            viewBox=f"{bbox.x} {bbox.y} {bbox.width} {bbox.height}",
            attrib=attrib,
            **extra,
        )
        for element in elements:
            self.append(element)


class Element(ET.Element, metaclass=abc.ABCMeta):
    @property
    @abc.abstractmethod
    def bbox(self) -> BoundingBox:
        raise NotImplementedError()

    @classmethod
    def from_polygon(
        cls,
        polygon: kvadrat.polygon.Polygon,
        attrib: dict[_str, _str] = {},
        **extra: _str,
    ) -> "Element":
        return (
            Polygon(polygon, attrib=attrib, **extra)
            if len(polygon.geoms) == 1
            else Group(
                [cls.from_polygon(p) for p in polygon.geoms], attrib=attrib, **extra
            )
        )


class Group(Element):
    def __init__(
        self,
        elements: "typing.Collection[Element]",
        attrib: dict[_str, _str] = {},
        **extra: _str,
    ) -> None:
        super().__init__("g", attrib=attrib, **extra)

        for element in elements:
            self.append(element)
        self.__bbox = _calculate_bbox(elements)

    @property
    def bbox(self) -> BoundingBox:
        return self.__bbox


def _get_polygon_attributes(polygon: kvadrat.polygon.Polygon):
    min_x, min_y, _, _ = polygon.bounds
    x = kvadrat.util.int_if_possible(min_x)
    y = kvadrat.util.int_if_possible(min_y)
    points = tuple(
        (kvadrat.util.int_if_possible(px - x), kvadrat.util.int_if_possible(py - y))
        for px, py in polygon.coords[0][:-1]
    )
    return {
        "x": _str(x),
        "y": _str(y),
        "points": " ".join(f"{px},{py}" for px, py in points),
    }


class Polygon(Element):
    def __init__(
        self,
        polygon: kvadrat.polygon.Polygon,
        attrib: dict[_str, _str] = {},
        **extra: _str,
    ) -> None:
        if len(polygon.geoms) != 1:
            raise RuntimeError()

        super().__init__(
            "polygon",
            attrib={**_get_polygon_attributes(polygon), **attrib},
            **extra,
        )

        x, y, max_x, max_y = polygon.bounds
        width = max_x - x
        height = max_y - y
        self.__bbox = BoundingBox(x, y, width, height)

    @property
    def bbox(self) -> BoundingBox:
        return self.__bbox


class Rect(Element):
    def __init__(
        self,
        rect: kvadrat.polygon.Polygon,
        attrib: dict[_str, _str] = {},
        **extra: _str,
    ) -> None:
        if not rect.is_rect():
            raise Exception()

        x, y, max_x, max_y = rect.bounds
        width = max_x - x
        height = max_y - y
        self.__bbox = BoundingBox(x, y, width, height)

        super().__init__(
            "rect",
            x=_str(self.__bbox.x),
            y=_str(self.__bbox.y),
            width=_str(self.__bbox.width),
            height=_str(self.__bbox.height),
            attrib=attrib,
            **extra,
        )

    @property
    def bbox(self) -> BoundingBox:
        return self.__bbox
