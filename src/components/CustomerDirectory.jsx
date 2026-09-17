import { useState } from 'react';
import { calculateLiveInterest } from '../utils/interestEngine';

export default function CustomerDirectory({ customers, onSelectPayment }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.mobile.includes(searchTerm)
  );

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold text-slate-800">Customer Directory & Ledger</h2>
        
        <input
          type="text"
          placeholder="Search Name or Mobile..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-4 py-2 border border-slate-300 rounded-lg w-64 text-sm focus:outline-none focus:border-slate-700"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-800 text-white">
            <tr>
              <th className="p-3">Customer</th>
              <th className="p-3">Collateral</th>
              <th className="p-3">Principal</th>
              <th className="p-3">Days</th>
              <th className="p-3">Live Accrued Interest</th>
              <th className="p-3">Total Payable</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredCustomers.map((customer) => {
              const calc = calculateLiveInterest(
                customer.principal,
                customer.interest_rate,
                customer.loan_date
              );

              return (
                <tr 
                  key={customer.id}
                  className={`border-b transition-colors ${
                    calc.isOverdue 
                      ? 'bg-red-50 text-red-800 border-l-4 border-red-500 font-medium' 
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <td className="p-3">
                    <div className="font-bold">{customer.name}</div>
                    <div className="text-xs text-slate-500">{customer.mobile}</div>
                  </td>
                  <td className="p-3">
                    {customer.collateral || 'Not recorded'} ({customer.gold_weight || 0}g)
                  </td>
                  <td className="p-3 font-semibold">₹{calc.currentPrincipal.toFixed(2)}</td>
                  <td className="p-3">
                    {calc.totalDays} Days 
                    {calc.isOverdue && <span className="ml-2 text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded">OVERDUE</span>}
                  </td>
                  <td className="p-3 text-amber-600 font-semibold">₹{calc.livePendingInterest.toFixed(2)}</td>
                  <td className="p-3 font-bold text-emerald-700">₹{calc.totalPayableNow.toFixed(2)}</td>
                  <td className="p-3">
                    <button
                      onClick={() => onSelectPayment?.(customer, calc)}
                      className="bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded text-xs font-medium"
                    >
                      Pay & Receipt
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}