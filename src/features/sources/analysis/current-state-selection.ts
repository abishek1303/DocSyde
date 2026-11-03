import { discoverRepository, productRelevance } from "../context/discover-repository";

/** Sample distinct product areas before filling the bounded source budget. */
export function selectCurrentStatePaths(tree: string[]) {
  const eligible = tree.filter(path => !/(^|\/)(node_modules|vendor|dist|build|target|\.git|\.next|__tests__|tests?)(\/|$)|\.(test|spec)\./.test(path)
    && /\.(?:[cm]?[jt]sx?|py|go|rs|cs|java|kt)$/.test(path));
  const ranked = eligible.sort((a, b) => productRelevance(b) - productRelevance(a) || a.localeCompare(b, "en"));
  const selected = discoverRepository(tree).selected.map(file => file.path).slice(0, 3);
  const areas = new Set<string>();
  for (const path of ranked) {
    const area = path.split("/").slice(0, -1).join("/");
    if (areas.has(area) || selected.includes(path)) continue;
    areas.add(area); selected.push(path);
    if (selected.length === 16) break;
  }
  for (const path of ranked) if (selected.length < 16 && !selected.includes(path)) selected.push(path);
  return selected;
}
