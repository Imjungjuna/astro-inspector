/**
 * True when `lineText` at 1-based `column` starts the source tag, e.g.
 * `<Card ` or `<a>`. Registration and MCP resolution share this check so a
 * token can never resolve to a location its tag does not occupy.
 */
export function pointsToSourceTag(
  lineText: string,
  column: number,
  sourceTag: string
): boolean {
  const sourceAtLocation = lineText.slice(column - 1);
  const tagPrefix = `<${sourceTag}`;
  const boundary = sourceAtLocation[tagPrefix.length];
  return (
    sourceAtLocation.startsWith(tagPrefix) &&
    (boundary === undefined || /[\s/>]/u.test(boundary))
  );
}
