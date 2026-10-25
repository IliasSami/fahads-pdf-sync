// Type-to-filter for long lists (words, topics, pictures). Matches every typed word, ignores accents.
const fold = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
document.querySelectorAll<HTMLInputElement>("input[data-filter]").forEach((input) => {
  const items = () => document.querySelectorAll<HTMLElement>(input.dataset.filter!);
  const apply = () => {
    const words = fold(input.value).split(/\s+/).filter(Boolean);
    document.documentElement.classList.toggle("filtering", words.length > 0);   // filtering searches the collapsed rest of long lists too
    const typeSel = document.querySelector<HTMLButtonElement>(".filter-row button[aria-pressed='true']")?.dataset.type ?? "";
    items().forEach((el) => {
      const text = fold(el.dataset.text ?? el.textContent ?? "");
      const typeOk = !typeSel || (el.dataset.type ?? "").split(" ").includes(typeSel);
      el.hidden = !typeOk || !words.every((w) => text.includes(w));
    });
    document.querySelectorAll<HTMLElement>("[data-count-for]").forEach((c) => {
      c.textContent = String([...items()].filter((el) => !el.hidden).length);
    });
  };
  input.addEventListener("input", apply);
  document.querySelectorAll<HTMLButtonElement>(".filter-row button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".filter-row button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      apply();
    }));
  const q = new URLSearchParams(location.search).get("filter");
  if (q) { input.value = q; apply(); }
});

// "Show all" buttons under long lists
document.querySelectorAll<HTMLButtonElement>(".show-all-btn").forEach((b) => b.addEventListener("click", () => {
  b.closest(".collapsible-list")?.classList.add("show-all");
  b.hidden = true;
}));
