// Builds the data behind the "Map of ideas" explorer: public/data/explore.json (fetched only on /map/).
//
//   groups  — the knowledge graph's communities (Leiden) with plain-English names (ingest/kb/groups.json)
//   nodes   — every person, place, idea, word and letter on 2+ slides: its group, its strongest connections
//             (shared slides, weighted by how much more often than chance) and its most relevant slides
//   slides  — the slides those lists point to
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const DATA = new URL("../src/data/", import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, DATA), "utf8"));
const slides = read("slides.json");
const entities = read("entities.json");
const decks = read("decks.json");
const graph = read("graph.json");
const groupNames = JSON.parse(readFileSync(new URL("../../ingest/kb/groups.json", import.meta.url), "utf8")).groups as
  { name: string; icon: string; about: string; anchors: string[] }[];

export const COLORS = ["#1d3a6e", "#8a1c2b", "#1e6b3a", "#7a4b00", "#5b2a86", "#0f6b78", "#9c3d00", "#3b5b00", "#6b2f4b", "#2f4f6f"];
const N = slides.length;
const SKIP = new Set(["verse", "number"]);

// ---- groups: name each community after the curated group whose anchors it holds most
const byId = new Map(entities.map((e: any, i: number) => [e.id, i]));
const used = new Set<number>();
const groups = (graph.clusters as { id: string; label: string; members: string[] }[]).map((c, gi) => {
  const members = new Set(c.members);
  const labels = new Set(c.members.map((m) => entities[byId.get(m) as number]?.label));
  let best = -1, bestScore = 0;
  groupNames.forEach((g, k) => {
    if (used.has(k)) return;
    const score = g.anchors.filter((a) => members.has(a) || labels.has(a)).length;
    if (score > bestScore) { best = k; bestScore = score; }
  });
  if (best >= 0) used.add(best);
  const g = best >= 0 ? groupNames[best] : { name: c.label, icon: "•", about: "" };
  return { name: g.name, icon: g.icon, about: g.about, color: COLORS[gi % COLORS.length], members: c.members };
});
const groupOf = new Map<string, number>();
groups.forEach((g, gi) => g.members.forEach((m) => groupOf.set(m, gi)));

// ---- nodes
const keep: number[] = [];
entities.forEach((e: any, i: number) => { if (!SKIP.has(e.type) && e.slides.length >= 2) keep.push(i); });
const nodeOf = new Map(keep.map((ei, k) => [ei, k]));
const slideOut: [number, number, string][] = [];
const slideIdx = new Map<number, number>();
const deckIdx = new Map(decks.map((d: any, i: number) => [d.slug, i]));
const refSlide = (si: number) => {
  if (!slideIdx.has(si)) { slideIdx.set(si, slideOut.length); slideOut.push([deckIdx.get(slides[si].deck) as number, slides[si].n, slides[si].title]); }
  return slideIdx.get(si)!;
};
const nodes = keep.map((ei) => {
  const e = entities[ei];
  const mine = new Set<number>(e.slides);
  const counts = new Map<number, number>();
  for (const si of mine) for (const [oi] of slides[si].entities) if (oi !== ei && nodeOf.has(oi)) counts.set(oi, (counts.get(oi) ?? 0) + 1);
  const minShared = mine.size >= 4 ? 2 : 1;
  const nb = [...counts.entries()].filter(([, c]) => c >= minShared)
    .map(([oi, c]) => [oi, c, c * Math.log(1 + (c / mine.size) / (entities[oi].slides.length / N))] as const)
    .sort((a, b) => b[2] - a[2]).slice(0, 16).map(([oi, c]) => [nodeOf.get(oi)!, c]);
  // most relevant slides: those whose title names it first, then the knowledge graph's order; one per build-up, max 6
  const names = [e.label, ...(e.aliases ?? [])].map((x: string) => x.toLowerCase().replace(/\s*\(.*\)$/, "")).filter((x: string) => x.length >= 2);
  const at = (si: number) => Math.min(...names.map((x: string) => { const k = slides[si].title.toLowerCase().indexOf(x); return k < 0 ? 999 : k; }));
  const ordered = e.slides.map((si: number, rank: number) => [si, at(si) < 999 ? at(si) : 1000 + rank] as const)
    .sort((a: readonly [number, number], b: readonly [number, number]) => a[1] - b[1]).map(([si]: readonly [number, number]) => si);
  const seenGroup = new Set<number>();
  const top: number[] = [];
  for (const si of ordered) {
    if (seenGroup.has(slides[si].group)) continue;
    seenGroup.add(slides[si].group);
    top.push(refSlide(si));
    if (top.length >= 6) break;
  }
  const lessons = new Set(e.slides.map((si: number) => slides[si].deck)).size;
  return [e.label, e.type, e.url, e.slides.length, lessons, groupOf.get(e.id) ?? -1, nb, top, e.type === "word" ? e.lang ?? "" : "", e.id];
});

// group members as node indices, most-taught first
const groupsOut = groups.map((g) => ({
  name: g.name, icon: g.icon, about: g.about, color: g.color,
  members: g.members.map((m) => nodeOf.get(byId.get(m) as number)).filter((x): x is number => x !== undefined)
    .sort((a, b) => (nodes[b][3] as number) - (nodes[a][3] as number)),
})).filter((g) => g.members.length);

const out = { groups: groupsOut, nodes, slides: slideOut, decks: decks.map((d: any) => [d.slug, d.title]) };
mkdirSync(new URL("../public/data/", import.meta.url), { recursive: true });
const json = JSON.stringify(out);
writeFileSync(new URL("../public/data/explore.json", import.meta.url), json);
writeFileSync(new URL("../src/data/groups.json", import.meta.url), JSON.stringify(groupsOut.map((g) => ({ ...g, members: undefined, ids: g.members.map((m) => nodes[m][9]) }))));
writeFileSync(new URL("../src/data/explore-version.json", import.meta.url), JSON.stringify({ hash: createHash("sha1").update(json).digest("hex").slice(0, 10) }));
console.log(`explore: ${groupsOut.length} groups (${groupsOut.map((g) => g.name.split(/[ ,]/)[0]).join(", ")}), ${nodes.length} ideas, ` +
  `${slideOut.length} slides, ${(json.length / 1024).toFixed(0)} KB`);
