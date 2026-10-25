// Web Worker: loads the index once and answers search / suggest requests off the main thread,
// so typing stays smooth even on older tablets.
import { Engine, type SearchData } from "./engine.ts";

let engine: Engine | null = null;
let loading: Promise<void> | null = null;

function load(url: string) {
  if (!loading) loading = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`index ${r.status}`);
      return r.json();
    })
    .then((data: SearchData) => {
      engine = new Engine(data);
    });
  return loading;
}

(self as unknown as Worker).postMessage("ready");

self.onmessage = async (ev: MessageEvent) => {
  const { id, type, url, query, opts } = ev.data;
  try {
    await load(url);
    let result: unknown = null;
    if (type === "search") result = engine!.search(query, opts);
    else if (type === "suggest") result = engine!.suggest(query);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    loading = null;
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
