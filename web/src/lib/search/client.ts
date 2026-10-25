// Main-thread wrapper around the search engine.
// Prefers a Web Worker (smooth typing); falls back to running on the page itself on older
// browsers (e.g. iPads before iOS 15 cannot start module workers) or if the worker doesn't answer.
import type { SearchResponse, Suggestion, Engine } from "./engine.ts";

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };
let seq = 0;
const pending = new Map<number, Pending>();
let backend: Promise<"worker" | "main"> | null = null;
let worker: Worker | null = null;
let mainEngine: Promise<Engine> | null = null;

const indexUrl = () => new URL((document.documentElement.dataset.searchIndex as string) || "/data/search.json", location.href).href;

function onWorkerMessage(ev: MessageEvent) {
  const p = pending.get(ev.data?.id);
  if (!p) return;
  pending.delete(ev.data.id);
  if (ev.data.error) p.reject(new Error(ev.data.error));
  else p.resolve(ev.data.result);
}

function startWorker(): Promise<boolean> {
  return new Promise((resolve) => {
    let w: Worker;
    try {
      w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    } catch {
      return resolve(false);
    }
    const timer = setTimeout(() => { w.terminate(); resolve(false); }, 8000);
    w.onerror = () => { clearTimeout(timer); w.terminate(); resolve(false); };
    w.onmessage = (ev) => {
      if (ev.data === "ready") {
        clearTimeout(timer);
        worker = w;
        w.onmessage = onWorkerMessage;
        resolve(true);
      }
    };
  });
}

function getBackend() {
  if (!backend) backend = startWorker().then((ok) => (ok ? "worker" : "main"));
  return backend;
}

function engineOnPage(): Promise<Engine> {
  if (!mainEngine) mainEngine = Promise.all([import("./engine.ts"), fetch(indexUrl()).then((r) => {
    if (!r.ok) throw new Error(`index ${r.status}`);
    return r.json();
  })]).then(([m, data]) => new m.Engine(data));
  mainEngine.catch(() => { mainEngine = null; });
  return mainEngine;
}

async function call<T>(type: string, query = "", opts: object = {}): Promise<T> {
  if ((await getBackend()) === "main") {
    const e = await engineOnPage();
    if (type === "search") return e.search(query, opts) as T;
    if (type === "suggest") return e.suggest(query) as T;
    return null as T;
  }
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, type, url: indexUrl(), query, opts });
  });
}

export const search = (query: string, opts: { limit?: number; typing?: boolean; deck?: string } = {}) =>
  call<SearchResponse>("search", query, opts);
export const suggest = (query: string) => call<Suggestion[]>("suggest", query);
/** Start downloading the index in the background (called when the visitor focuses the search box). */
export const warmUp = () => call("warm").catch(() => {});
