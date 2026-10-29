// "Delete my account": removes the auth user; foreign keys cascade to every table holding their data.
// usage_log rows are kept but detached from the user (user_id set null) so spend accounting stays correct.
import { authenticate } from "../_shared/auth.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";

serve(async (req) => {
  const { user, service } = await authenticate(req);
  const body = await readJson(req);
  if (body.confirm !== "DELETE") {
    throw new HttpError(400, 'Send {"confirm":"DELETE"} to confirm.', "confirm_required");
  }
  const { error } = await service.auth.admin.deleteUser(user.id);
  if (error) throw error;
  return json({ ok: true });
});
