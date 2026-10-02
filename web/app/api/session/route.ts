import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 jours

// Rate limiting : 10 tentatives max par IP sur une fenêtre glissante de 15 min.
// Stocké dans Firestore (Admin SDK) pour fonctionner sur toutes les instances
// Vercel en parallèle — une Map en mémoire ne suffit pas en serverless.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  return (xff.split(",")[0].trim() || "unknown").slice(0, 64);
}

async function isRateLimited(ip: string): Promise<boolean> {
  const docId = `login_${ip.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const ref = adminDb.collection("rateLimits").doc(docId);
  try {
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      if (!snap.exists) {
        tx.set(ref, { attempts: 1, windowStart: now });
        return false;
      }
      const { attempts, windowStart } = snap.data() as { attempts: number; windowStart: number };
      if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
        tx.set(ref, { attempts: 1, windowStart: now });
        return false;
      }
      if (attempts >= RATE_LIMIT_MAX) return true;
      tx.update(ref, { attempts: attempts + 1 });
      return false;
    });
  } catch {
    // En cas de panne Firestore, on laisse passer plutôt que de bloquer l'admin.
    return false;
  }
}

export async function POST(request: Request) {
  if (await isRateLimited(clientIp(request))) {
    return Response.json(
      { error: "Trop de tentatives de connexion. Réessayez dans 15 minutes." },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }

  const body = await request.json().catch(() => null);
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  if (!idToken) {
    return Response.json({ error: "idToken manquant." }, { status: 400 });
  }

  let decoded;
  try {
    // requireFreshLogin=true : le jeton doit dater de moins de 5 minutes.
    decoded = await adminAuth.verifyIdToken(idToken, true);
  } catch {
    return Response.json({ error: "Jeton invalide." }, { status: 401 });
  }

  if (decoded.admin !== true) {
    return Response.json({ error: "Ce compte n'a pas le rôle admin." }, { status: 403 });
  }

  const sessionCookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  });

  (await cookies()).set("session", sessionCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });

  return Response.json({ ok: true });
}

export async function DELETE() {
  (await cookies()).delete("session");
  return Response.json({ ok: true });
}
