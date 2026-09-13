import type { Metadata } from "next";
import "./admin.css";
import "./admin-refonte-v2.css";

// Les styles de l'administration restent chargés uniquement sous /admin afin
// de ne pas alourdir le storefront public. La couche V2 est additive et ne
// touche pas aux actions métier, aux commandes ou aux accès Firebase.
export const metadata: Metadata = {
  title: "Administration | IKIGAI Sport",
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="ik-app ik-admin adm-body">{children}</div>;
}
