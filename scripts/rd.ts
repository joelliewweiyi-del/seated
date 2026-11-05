// Rijksdriehoek (RD New, EPSG:28992) <-> WGS84, with the usual approximation series (Schreutelaar). Good to
// about a metre in the Netherlands, which is plenty for a 4 m grid.

export function rdToWgs(x: number, y: number): { lat: number; lng: number } {
  const dX = (x - 155000) * 1e-5;
  const dY = (y - 463000) * 1e-5;
  const n =
    3235.65389 * dY -
    32.58297 * dX ** 2 -
    0.2475 * dY ** 2 -
    0.84978 * dX ** 2 * dY -
    0.0655 * dY ** 3 -
    0.01709 * dX ** 2 * dY ** 2 -
    0.00738 * dX +
    0.0053 * dX ** 4 -
    0.00039 * dX ** 2 * dY ** 3 +
    0.00033 * dX ** 4 * dY -
    0.00012 * dX * dY;
  const e =
    5260.52916 * dX +
    105.94684 * dX * dY +
    2.45656 * dX * dY ** 2 -
    0.81885 * dX ** 3 +
    0.05594 * dX * dY ** 3 -
    0.05607 * dX ** 3 * dY +
    0.01199 * dY -
    0.00256 * dX ** 3 * dY ** 2 +
    0.00128 * dX * dY ** 4 +
    0.00022 * dY ** 2 -
    0.00022 * dX ** 2 +
    0.00026 * dX ** 5;
  return { lat: 52.15517440 + n / 3600, lng: 5.38720621 + e / 3600 };
}

export function wgsToRd(lat: number, lng: number): { x: number; y: number } {
  const dF = 0.36 * (lat - 52.1551744);
  const dL = 0.36 * (lng - 5.38720621);
  const x =
    155000 +
    190094.945 * dL -
    11832.228 * dF * dL -
    114.221 * dF ** 2 * dL -
    32.391 * dL ** 3 -
    0.705 * dF -
    2.34 * dF ** 3 * dL -
    0.608 * dF * dL ** 3 +
    0.008 * dL ** 2 +
    0.148 * dF ** 2 * dL ** 3;
  const y =
    463000 +
    309056.544 * dF +
    3638.893 * dL ** 2 +
    73.077 * dF ** 2 -
    157.984 * dF * dL ** 2 +
    59.788 * dF ** 3 +
    0.433 * dL -
    6.439 * dF ** 2 * dL ** 2 -
    0.032 * dF * dL +
    0.092 * dL ** 4 -
    0.054 * dF * dL ** 4;
  return { x, y };
}
