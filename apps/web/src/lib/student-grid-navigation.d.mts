export type GridArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
export type GridCardRect = Pick<DOMRect, "left" | "top" | "width" | "height"> | null;

export function findGridNeighbor(
  rects: readonly GridCardRect[],
  focusedIndex: number,
  direction: GridArrowKey,
): number;
