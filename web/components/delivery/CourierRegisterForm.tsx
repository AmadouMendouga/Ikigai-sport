"use client";

// Inscription livreur — gardée par aucune session : le jeton personnel généré
// à l'inscription EST l'accès (même principe que reviewToken/locationToken,
// voir lib/actions/orders.ts). Pas de mot de passe à retenir, juste un lien à
// garder — d'où l'insistance de l'écran de succès à le sauvegarder tout de
// suite (bouton copier + astuce "se l'envoyer sur WhatsApp").
import { useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { StatefulButton } from "@/components/StatefulButton";
import { registerCourierAction } from "@/lib/actions/couriers";
import { showToast } from "@/components/Toast";

export function CourierRegisterForm({ siteUrl }: { siteUrl: string }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [error, setError] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [phone, setPhone] = useState("");

  function validate(): boolean {
    const form = formRef.current;
    const phoneInput = phoneRef.current;
    if (!form || !phoneInput) return false;
    const digits = phoneInput.value.replace(/\D/g, "");
    phoneInput.setCustomValidity(digits.length >= 8 && digits.length <= 15 ? "" : "8 à 15 chiffres, avec l'indicatif pays.");
    const valid = form.checkValidity();
    if (!valid) form.reportValidity();
    return valid;
  }

  async function runSubmit() {
    setError("");
    const name = nameRef.current?.value.trim() || "";
    const rawPhone = phoneRef.current?.value.trim() || "";
    const result = await registerCourierAction({ name, phone: rawPhone });
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
    setPhone(rawPhone.replace(/\D/g, ""));
    setLink(`${siteUrl.replace(/\/$/, "")}/livreur/${result.token}`);
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      showToast("Lien copié", "check-circle");
    } catch {
      showToast("Impossible de copier — sélectionnez le lien manuellement.", "error", true);
    }
  }

  if (link) {
    const waMessage = encodeURIComponent(`Mon lien livreur ${siteUrl.replace(/^https?:\/\//, "")} : ${link}`);
    return (
      <div className="contact-card ik-courier-register-card">
        <div className="ik-courier-register-heading">
          <span className="ik-courier-register-icon" aria-hidden="true"><Icon name="check-circle" /></span>
          <div>
            <p className="ik-eyebrow">ESPACE LIVREUR</p>
            <h3>Votre accès est prêt</h3>
          </div>
        </div>
        <p className="ik-courier-register-intro">
          Gardez ce lien personnel : il ouvre directement vos livraisons assignées, sans mot de passe supplémentaire.
        </p>
        <div className="form-row">
          <label htmlFor="courierAccessLink">Votre lien personnel</label>
          <input id="courierAccessLink" className="ik-courier-access-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <div className="ik-courier-register-actions">
          <button type="button" className="btn btn-tonal" onClick={copyLink}>
            <Icon name="save" size="sm" />
            Copier le lien
          </button>
          <a className="btn btn-whatsapp" href={`https://wa.me/${phone}?text=${waMessage}`} target="_blank" rel="noopener">
            <Icon name="whatsapp" size="sm" />
            Me l&apos;envoyer sur WhatsApp
          </a>
        </div>
        <p className="ik-courier-register-note">
          <Icon name="shield" size="sm" />
          Ce lien est votre accès personnel. Ne le publiez pas : dès qu&apos;une livraison vous est assignée, elle y apparaît automatiquement.
        </p>
      </div>
    );
  }

  return (
    <div className="contact-card ik-courier-register-card">
      <div className="ik-courier-register-heading">
        <span className="ik-courier-register-icon" aria-hidden="true"><Icon name="shipping" /></span>
        <div>
          <p className="ik-eyebrow">ESPACE LIVREUR</p>
          <h3>Créer mon accès</h3>
        </div>
      </div>
      <p className="ik-courier-register-intro">
        Renseignez uniquement votre nom et votre numéro WhatsApp. Nous générerons ensuite votre lien personnel de livraison.
      </p>
      <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
        {error ? <p className="ik-courier-register-error" role="alert">{error}</p> : null}
        <div className="form-row">
          <label htmlFor="crName">Votre nom</label>
          <input ref={nameRef} id="crName" type="text" autoComplete="name" required minLength={2} placeholder="Ex. Jean Mboa" />
        </div>
        <div className="form-row">
          <label htmlFor="crPhone">Numéro WhatsApp avec indicatif pays</label>
          <input ref={phoneRef} id="crPhone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="237655634265" aria-describedby="crPhoneHelp" />
          <p id="crPhoneHelp" className="form-note">Exemple Cameroun : 237 suivi de votre numéro, sans espaces obligatoires.</p>
        </div>
        <StatefulButton className="btn btn-primary btn-lg btn-block" onValidate={validate} onRun={runSubmit}>
          <Icon name="check-circle" size="sm" />
          Créer mon accès livreur
        </StatefulButton>
      </form>
    </div>
  );
}
