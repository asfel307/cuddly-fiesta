// Token Radar — the entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the model
// in lib/model.ts, and writes the whole entry to the output directory:
//   board.json      the ranked board (rows with implied values and farm plans)
//   data.js         the dashboard's dataset, as one script beside the page
//   dashboard/      the static page (index.html, app.css, app.js, data.js)
//   screenshots/    the three screenshots of the page
//   dossier.json    the judge's dossier, written by the vendored library
//
// The dashboard is a static page with no framework and no network: it reads
// data.js, which this program writes from the same board the gate scores,
// so the page and the board can never disagree.
//
// Run it outside the grader's container with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardIssue, buildBoard, modelSummary, parseSnapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// The dossier's text cap, and the screenshot and dashboard caps the gate
// enforces. These are the scorer's own limits; the program refuses to write
// an entry that breaks them.
const DOSSIER_TEXT_BYTES = 65_536;
const SHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const PAGE_LIMIT = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// One --name <value> argument, or the fallback when it is absent.
function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  const at = argv.indexOf("--" + name);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1] as string;
  const joined = argv.find((a) => a.startsWith("--" + name + "="));
  if (joined !== undefined) return joined.slice(name.length + 3);
  return fallback;
}

const inputArg = flagValue("input", "/input");
const inputPath = inputArg.endsWith(".json")
  ? inputArg
  : join(inputArg, "snapshot.json");
if (!existsSync(inputPath)) {
  process.stderr.write(
    "token radar: no snapshot at " + inputPath + ": pass --input <snapshot.json|directory>\n",
  );
  process.exit(2);
}
const outDir = flagValue("output", process.env.MAKEFUN_OUTPUT_DIR ?? "/output");

const snapshot = parseSnapshot(readFileSync(inputPath, "utf8"));
const { rows, multiples, liveTop } = buildBoard(snapshot);
const problem = boardIssue(rows, snapshot);
if (problem !== null) {
  process.stderr.write("token radar: the model wrote a board the gate refuses: " + problem + "\n");
  process.exit(1);
}

// The dashboard's dataset: the board, the live-token comparison set, and the
// model's own calibration, as one script the page reads with no network.
const dataset = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  model_version: "radar-2",
  global_multiple: Math.round(multiples.global * 10000) / 10000,
  categories: modelSummary(multiples),
  watchlist_size: snapshot.watchlist.length,
  board_size: rows.length,
  live_size: liveTop.length,
  rows,
  live: liveTop,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows }) + "\n");
writeFileSync(
  join(outDir, "data.js"),
  "window.TOKEN_RADAR=" + JSON.stringify(dataset) + ";\n",
);

// Copy one directory's regular files into `to`, skipping dotfiles.
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith(".")) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pageFiles = copyDir(join(rootDir, "dashboard"), join(outDir, "dashboard"));
const shotFiles = copyDir(join(rootDir, "screenshots"), join(outDir, "screenshots"));
if (shotFiles.length < 3) {
  process.stderr.write(
    "token radar: screenshots/ holds " + shotFiles.length + " image(s): hand in 3, the board, a detail view and a filtered view\n",
  );
  process.exit(1);
}
for (const name of shotFiles) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(
      "token radar: screenshots/" + name + ": a name is letters, digits and . _ -, 1 to 128 characters\n",
    );
    process.exit(1);
  }
}
// data.js belongs beside the page, so the page reads it with no network.
copyFileSync(join(outDir, "data.js"), join(outDir, "dashboard", "data.js"));

// The dossier is written last: the scorer rebuilds it from this output
// directory and compares bytes, so it must see the finished files.
const dossier = buildDossier(outDir, {
  text_max_bytes: DOSSIER_TEXT_BYTES,
  screenshots: SHOT_LIMIT,
  dashboard: PAGE_LIMIT,
});
writeFileSync(join(outDir, "dossier.json"), dossier);

const watchlistRows = rows.filter((r) => r.watchlist).length;
process.stdout.write(
  "token radar: " + snapshot.protocols.length + " protocols, " + snapshot.watchlist.length +
    " on the watchlist, " + rows.length + " rows scored (" + watchlistRows + " watchlist, " +
    liveTop.length + " live set aside)\n" +
    "token radar: wrote " + join(outDir, "board.json") + ", " + join(outDir, "data.js") +
    ", " + join(outDir, "dashboard") + " (" + pageFiles.length + " files), " +
    join(outDir, "screenshots") + " (" + shotFiles.length + " images) and " +
    join(outDir, "dossier.json") + "\n",
);
