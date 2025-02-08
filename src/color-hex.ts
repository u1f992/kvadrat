type RGBAColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};
export type ColorHex = string & { __colorHex: never };
export const colorHex = ({ r, g, b, a }: RGBAColor) =>
  ("#" +
    [r, g, b, a]
      .map((val) =>
        Math.max(0, Math.min(val, 255)).toString(16).padStart(2, "0"),
      )
      .join("")) as ColorHex;
