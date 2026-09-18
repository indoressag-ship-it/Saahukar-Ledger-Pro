export default function Reports({ customers, payments }) {
  const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.total_paid || 0), 0);
  const totalInterest = payments.reduce((sum, payment) => sum + Number(payment.interest_paid || 0), 0);
  const totalPrincipal = payments.reduce((sum, payment) => sum + Number(payment.principal_paid || 0), 0);
  const closedLoans = customers.filter(customer => Number(customer.principal) <= 0).length;
  const activeLoans = customers.length - closedLoans;

  return (
    <section className="space-y-6">
      <div><p className="eyebrow">Business intelligence</p><h2 className="text-2xl font-bold text-slate-800">Reports</h2><p className="mt-1 text-slate-500">A clear view of collections, interest and loan status.</p></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="report-card"><span>Total collected</span><strong>₹{totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
        <div className="report-card"><span>Interest earned</span><strong>₹{totalInterest.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
        <div className="report-card"><span>Principal recovered</span><strong>₹{totalPrincipal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
        <div className="report-card"><span>Active / closed</span><strong>{activeLoans} / {closedLoans}</strong></div>
      </div>
      <div className="feature-panel"><h3 className="mb-4 text-lg font-bold text-slate-800">Recent collections</h3>{payments.length === 0 ? <p className="empty-state">No collection data available yet.</p> : <div className="space-y-3">{payments.slice(0, 8).map(payment => <div key={payment.id} className="report-row"><span>{payment.payment_date}</span><strong>₹{Number(payment.total_paid).toFixed(2)}</strong></div>)}</div>}</div>
    </section>
  );
}
