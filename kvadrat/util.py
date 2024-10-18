import itertools
import typing
import xml.etree.ElementTree as ET

T = typing.TypeVar


def chunked(iterable: typing.Iterable[T], n: int) -> typing.Iterable[tuple[T, ...]]:
    return iter(lambda: tuple(itertools.islice(iter(iterable), n)), ())


def convert_xml_to_str(xml: ET.Element, encoding: str = "utf-8") -> str:
    return ET.tostring(xml, encoding).decode(encoding)

EPSILON = 0.0001