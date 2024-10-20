import argparse
import logging
import os
import sys
import typing

import PIL.Image  # type: ignore

from .bitmap import convert_bitmap_to_svg, RGBAColor
from .util import convert_xml_to_str


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=str)
    parser.add_argument("-o", "--output", type=str)
    args = parser.parse_args()

    bitmap = PIL.Image.open(args.input)
    if bitmap.mode != "RGBA":
        bitmap = bitmap.convert("RGBA")

    width, height = bitmap.size
    svg = convert_bitmap_to_svg(
        [
            [
                typing.cast(
                    RGBAColor,
                    bitmap.getpixel((x, y)),
                )
                for x in range(width)
            ]
            for y in range(height)
        ]
    )
    svg_str = convert_xml_to_str(svg)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(svg_str)
    else:
        print(svg_str)


if __name__ == "__main__":
    logger = logging.getLogger("kvadrat")
    logger.addHandler(logging.StreamHandler(sys.stderr))
    log_level = os.getenv("KVADRAT_LOG_LEVEL", "WARNING").lower()
    logger.setLevel(
        {
            "critical": logging.CRITICAL,
            "fatal": logging.CRITICAL,
            "error": logging.ERROR,
            "warning": logging.WARNING,
            "warn": logging.WARNING,
            "info": logging.INFO,
            "debug": logging.DEBUG,
            "notset": logging.NOTSET,
        }.get(log_level, logging.WARNING)
    )

    main()
