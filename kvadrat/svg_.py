from __future__ import annotations

import abc
import re
import typing
import xml.etree.ElementTree as ET

import shapely  # type: ignore

import kvadrat.polygon
import kvadrat.util

_str = str


def str(xml: ET.Element, encoding: _str = "utf-8") -> _str:
    return ET.tostring(xml, encoding).decode(encoding)


def _calculate_bbox(
    elements: "typing.Iterable[Element]",
) -> kvadrat.polygon.BoundingBox:
    min_x = float("inf")
    min_y = float("inf")
    max_x = float("-inf")
    max_y = float("-inf")

    for element in elements:
        bbox = element.bbox
        min_x = min(min_x, bbox[0])
        min_y = min(min_y, bbox[1])
        max_x = max(max_x, bbox[0] + bbox[2])
        max_y = max(max_y, bbox[1] + bbox[3])

    x = min_x
    y = min_y
    width = max_x - min_x
    height = max_y - min_y

    x = kvadrat.util.int_if_possible(0 if x == float("inf") else x)
    y = kvadrat.util.int_if_possible(0 if y == float("inf") else y)
    # float("-inf") - float("inf") == float("-inf")
    width = kvadrat.util.int_if_possible(0 if width == float("-inf") else width)
    height = kvadrat.util.int_if_possible(0 if height == float("-inf") else height)

    return x, y, width, height


class Root(ET.Element):
    def __init__(
        self,
        elements: typing.Iterable[Element],
        attrib: dict[_str, _str] = {},
        **extra: _str,
    ) -> None:
        bbox = _calculate_bbox(elements)
        super().__init__(
            "svg",
            xmlns="http://www.w3.org/2000/svg",
            width=_str(bbox[2]),
            height=_str(bbox[3]),
            viewBox=f"{bbox[0]} {bbox[1]} {bbox[2]} {bbox[3]}",
            attrib=attrib,
            **extra,
        )
        for element in elements:
            self.append(element)


class Element(ET.Element, metaclass=abc.ABCMeta):
    @property
    @abc.abstractmethod
    def bbox(self) -> kvadrat.polygon.BoundingBox:
        raise NotImplementedError()

    @classmethod
    def from_polygon(
        cls,
        polygon: shapely.Polygon | shapely.MultiPolygon,
        attrib: dict[_str, _str] = {},
        **extra: _str,
    ) -> "Element":
        if isinstance(polygon, shapely.Polygon):
            if len(polygon.interiors) == 0:
                # `shapely.Polygon` without interiors can probably be represented by `Polygon` or `Rect`
                # Choose the shortest one
                svg_polygon = Polygon(polygon, attrib=attrib, **extra)
                if kvadrat.polygon.is_rect(polygon):
                    svg_rect = Rect(polygon, attrib=attrib, **extra)
                    if len(str(svg_rect)) < len(str(svg_polygon)):
                        return svg_rect
                return svg_polygon

            else:
                return Path(polygon, attrib=attrib, **extra)
        else:
            # `polygon` must be normalized before they are used,
            # but polygons inside of MultiPolygon need to be renormalized individually.
            return Group(
                [cls.from_polygon(kvadrat.polygon.normalize(p)) for p in polygon.geoms],
                attrib=attrib,
                **extra,
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
    def bbox(self) -> kvadrat.polygon.BoundingBox:
        return self.__bbox


class Polygon(Element):
    def __init__(
        self,
        polygon: shapely.Polygon,
        attrib: dict[_str, _str] = {},
        **extra: _str,
    ) -> None:
        self.__bbox = kvadrat.polygon.bbox(polygon)
        rounded = map(
            lambda xy: (
                kvadrat.util.int_if_possible(xy[0]),
                kvadrat.util.int_if_possible(xy[1]),
            ),
            polygon.exterior.coords[:-1],
        )
        points_str = " ".join(f"{x},{y}" for x, y in rounded)
        super().__init__(
            "polygon",
            points=points_str,
            attrib=attrib,
            **extra,
        )

    @property
    def bbox(self) -> kvadrat.polygon.BoundingBox:
        return self.__bbox


class Rect(Element):
    def __init__(
        self,
        rect: shapely.Polygon,
        attrib: dict[_str, _str] = {},
        **extra: _str,
    ) -> None:
        if not kvadrat.polygon.is_rect(rect):
            raise RuntimeError()

        self.__bbox = kvadrat.polygon.bbox(rect)

        super().__init__(
            "rect",
            x=_str(self.__bbox[0]),
            y=_str(self.__bbox[1]),
            width=_str(self.__bbox[2]),
            height=_str(self.__bbox[3]),
            attrib=attrib,
            **extra,
        )

    @property
    def bbox(self) -> kvadrat.polygon.BoundingBox:
        return self.__bbox


class PathCommand(metaclass=abc.ABCMeta):
    @abc.abstractmethod
    def __str__(self) -> _str:
        raise NotImplementedError()

    @classmethod
    def parse(cls, d: _str) -> "tuple[PathCommand, ...]":
        commands: list[PathCommand] = []
        patterns: dict[_str, typing.Callable[[_str], PathCommand]] = {
            "M": MoveTo,
            "m": moveTo,
            "L": LineTo,
            "l": lineTo,
            "Z": ClosePath,
            "z": ClosePath,
        }

        while d:
            for key, command_cls in patterns.items():
                pattern = re.compile(rf"^\s*{key}[^{''.join(patterns.keys())}]*")
                matched = pattern.match(d)
                if matched:
                    command_str = matched.group().strip()
                    command_instance = command_cls(command_str)
                    commands.append(command_instance)
                    d = d[len(command_str) :].lstrip()
                    break
            else:
                raise ValueError(f"unknown command format: {d}")

        return tuple(commands)


class MoveTo(PathCommand):
    def __init__(self, d: _str):
        pattern = re.compile(
            r"^\s*M\s*(-?\d+(?:\.\d+)?)(?:(?:\s*,)?\s*)(-?\d+(?:\.\d+)?)\s*$"
        )
        matched = pattern.match(d)
        if not matched:
            raise ValueError("invalid command format")
        self.__x = kvadrat.util.int_if_possible(float(matched.group(1)))
        self.__y = kvadrat.util.int_if_possible(float(matched.group(2)))

    def __str__(self) -> _str:
        return f"M {self.__x} {self.__y}"


class moveTo(PathCommand):
    def __init__(self, d: _str):
        pattern = re.compile(
            r"^\s*m\s*(-?\d+(?:\.\d+)?)(?:(?:\s*,)?\s*)(-?\d+(?:\.\d+)?)\s*$"
        )
        matched = pattern.match(d)
        if not matched:
            raise ValueError("invalid command format")
        self.__dx = kvadrat.util.int_if_possible(float(matched.group(1)))
        self.__dy = kvadrat.util.int_if_possible(float(matched.group(2)))

    def __str__(self) -> _str:
        return f"m {self.__dx} {self.__dy}"


class LineTo(PathCommand):
    def __init__(self, d: _str):
        pattern = re.compile(
            r"^\s*L\s*(-?\d+(?:\.\d+)?)(?:(?:\s*,)?\s*)(-?\d+(?:\.\d+)?)\s*$"
        )
        matched = pattern.match(d)
        if not matched:
            raise ValueError("invalid command format")
        self.__x = kvadrat.util.int_if_possible(float(matched.group(1)))
        self.__y = kvadrat.util.int_if_possible(float(matched.group(2)))

    def __str__(self) -> _str:
        return f"L {self.__x} {self.__y}"


class lineTo(PathCommand):
    def __init__(self, d: _str):
        pattern = re.compile(
            r"^\s*l\s*(-?\d+(?:\.\d+)?)(?:(?:\s*,)?\s*)(-?\d+(?:\.\d+)?)\s*$"
        )
        matched = pattern.match(d)
        if not matched:
            raise ValueError("invalid command format")
        self.__dx = kvadrat.util.int_if_possible(float(matched.group(1)))
        self.__dy = kvadrat.util.int_if_possible(float(matched.group(2)))

    def __str__(self) -> _str:
        return f"l {self.__dx} {self.__dy}"


class ClosePath(PathCommand):
    def __init__(self, d: _str):
        pattern = re.compile(r"^\s*[Zz]\s*$")
        matched = pattern.match(d)
        if not matched:
            raise ValueError("invalid command format")

    def __str__(self) -> _str:
        return "z"


class Path(Element):
    def __init__(
        self,
        polygon: shapely.Polygon,
        attrib: dict[_str, _str] = {},
        **extra: _str,
    ) -> None:
        self.__bbox = kvadrat.polygon.bbox(polygon)
        svg_path = ET.fromstring(polygon.svg())
        commands = list(PathCommand.parse(svg_path.get("d", "")))
        d = " ".join(map(_str, commands))
        super().__init__("path", d=d, attrib=attrib, **extra)

    @property
    def bbox(self) -> kvadrat.polygon.BoundingBox:
        return self.__bbox
