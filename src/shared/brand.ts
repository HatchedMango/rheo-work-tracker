import identity from './brand.json' with { type: 'json' };

export { identity };
// One unioned outline: painting separate strokes leaves antialiasing seams at the join.
export const brandPath = identity.outline.map((command) => command.join(' ')).join(' ');

// The browser tile and native tile use the same layout inside their platform canvas.
export function brandTileSvg() {
  const { viewBox, tile, tileColor, markColor } = identity;
  const scale = (viewBox - tile.markInset * 2) / viewBox;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox} ${viewBox}"><rect width="${viewBox}" height="${viewBox}" rx="${tile.cornerRadius}" fill="rgb(${tileColor.join(' ')})"/><path transform="translate(${tile.markInset} ${tile.markInset}) scale(${scale})" fill="rgb(${markColor.join(' ')})" d="${brandPath}"/></svg>`;
}
