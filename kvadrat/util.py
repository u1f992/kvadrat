import itertools
import typing

T = typing.TypeVar


def chunked(iterable: typing.Iterable[T], n: int) -> typing.Iterable[tuple[T, ...]]:
    return iter(lambda: tuple(itertools.islice(iter(iterable), n)), ())


def int_if_possible(value: "int | float") -> "int | float":
    return int(value) if isinstance(value, float) and value.is_integer() else value
