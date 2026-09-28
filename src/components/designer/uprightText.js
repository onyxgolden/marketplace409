// Keep labels readable on rotated pieces.

/**
 * When a piece is turned past 90 and up to 270 degrees its label would read
 * upside down, so flip the text 180 degrees about its own anchor (x, y) in
 * the piece's frame. Returns undefined (no transform) otherwise.
 */
export function uprightTextTransform(rotationDeg, x = 0, y = 0) {
  const r = (((rotationDeg || 0) % 360) + 360) % 360;
  return r > 90 && r <= 270 ? `rotate(180 ${x} ${y})` : undefined;
}
