// Turns a raw note into Topic / Key idea / Recall question / Apply it / Category.
// Does not save anything: the client shows a preview, the user edits, then the client saves the entry.
import { aiFailureBody, runTool } from "../_shared/ai.ts";
import { authenticate } from "../_shared/auth.ts";
import { json, readJson, serve } from "../_shared/http.ts";
import { profileLine, STRUCTURE_SYSTEM, tools, wrap } from "../_shared/prompts.ts";
import { parseInput, StructuredNote, StructureInput } from "../_shared/schemas.ts";

serve(async (req) => {
  const { user, db, service } = await authenticate(req);
  const input = parseInput(StructureInput, await readJson(req));
  const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();

  const out = await runTool({
    service,
    userId: user.id,
    action: "structure",
    system: STRUCTURE_SYSTEM,
    user: `${profileLine(profile)}\n${wrap("note", input.raw_text)}`,
    tool: tools.structure,
    schema: StructuredNote,
  });
  if (!out.ok) return json(aiFailureBody(out));
  return json({ ok: true, note: out.data, quota: out.quota });
});
