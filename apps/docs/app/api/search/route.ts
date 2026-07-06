import { createTokenizer } from "@orama/tokenizers/japanese";
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// `source` has i18n enabled, so `createFromSource` builds one Orama index
// per locale (fumadocs-core auto-detects `source._i18n`). Orama's default
// tokenizer doesn't support Japanese (`create({ language: "ja" })` throws
// `LANGUAGE_NOT_SUPPORTED`), so `ja` gets a real CJK-aware tokenizer from
// `@orama/tokenizers` instead — Orama has no built-in Japanese segmenter,
// and `threshold: 0, tolerance: 0` disable the English-tuned typo-tolerance
// defaults, which don't make sense for a tokenizer with no notion of "typo"
// distance between Japanese tokens.
export const { GET } = createFromSource(source, {
  localeMap: {
    en: { language: "english" },
    ja: {
      components: { tokenizer: createTokenizer() },
      search: { threshold: 0, tolerance: 0 },
    },
  },
});
