// Home-level commitlint config, deployed as ~/.commitlintrc.mjs and used by
// every personal repo: the global commit-msg hook falls back to it when a
// repo has no config of its own. Repo configs extend it and only add scopes
// (chezmoi's commitlint.config.mjs, infra's ci/commitlint-base.mjs copy).
//
// The base is the official @commitlint/config-conventional; only the rules
// below deviate from it, each with its reason.
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PRESET = "@commitlint/config-conventional";

// Every commitlint CLI ships config-conventional as a dependency (Homebrew's
// formula bundles it, CI installs it from a lockfile), but extending it by
// name fails from $HOME, where node finds no node_modules. Resolve it next to
// the running CLI first, then next to this file, then from the cwd.
function resolvePreset() {
  const bases = [];
  try {
    bases.push(realpathSync(process.argv[1]));
  } catch {
    // not run from a CLI script
  }
  bases.push(fileURLToPath(import.meta.url), `${process.cwd()}/`);
  for (const base of bases) {
    try {
      return createRequire(base).resolve(PRESET);
    } catch {
      // try the next base
    }
  }
  throw new Error(`cannot resolve ${PRESET} from the commitlint CLI, ${bases.slice(1).join(" or ")}`);
}

// No attribution trailers: a commit is its author's own work, whatever tools
// or people helped. Any Co-authored-by line (a pairing partner, a bot, an AI
// tool, or the one a forge adds when it squashes someone else's commits) and
// a "Generated with/by" line naming an AI tool.
const AI_TOOL = /\b(copilot|claude|anthropic|openai|chatgpt|gemini|cursor|codex|aider)\b/i;
const CO_AUTHOR = /^co-authored-by:/i;
const GENERATED = /^(🤖\s*)?generated (with|by)\b/i;

function noAttributionTrailers({ raw }) {
  const offending = (raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) => !line.startsWith("#") && (CO_AUTHOR.test(line) || (GENERATED.test(line) && AI_TOOL.test(line))),
    );
  return [
    offending.length === 0,
    `remove the attribution line${offending.length > 1 ? "s" : ""}: ${offending.join(" | ")}`,
  ];
}

// Renovate's update headers, in the shared preset's wording `update <topic>
// from <old> to <new> (<type>)`: image-cve-alert reads the topic, both
// versions and the type from them to fast-track CVE fixes, and a long image
// tag runs one to 93 characters. They may use config-conventional's own 100;
// every other header keeps 72. The optional ` (#N)` is image-cve-alert's own
// squash of an expedited fix, retitled fix(security).
const RENOVATE_UPDATE = /^(chore|fix)\((deps|security)\): update .+ from \S+ to \S+ \(\w+\)( \(#\d+\))?$/;

function humanHeaderMaxLength({ header }, when = "always", max = 72) {
  const h = header ?? "";
  return [
    RENOVATE_UPDATE.test(h) || h.length <= max,
    `header must not be longer than ${max} characters (Renovate's update headers may run to 100)`,
  ];
}

export default {
  extends: [resolvePreset()],
  // commitlint keeps one inline plugin object: a repo config that adds plugin
  // rules of its own replaces these
  plugins: [
    {
      rules: {
        "no-attribution-trailers": noAttributionTrailers,
        "human-header-max-length": humanHeaderMaxLength,
      },
    },
  ],
  helpUrl: "https://www.conventionalcommits.org/en/v1.0.0/",
  rules: {
    // git and GitHub convention (GitHub truncates longer titles): 72, except
    // Renovate's update headers, which keep the preset's 100 (see above)
    "header-max-length": [2, "always", 100],
    "human-header-max-length": [2, "always", 72],
    // git log indents bodies by 4 columns, so 72 fits 80; preset: 100
    "body-max-line-length": [2, "always", 72],
    // Preset warning, off: a wrapped body line starting with `word: ` parses
    // as a trailer token, so it only ever fired as a false positive
    "footer-leading-blank": [0],
    // Scopes are project-specific: fix the case, leave the values to repos
    "scope-case": [2, "always", "lower-case"],
    "no-attribution-trailers": [2, "always"],
  },
};
