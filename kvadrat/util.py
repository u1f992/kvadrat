import itertools
import multiprocessing
import typing

T = typing.TypeVar

CPU_COUNT = multiprocessing.cpu_count()

def chunked(iterable: typing.Iterable[typing.Any], n: int) -> typing.Iterable[tuple[typing.Any, ...]]:
    return iter(lambda: tuple(itertools.islice(iter(iterable), n)), ())


def int_if_possible(value: "int | float") -> "int | float":
    return int(value) if isinstance(value, float) and value.is_integer() else value
