// Looks up what a thin note refers to ("the 20 formulas for LinkedIn hooks") on the web, then returns a study card
// built from what was found, plus the real source pages. Nothing is saved: the app previews it and the user edits.
import { aiFailureBody, runResearch } from "../_shared/ai.ts";
import { authenticate } from "../_shared/auth.ts";
import { json, readJson, serve } from "../_shared/http.ts";
import { profileLine, RESEARCH_SYSTEM, tools, wrap } from "../_shared/prompts.ts";
import { parseInput, ResearchedNote, StructureInput } from "../_shared/schemas.ts";

const isWebUrl = (u: string) => /^https?:\/\//i.test(u);

serve(async (req) => {
  const { user, db, service } = await authenticate(req);
  const input = parseInput(StructureInput, await readJson(req));
  const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();

  const out = await runResearch({
    service,
    userId: user.id,
    system: RESEARCH_SYSTEM,
    user: `${profileLine(profile)}\n${wrap("note", input.raw_text)}`,
    tool: tools.research,
    schema: ResearchedNote,
  });
  if (!out.ok) return json(aiFailureBody(out));

  const { data: card, results } = out.data;
  const byUrl = new Map(results.map((r) => [r.url, r]));
  // Only links that really came back from the search; if Claude named none that match, show the top few results.
  let sources = card.source_urls.filter((u) => byUrl.has(u) && isWebUrl(u)).map((u) => byUrl.get(u)!);
  if (card.found && sources.length === 0) sources = results.filter((r) => isWebUrl(r.url)).slice(0, 3);
  sources = sources.slice(0, 5).map((s) => ({ url: s.url, title: s.title.slice(0, 160) }));

  return json({
    ok: true,
    found: card.found && card.details.length > 0,
    note: {
      topic: card.topic,
      key_idea: card.key_idea,
      recall_question: card.recall_question,
      apply_it: card.apply_it,
      category: card.category,
    },
    details: card.details,
    sources,
    quota: out.quota,
  });
});
