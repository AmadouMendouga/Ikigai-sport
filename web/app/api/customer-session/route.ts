import { cookies } from "next/headers";
import { AuthError } from "@/lib/auth/dal";
import { getCustomerProfile } from "@/lib/data/customer";

// Miroir de app/api/session/route.ts (admin) pour les comptes clients — cookie
// distinct (customer_session), pas de contrôle de custom claim : tout compte
// qui s'authentifie avec succès ici est un client (voir lib/auth/dal.ts).
const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 jours

export async function POST(request: Request) {
  const { idToken } = await request.json();
  if (typeof idToken !== "string" || !idToken) {
    return Response.json({ error: "idToken manquant." }, { status: 400 });
  }

  // Firebase Admin n'est chargé que pour les opérations qui en ont besoin.
  // Le GET public reste donc utilisable par un visiteur anonyme sans initialiser
  // le SDK tant que la DAL n'a détecté aucune session client à vérifier.
  let admin: typeof import("@/lib/firebase/admin");
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
  try {
    const profile = await getCustomerProfile();
    return Response.json({ profile: { name: profile.name } }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return Response.json({ profile: null }, { headers });
    return Response.json({ profile: null }, { status: 503, headers });
  }
}
