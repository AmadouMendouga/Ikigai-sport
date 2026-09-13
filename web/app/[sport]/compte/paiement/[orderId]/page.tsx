import { requireCustomerOrRedirect } from "@/lib/auth/dal";
import { getOrderById } from "@/lib/data/orders";
import { Icon } from "@/components/icons/Icon";
import { PaymentStatusPoller } from "@/components/account/PaymentStatusPoller";

export default async function PaiementPage({ params }: PageProps<"/[sport]/compte/paiement/[orderId]">) {
  const { sport, orderId } = await params;
  const customer = await requireCustomerOrRedirect(sport);
  const order = await getOrderById(orderId, customer.uid);

  return (
    <main>
      <div className="page-hero">
        <div className="container">
          <h1>
            <Icon name="payment" size="xl" />
            Paiement
          </h1>
          <p>Suivez ici l&apos;état de votre paiement Mobile Money.</p>
        </div>
      </div>
      <div className="section">
        <div className="container" style={{ maxWidth: 480 }}>
          {order ? (
            <PaymentStatusPoller
              orderId={order.id}
              initialStatus={order.paymentStatus}
              initialReason={order.paymentFailureReason}
              ussdCode={order.ussdCode}
            />
          ) : (
            <div className="contact-card">
              <h3>Commande introuvable</h3>
              <p>Ce lien de paiement n&apos;est plus valide.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
