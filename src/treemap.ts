// A squarified treemap layout. Given a rectangle and a set of weighted items,
// it packs them into sub-rectangles whose areas are proportional to the weights
// while keeping each rectangle as close to square as possible. This is what lets
// the board "fill up" with project boxes that read at a glance.

export interface TreemapItem {
  id: string;
  weight: number;
}

export interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function worstRatio(row: TreemapItem[], length: number, totalWeight: number, area: number): number {
  // `area` is total pixel area for the remaining weight; convert weights to px area.
  const scale = area / totalWeight;
  let maxArea = -Infinity;
  let minArea = Infinity;
  let sum = 0;
  for (const item of row) {
    const a = item.weight * scale;
    sum += a;
    if (a > maxArea) maxArea = a;
    if (a < minArea) minArea = a;
  }
  const s2 = sum * sum;
  const l2 = length * length;
  return Math.max((l2 * maxArea) / s2, s2 / (l2 * minArea));
}

export function squarify(items: TreemapItem[], container: Box): Rect[] {
  const result: Rect[] = [];
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  if (totalWeight <= 0 || container.w <= 0 || container.h <= 0) return result;

  const totalArea = container.w * container.h;
  // Work on a queue sorted by weight descending for better squarification.
  const queue = [...items].filter((i) => i.weight > 0).sort((a, b) => b.weight - a.weight);

  let box: Box = { ...container };
  let remainingWeight = totalWeight;
  let row: TreemapItem[] = [];

  const layoutRow = (rowItems: TreemapItem[], rowWeight: number) => {
    const rowArea = (rowWeight / totalWeight) * totalArea;
    const horizontal = box.w >= box.h;
    // The side we lay the row along.
    const sideLength = horizontal ? box.h : box.w;
    const thickness = sideLength > 0 ? rowArea / sideLength : 0;
    let offset = 0;
    for (const item of rowItems) {
      const itemArea = (item.weight / totalWeight) * totalArea;
      const length = thickness > 0 ? itemArea / thickness : 0;
      if (horizontal) {
        result.push({ id: item.id, x: box.x, y: box.y + offset, w: thickness, h: length });
      } else {
        result.push({ id: item.id, x: box.x + offset, y: box.y, w: length, h: thickness });
      }
      offset += length;
    }
    // Shrink the box by the consumed thickness.
    if (horizontal) {
      box = { x: box.x + thickness, y: box.y, w: box.w - thickness, h: box.h };
    } else {
      box = { x: box.x, y: box.y + thickness, w: box.w, h: box.h - thickness };
    }
  };

  let rowWeight = 0;
  while (queue.length > 0) {
    const item = queue[0];
    const side = Math.min(box.w, box.h);
    const remainingArea = (remainingWeight / totalWeight) * totalArea;

    const currentWorst = row.length > 0 ? worstRatio(row, side, remainingWeight, remainingArea) : Infinity;
    const withItem = worstRatio([...row, item], side, remainingWeight, remainingArea);

    if (row.length === 0 || withItem <= currentWorst) {
      row.push(item);
      rowWeight += item.weight;
      queue.shift();
    } else {
      layoutRow(row, rowWeight);
      remainingWeight -= rowWeight;
      row = [];
      rowWeight = 0;
    }
  }
  if (row.length > 0) {
    layoutRow(row, rowWeight);
  }

  return result;
}
