import { checkLoginRate, clean, clearPinCookie, methodAllowed, readBody, recordLogin, safeEqual, sendError, sendJson, setSessionCookie } from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST", "DELETE"])) return;

  if (req.method === "DELETE") {
    clearPinCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  const expected = clean(process.env.AUTO_DASHBOARD_PIN);
  if (!expected) {
    sendJson(res, 403, { error: "AUTO_DASHBOARD_PIN belum diset di Vercel Environment." });
    return;
  }
  if (!checkLoginRate(req, res)) return;

  try {
    const body = await readBody(req);
    const pin = clean(body.pin);
    if (!safeEqual(pin, expected)) {
      recordLogin(req, false);
      sendJson(res, 401, { error: "PIN dashboard salah." });
      return;
    }
    recordLogin(req, true);
    setSessionCookie(res);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error, 400);
  }
}
