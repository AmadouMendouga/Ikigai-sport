import { cookies } from "next/headers";

// Miroir de app/api/session/route.ts (admin) pour les comptes clients — cookie
// distinct (customer_session), pas de contrôle de custom claim : tout compte
// qui s'authentifie avec succès ici est un client (voir lib/auth/dal.ts).
const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 jours

export async function POST(request: Request) {
  const { idToken } = await request.json();
  if (typeof idToken !== "string" || !idToken) {
    return Response.json({ error: "idToken manquant." }, { status: 400 });
  }

  // Ne pas initialiser Firebase Admin au chargement du module : le GET public
  // de cette route est appelé par le storefront même pour un visiteur anonyme.
  // Un problème de configuration Admin ne doit donc jamais faire tomber les
  // pages publiques avant même qu'une authentification soit demandée.
  let admin;
  try {
    admin = await import("@/lib/firebase/admin");
  } catch {
    return Response.json({ error: "Service d'authentification indisponible." }, { status: 503 });
  }
  const { adminAuth, adminDb } = admin;

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken, true);
  } catch {
    return Response.json({ error: "Jeton invalide." }, { status: 401 });
  }

  const sessionCookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  });

  (await cookies()).set("customer_session", sessionCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });

  const profileRef = adminDb.collection("customers").doc(decoded.uid);
  const profileSnapshot = await profileRef.get();
  const existing = profileSnapshot.data();
  if (!profileSnapshot.exists) {
    const fallbackName = typeof decoded.name === "string" && decoded.name.trim()
      ? decoded.name.trim().slice(0, 120)
      : typeof decoded.email === "string" ? decoded.email.split("@")[0].slice(0, 120) : "Client IKIGAI";
    await profileRef.set({ name: fallbackName, phone: "", createdAt: new Date().toISOString() });
  }
  const phone = typeof existing?.phone === "string" ? existing.phone.replace(/\D/g, "") : "";
  return Response.json({ ok: true, uid: decoded.uid, profileComplete: phone.length >= 8 && phone.length <= 15 });
}

export async function DELETE() {
  (await cookies()).delete("customer_session");
  return Response.json({ ok: true });
}

/** The public header can personalize itself without exposing the session cookie. */
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  const cookieStore = await cookies();

  // Cas le plus fréquent : visiteur anonyme. Répondre sans charger Firebase
  // Admin évite qu'une dépendance/configuration serveur ne transforme un simple
  // affichage public en erreur 500.
  if (!cookieStore.get("customer_session")?.value) {
    return Response.json({ profile: null }, { headers });
  }

  try {
    const { getCustomerProfile } = await import("@/lib/data/customer");
    const profile = await getCustomerProfile();
    return Response.json({ profile: { name: profile.name } }, { headers });
  } catch (error) {
    try {
      const { AuthError } = await import("@/lib/auth/dal");
      if (error instanceof AuthError) return Response.json({ profile: null }, { headers });
    } catch {
      // Si Firebase Admin lui-même ne peut pas s'initialiser, le 503 ci-dessous
      // rend l'incident observable sans exposer les détails de configuration.
    }
    return Response.json({ profile: null }, { status: 503, headers });
  }
}
