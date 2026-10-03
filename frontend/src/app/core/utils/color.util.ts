/** `#rrggbb` → `rgba(r, g, b, alpha)`; anything else is returned unchanged. */
export function withAlpha(hexColor: string, alpha: number): string {
  const match = /^#?([a-f\d]{6})$/i.exec(hexColor.trim());
  if (!match) return hexColor;
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
