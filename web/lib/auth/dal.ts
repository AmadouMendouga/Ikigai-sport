import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export class AuthError extends Error {}

/**
 * Vérification réelle et faisant autorité de la session admin — à appeler en
 * tête de chaque Server Action / Route Handler / Server Component qui touche
 * des données admin. Ne jamais se contenter de la vérification optimiste de
 * `proxy.ts` (voir sa jsdoc) : elle ne protège rien à elle seule.
 */
export const verifyAdminSession = cache(async () => {
  const sessionCookie = (await cookies()).get("session")?.value;
  if (!sessionCookie) throw new AuthError("Aucune session.");

  // Un visiteur sans cookie ne doit pas initialiser Firebase Admin. Le SDK est
  // chargé seulement après la présence d'une session à vérifier ; une vraie
  // panne/configuration serveur reste ainsi une erreur serveur et n'est pas
  // maquillée en simple erreur d'authentification.
  const { adminAuth } = await import("@/lib/firebase/admin");

  let decoded;
  try {
    decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
  } catch {
    throw new AuthError("Session invalide ou expirée.");
  }

  if (decoded.admin !== true) {
    throw new AuthError("Ce compte n'a pas le rôle admin.");
  }

  return { uid: decoded.uid, email: decoded.email ?? null };
});

/** Variante pour les Server Components de page : redirige plutôt que de jeter. */
export async function requireAdminOrRedirect() {
  try {
    return await verifyAdminSession();
  } catch {
    redirect("/admin/connexion");
  }
}

/**
 * Miroir de verifyAdminSession() pour les comptes clients (addendum 2) — cookie
 * séparé (`customer_session`, posé par app/api/customer-session/route.ts), donc
 * aucun risque de confusion avec une session admin. Pas de contrôle de custom
 * claim ici : tout compte qui s'authentifie avec succès via ce cookie est un
 * client, il n'y a pas de rôle à vérifier.
 */
export const verifyCustomerSession = cache(async () => {
  const sessionCookie = (await cookies()).get("customer_session")?.value;
  if (!sessionCookie) throw new AuthError("Aucune session.");

  const { adminAuth } = await import("@/lib/firebase/admin");

  let decoded;
  try {
    decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
  } catch {
    throw new AuthError("Session invalide ou expirée.");
  }

  return { uid: decoded.uid, email: decoded.email ?? null };
});

/** Variante pour les Server Components de page : redirige plutôt que de jeter.
 * `sport` détermine le site-sport vers lequel rediriger (chaque site-sport a
 * sa propre page de connexion sous /[sport]/compte/connexion). */
export async function requireCustomerOrRedirect(sport: string) {
  try {
    return await verifyCustomerSession();
  } catch {
    redirect(`/${sport}/compte/connexion`);
  }
}
