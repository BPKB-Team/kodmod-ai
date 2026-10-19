export function findGridNeighbor(rects, focusedIndex, direction) {
  const current = rects[focusedIndex];
  if (!current) return -1;

  const originX = current.left + current.width / 2;
  const originY = current.top + current.height / 2;
  let nearestIndex = -1;
  let nearestScore = Number.POSITIVE_INFINITY;

  for (let index = 0; index < rects.length; index += 1) {
    const candidate = rects[index];
    if (!candidate || index === focusedIndex) continue;

    const deltaX = candidate.left + candidate.width / 2 - originX;
    const deltaY = candidate.top + candidate.height / 2 - originY;
    let primary;
    let secondary;

    if (direction === "ArrowRight" && deltaX > 0) {
      primary = deltaX;
      secondary = Math.abs(deltaY);
    } else if (direction === "ArrowLeft" && deltaX < 0) {
      primary = Math.abs(deltaX);
      secondary = Math.abs(deltaY);
    } else if (direction === "ArrowDown" && deltaY > 0) {
      primary = deltaY;
      secondary = Math.abs(deltaX);
    } else if (direction === "ArrowUp" && deltaY < 0) {
      primary = Math.abs(deltaY);
      secondary = Math.abs(deltaX);
    } else {
      continue;
    }

    const score = primary + secondary * 2;
    if (score < nearestScore) {
      nearestIndex = index;
      nearestScore = score;
    }
  }

  return nearestIndex;
}
