export default function PrivateLedger({ customers, payments, onOpenCustomer }) {
  const customerMap = new Map(customers.map(customer => [customer.id, customer]));

  return (
    <section className="feature-panel space-y-5">
      <div><p className="eyebrow">Private workspace</p><h2 className="text-2xl font-bold text-slate-800">Payment Ledger</h2><p className="mt-1 text-slate-500">Only you can access this screen after the security PIN.</p></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Date</th><th>Customer</th><th>Customer ID</th><th>Paid</th><th>Interest</th><th>Principal</th><th>Balance</th><th></th></tr></thead><tbody>
        {payments.length === 0 ? <tr><td colSpan="8" className="empty-state">No payments recorded yet.</td></tr> : payments.map(payment => {
          const customer = customerMap.get(payment.customer_id);
          return <tr key={payment.id}><td>{payment.payment_date}</td><td className="font-bold">{customer?.name || 'Deleted customer'}</td><td>{payment.customer_id}</td><td>₹{Number(payment.total_paid).toFixed(2)}</td><td>₹{Number(payment.interest_paid).toFixed(2)}</td><td>₹{Number(payment.principal_paid).toFixed(2)}</td><td>₹{Number(payment.remaining_principal).toFixed(2)}</td><td>{customer && <button type="button" onClick={() => onOpenCustomer(customer)} className="text-sm font-bold text-teal-700 hover:text-teal-900">View</button>}</td></tr>;
        })}
      </tbody></table></div>
    </section>
  );
}
