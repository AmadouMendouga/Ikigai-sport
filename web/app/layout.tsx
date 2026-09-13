import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./lmi.css";
import "./ikigai-ui.css";
import { IconSprite } from "@/components/icons/IconSprite";
import { ToastHost } from "@/components/Toast";

export const metadata: Metadata = {
  title: "IKIGAI Sport",
  description: "Boutique multisport au Cameroun : maillots, judogi, équipements de combat, basketball et sneakers.",
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("lmi_theme");document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light");}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <IconSprite />
        {children}
        <ToastHost />
        <Analytics />
      </body>
    </html>
  );
}
