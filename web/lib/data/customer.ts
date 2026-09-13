import "server-only";
import { cache } from "react";
import { verifyCustomerSession } from "@/lib/auth/dal";

/** Read only the profile belonging to the verified session; never accept a UID from the browser. */
export const getCustomerProfile = cache(async () => {
  // Vérifier d'abord la session. Sans cookie client, aucune initialisation
  // Firebase Admin/Firestore n'est nécessaire pour afficher le storefront.
  const session = await verifyCustomerSession();
  const { adminDb } = await import("@/lib/firebase/admin");
  const snapshot = await adminDb.collection("customers").doc(session.uid).get();
  const data = snapshot.data();
  const name = data?.name;
  return {
    name: typeof name === "string" ? name.trim().slice(0, 120) : "", email: session.email,
    phone: typeof data?.phone === "string" ? data.phone.replace(/\D/g, "").slice(0, 15) : "",
    defaultAddress: typeof data?.defaultAddress === "string" ? data.defaultAddress.trim().slice(0, 500) : "",
  };
});
