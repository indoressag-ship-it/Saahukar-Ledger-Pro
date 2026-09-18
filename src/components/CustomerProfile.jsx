import { calculateLiveInterest } from '../utils/interestEngine';

export default function CustomerProfile({ customer, payments, onBack, onPay, onWhatsApp }) {
  if (!customer) return null;

  const customerPayments = payments.filter(payment => payment.customer_id === customer.id);
  const calc = calculateLiveInterest(customer.principal, customer.interest_rate, customer.loan_date);
  const status = customer.principal <= 0 ? 'LOAN CLOSED' : calc.isOverdue ? 'OVERDUE' : 'ACTIVE';

  return (
    <section className="feature-panel space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <button type="button" onClick={onBack} className="mb-3 text-sm font-bold text-teal-700 hover:text-teal-900">← Back to customers</button>
          <p className="eyebrow">Customer profile</p>
          <h2 className="text-3xl font-bold text-slate-800">{customer.name}</h2>
          <p className="mt-1 text-slate-500">Customer ID: <strong className="text-slate-800">{customer.id}</strong> · {customer.mobile}</p>
        </div>
        <span className={`status-pill status-pill--${status === 'LOAN CLOSED' ? 'closed' : status === 'OVERDUE' ? 'overdue' : 'active'}`}>{status}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="detail-tile"><span>Outstanding principal</span><strong>₹{Number(customer.principal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
        <div className="detail-tile"><span>Live interest</span><strong>₹{calc.livePendingInterest.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
        <div className="detail-tile"><span>Total payable now</span><strong>₹{calc.totalPayableNow.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
      </div>

      <div className="grid grid-cols-1 gap-3 text-sm text-slate-600 md:grid-cols-2">
        <p><strong>Address:</strong> {customer.address || 'Not recorded'}</p>
        <p><strong>Govt ID:</strong> {customer.gov_id || 'Not recorded'}</p>
        <p><strong>Loan date:</strong> {customer.loan_date}</p>
        <p><strong>Rate:</strong> {customer.interest_rate}% / month</p>
        <p><strong>Collateral:</strong> {customer.collateral || 'Not recorded'}</p>
        <p><strong>Weight:</strong> {customer.gold_weight || 0}g</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onPay} className="action-button action-button--primary">Record payment</button>
        <button type="button" onClick={onWhatsApp} className="action-button action-button--whatsapp">WhatsApp reminder</button>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between"><h3 className="text-lg font-bold text-slate-800">Payment history</h3><span className="text-sm text-slate-500">{customerPayments.length} payment(s)</span></div>
        {customerPayments.length === 0 ? <p className="empty-state">No payments recorded yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Date</th><th>Paid</th><th>Interest</th><th>Principal</th><th>Balance</th></tr></thead><tbody>
            {customerPayments.map(payment => <tr key={payment.id}><td>{payment.payment_date}</td><td>₹{Number(payment.total_paid).toFixed(2)}</td><td>₹{Number(payment.interest_paid).toFixed(2)}</td><td>₹{Number(payment.principal_paid).toFixed(2)}</td><td>₹{Number(payment.remaining_principal).toFixed(2)}</td></tr>)}
          </tbody></table></div>
        )}
      </div>
    </section>
  );
}
