/**
 * CR-050: the Philippine address list (PSGC) in src/assets/address — region →
 * province → city / municipality → barangay, each linked to the one above by its
 * code. The files load only when asked (dynamic import, their own chunks): the
 * small three together, the barangays (6.6 MB) only once a city is picked.
 *
 * Don't import src/assets/address/index.js — it pulls every file in at once.
 */

const SMALL_WORDS = new Set(["of", "de", "del", "la", "las", "los", "and", "y"]);

/** "CITY OF ANTIPOLO" → "City of Antipolo"; keeps "(Pob.)", "II", "NCR"-style tokens readable. */
export const placeName = (raw = "") =>
  String(raw)
    .toLowerCase()
    .split(/(\s+|-|\()/)
    .map((word, i) => {
      if (!word.trim() || word === "-" || word === "(") return word;
      if (/^(i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3})$/.test(word)) return word.toUpperCase(); // roman numerals
      if (["ncr", "barmm", "car", "mimaropa", "calabarzon", "soccsksargen"].includes(word.replace(/[^a-z]/g, ""))) {
        return word.toUpperCase();
      }
      if (i > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("");

let smallLists = null;
/** { regions, provinces, cities } — loaded once. */
export const loadPsgc = () => {
  if (!smallLists) {
    smallLists = Promise.all([
      import("../assets/address/refregion.json"),
      import("../assets/address/refprovince.json"),
      import("../assets/address/refcitymun.json"),
    ]).then(([regions, provinces, cities]) => ({
      regions: regions.default,
      provinces: provinces.default,
      cities: cities.default,
    }));
  }
  return smallLists;
};

let barangayList = null;
/** Every barangay (loaded once, on demand). */
const loadAllBarangays = () => {
  if (!barangayList) {
    barangayList = import("../assets/address/refbrgy.json").then((m) => m.default);
  }
  return barangayList;
};

/** A city's barangays, sorted by name → [{ value, label }]. */
export const loadBarangays = async (cityMunCode) => {
  if (!cityMunCode) return [];
  const all = await loadAllBarangays();
  return all
    .filter((b) => b.citymunCode === cityMunCode)
    .map((b) => ({ value: b.brgyCode, label: placeName(b.brgyDesc) }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

const byLabel = (a, b) => a.label.localeCompare(b.label);

/** Dropdown options for each level, narrowed by the level above. */
export const regionOptions = (lists) =>
  (lists?.regions || []).map((r) => ({ value: r.regCode, label: placeName(r.regDesc) }));

export const provinceOptions = (lists, regionCode) =>
  (lists?.provinces || [])
    .filter((p) => p.regCode === regionCode)
    .map((p) => ({ value: p.provCode, label: placeName(p.provDesc) }))
    .sort(byLabel);

export const cityOptions = (lists, provinceCode) =>
  (lists?.cities || [])
    .filter((c) => c.provCode === provinceCode)
    .map((c) => ({ value: c.citymunCode, label: placeName(c.citymunDesc) }))
    .sort(byLabel);

/** The saved address text: "Street, Barangay, City, Province" (blank parts left out). */
export const buildAddress = ({ street, barangay, city, province }) =>
  [street, barangay, city, province]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(", ");
