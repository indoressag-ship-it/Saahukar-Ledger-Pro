import { useEffect, useState } from 'react';
import { AlertCircle, Home, LockKeyhole } from 'lucide-react';
import { supabase, supabaseReady } from './supabaseClient';
import { calculateLiveInterest, processPartPayment } from './utils/interestEngine';
import { generatePDFReceipt } from './utils/pdfGenerator';
import CustomerDirectory from './components/CustomerDirectory';
import AuthPinModal from './components/AuthPinModal';
import CustomerProfile from './components/CustomerProfile';
import PrivateLedger from './components/PrivateLedger';
import Reports from './components/Reports';

function SuccessVisual({ message }) {
  return (
    <div className="success-visual" role="status">
      <div className="success-visual__scene" aria-hidden="true">
        <div className="success-visual__halo"></div>
        <div className="success-visual__coin">&#10003;</div>
        <div className="success-visual__shadow"></div>
      </div>
      <div>
        <p className="success-visual__label">Complete / verified</p>
        <p className="success-visual__message">{message}</p>
      </div>
    </div>
  );
}

function CreatorCredit() {
  return <button type="button" className="creator-credit" aria-label="Made by Nitiksh Awasthi">Made by <strong>Nitiksh Awasthi</strong></button>;
}

function getStoredData(userId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(`sahukar-data-${userId}`) || '{"customers":[],"payments":[]}');
    return {
      customers: Array.isArray(parsed?.customers) ? parsed.customers : [],
      payments: Array.isArray(parsed?.payments) ? parsed.payments : []
    };
  } catch {
    return { customers: [], payments: [] };
  }
}

async function fetchUserDataFromSupabase(userId) {
  const { data: customerRows, error: customerError } = await supabase
    .from('customers')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (customerError) throw customerError;

  const customerIds = (customerRows || []).map(customer => customer.id);
  let paymentRows = [];

  if (customerIds.length > 0) {
    const { data: fetchedPayments, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .in('customer_id', customerIds)
      .order('created_at', { ascending: false });

    if (paymentError) throw paymentError;
    paymentRows = fetchedPayments || [];
  }

  return {
    customers: customerRows || [],
    payments: paymentRows || []
  };
}

async function migrateLocalDataToSupabase(userId, localData) {
  if (localData.customers.length === 0) return false;

  const customers = localData.customers.map(customer => ({
    ...customer,
    user_id: userId
  }));
  const payments = localData.payments.map(payment => ({
    ...payment,
    id: Number(payment.id) || Date.now(),
    customer_id: Number(payment.customer_id)
  }));

  const { error: customerError } = await supabase
    .from('customers')
    .upsert(customers, { onConflict: 'id' });
  if (customerError) throw customerError;

  if (payments.length > 0) {
    const { error: paymentError } = await supabase
      .from('payments')
      .upsert(payments, { onConflict: 'id' });
    if (paymentError) throw paymentError;
  }

  return true;
}

export default function App() {
  // Auth & Session States
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('LOGIN'); // 'LOGIN' or 'SIGNUP'
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError] = useState('');
  const [actionMessage, setActionMessage] = useState({ type: '', text: '' });
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [pinLocked, setPinLocked] = useState(false);

  // Sign In / Sign Up Form States
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');

  // UI Tabs & Language State
  const [activeTab, setActiveTab] = useState('dash'); // 'dash', 'add', 'dir', 'pay', 'ledger', 'reports', 'tools'
  const [lang, setLang] = useState(() => localStorage.getItem('sahukar-language') || 'HINGLISH');

  // Application Data States
  const [customers, setCustomers] = useState([]);
  const [payments, setPayments] = useState([]);

  // Add Customer Form States
  const [custForm, setCustForm] = useState({
    name: '', mobile: '', address: '', gov_id: '',
    principal: '', interest_rate: '', loan_date: new Date().toISOString().split('T')[0],
    collateral: '', gold_weight: '', notes: ''
  });

  // Payment Form States
  const [payCustId, setPayCustId] = useState('');
  const [selectedCust, setSelectedCust] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [profileCustomer, setProfileCustomer] = useState(null);
  const [pinValue, setPinValue] = useState('1234');

  const loadData = async (userId) => {
    setDataLoading(true);

    try {
      const syncedData = await fetchUserDataFromSupabase(userId);
      const localData = getStoredData(userId);
      if (syncedData.customers.length === 0 && localData.customers.length > 0) {
        await migrateLocalDataToSupabase(userId, localData);
        const migratedData = await fetchUserDataFromSupabase(userId);
        setCustomers(migratedData.customers);
        setPayments(migratedData.payments);
        localStorage.setItem(`sahukar-data-${userId}`, JSON.stringify(migratedData));
        return;
      }
      setCustomers(syncedData.customers);
      setPayments(syncedData.payments);
      localStorage.setItem(`sahukar-data-${userId}`, JSON.stringify({ customers: syncedData.customers, payments: syncedData.payments }));
    } catch (error) {
      console.error('Failed to load remote ledger data, falling back to local cache:', error);
      const storedData = getStoredData(userId);
      setCustomers(storedData.customers);
      setPayments(storedData.payments);
    } finally {
      setDataLoading(false);
    }
  };

  const saveData = async (userId, nextCustomers, nextPayments) => {
    const normalizedCustomers = nextCustomers.map(customer => ({
      ...customer,
      user_id: userId
    }));

    const normalizedPayments = nextPayments.map(payment => ({
      ...payment,
      customer_id: Number(payment.customer_id)
    }));

    try {
      const { error: customerError } = await supabase
        .from('customers')
        .upsert(normalizedCustomers, { onConflict: 'id' });

      if (customerError) throw customerError;

      const { error: paymentError } = await supabase
        .from('payments')
        .upsert(normalizedPayments, { onConflict: 'id' });

      if (paymentError) throw paymentError;

      localStorage.setItem(`sahukar-data-${userId}`, JSON.stringify({ customers: nextCustomers, payments: nextPayments }));
      setCustomers(nextCustomers);
      setPayments(nextPayments);
    } catch (error) {
      console.error('Failed to sync ledger data to Supabase, saving locally instead:', error);
      localStorage.setItem(`sahukar-data-${userId}`, JSON.stringify({ customers: nextCustomers, payments: nextPayments }));
      setCustomers(nextCustomers);
      setPayments(nextPayments);
    }
  };

  useEffect(() => {
    localStorage.setItem('sahukar-language', lang);
  }, [lang]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session: nextSession } }) => {
      if (!mounted) return;
      setSession(nextSession);
      if (nextSession?.user?.id) {
        setPinValue(nextSession.user.user_metadata?.ledger_pin || '1234');
        loadData(nextSession.user.id);
        setPinLocked(true);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user?.id) {
        setPinValue(nextSession.user.user_metadata?.ledger_pin || '1234');
        loadData(nextSession.user.id);
        setPinLocked(true);
      }
      if (_event === 'SIGNED_IN' && nextSession?.user?.email_confirmed_at) {
        setActionMessage({ type: 'success', text: 'Email confirmed. Sahukar Ledger Pro mein aapka account ready hai.' });
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Auth Handler: Full Details Sign Up & Persistence Login
  const handleAuth = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!supabaseReady) {
      setErrorMsg('Cloud sync is disabled because Supabase credentials are missing. Create a .env file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable the same account across devices.');
      return;
    }

    if (authBusy) return;
    setAuthBusy(true);

    if (authMode === 'SIGNUP') {
      if (!fullName || !phone || !email || !password) {
        setErrorMsg('Kripya sabhi zaroori fields (*) bharein!');
        setAuthBusy(false);
        return;
      }
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName, phone_number: phone, business_name: businessName } }
      });
      if (error) {
        setErrorMsg(error.message);
      } else {
        setSuccessMsg('Account ban gaya. Email confirmation required ho sakta hai; inbox check karke Sign In karein.');
        setAuthMode('LOGIN');
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setErrorMsg(error.message);
      } else {
        setSession(data.session);
        setPinValue(data.user.user_metadata?.ledger_pin || '1234');
        await loadData(data.session.user.id);
        setPinLocked(true);
      }
    }
    setAuthBusy(false);
  };

  const handleForgotPassword = async () => {
    setErrorMsg('');
    setSuccessMsg('');

    if (!email.trim()) {
      setErrorMsg('Pehle apna email address enter karein.');
      return;
    }

    if (resettingPassword) return;
    setResettingPassword(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`
    });
    setResettingPassword(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setSuccessMsg('Password reset link email par bhej diya gaya hai.');
  };

  // Dynamic Live Interest Calculation Logic
  const calculateInterest = (principal, rate, loanDateStr) => {
    const live = calculateLiveInterest(principal, rate, loanDateStr);
    return { days: live.totalDays, interest: live.livePendingInterest, total: live.totalPayableNow };
  };

  // Save Customer Handler
  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    if (!custForm.name || !custForm.mobile || !custForm.principal || !custForm.interest_rate) {
      setActionMessage({ type: 'error', text: 'Kripya sabhi aavashyak (*) fields bharein!' });
      return;
    }
    const nextCustomer = {
      id: Date.now(),
      name: custForm.name,
      mobile: custForm.mobile,
      address: custForm.address,
      gov_id: custForm.gov_id,
      principal: parseFloat(custForm.principal),
      interest_rate: parseFloat(custForm.interest_rate),
      loan_date: custForm.loan_date,
      collateral: custForm.collateral,
      gold_weight: parseFloat(custForm.gold_weight || 0),
      notes: custForm.notes
    };
    const nextCustomers = [...customers, nextCustomer];
    await saveData(session.user.id, nextCustomers, payments);
    {
      setActionMessage({ type: 'success', text: 'Naya grahak record safaltapoorvak saheja gaya!' });
      setCustForm({
        name: '', mobile: '', address: '', gov_id: '',
        principal: '', interest_rate: '', loan_date: new Date().toISOString().split('T')[0],
        collateral: '', gold_weight: '', notes: ''
      });
      setActiveTab('dir');
    }
  };

  // Payment Processing Logic
  const handleFetchCustomerForPay = () => {
    const found = customers.find(c => c.id === parseInt(payCustId));
    if (found) {
      const calc = calculateInterest(found.principal, found.interest_rate, found.loan_date);
      setSelectedCust({ ...found, ...calc });
      setActionMessage({ type: 'success', text: 'Confirmed — customer details loaded successfully.' });
    } else {
      setActionMessage({ type: 'error', text: 'Grahak nahi mila! Sahi Customer ID dalein.' });
      setSelectedCust(null);
    }
  };

  const handleProcessPayment = async () => {
    if (!selectedCust || !payAmount || Number(payAmount) <= 0) {
      setActionMessage({ type: 'error', text: 'Valid payment amount enter karein.' });
      return;
    }
    const paid = parseFloat(payAmount);
    const payment = processPartPayment(selectedCust.principal, selectedCust.interest, paid);
    const { interestPaid: intPaid, principalDeducted: princPaid, remainingPrincipal: newPrinc } = payment;
    const paymentNumber = payments.filter(paymentItem => paymentItem.customer_id === selectedCust.id).length + 1;

    const nextCustomers = customers.map(customer => customer.id === selectedCust.id ? { ...customer, principal: newPrinc } : customer);
    const nextPayment = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      customer_id: Number(selectedCust.id),
      payment_date: new Date().toISOString().split('T')[0],
      total_paid: paid,
      interest_paid: intPaid,
      principal_paid: princPaid,
      remaining_principal: newPrinc
    };
    await saveData(session.user.id, nextCustomers, [nextPayment, ...payments]);

    generatePDFReceipt(
      selectedCust,
      { collateral_type: selectedCust.collateral || 'Not recorded', collateral_details: selectedCust.notes || 'N/A', gold_weight_grams: selectedCust.gold_weight || 0, monthly_rate: selectedCust.interest_rate },
      { amountPaid: paid, interestPaid: intPaid, principalDeducted: princPaid, remainingPrincipal: newPrinc, paymentNumber }
    );
    openWhatsApp(selectedCust, { totalPayableNow: paid });

    setActionMessage({ type: 'success', text: 'Confirmed — payment processed successfully.' });
    setPayAmount('');
    setSelectedCust(null);
    setPayCustId('');
  };

  const openWhatsApp = (customer, calc) => {
    const message = `Namaste ${customer.name}, Customer ID ${customer.id}. Aapka current payable amount ₹${Number(calc.totalPayableNow).toFixed(2)} hai. Kripya payment ke liye sampark karein. - Sahukar Ledger Pro`;
    window.open(`https://wa.me/${String(customer.mobile).replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  const deleteCustomer = async (customer) => {
    if (!window.confirm(`${customer.name} ka customer record delete karna hai? Payment history bhi delete hogi.`)) return;
    const nextCustomers = customers.filter(item => item.id !== customer.id);
    const nextPayments = payments.filter(item => item.customer_id !== customer.id);
    await saveData(session.user.id, nextCustomers, nextPayments);
    setProfileCustomer(null);
    setActionMessage({ type: 'success', text: 'Customer record delete ho gaya.' });
  };

  const savePin = async () => {
    if (!/^\d{4}$/.test(pinValue)) {
      setActionMessage({ type: 'error', text: 'PIN exactly 4 digits ka hona chahiye.' });
      return;
    }
    const { error } = await supabase.auth.updateUser({ data: { ledger_pin: pinValue } });
    if (error) {
      setActionMessage({ type: 'error', text: `PIN save nahi hua: ${error.message}` });
      return;
    }
    setActionMessage({ type: 'success', text: 'Confirmed — security PIN account mein save ho gaya.' });
  };

  const exportBackup = () => {
    const backup = JSON.stringify({ exportedAt: new Date().toISOString(), customers, payments }, null, 2);
    const blob = new Blob([backup], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sahukar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setActionMessage({ type: 'success', text: 'Backup file download ho gayi.' });
  };

  const handleRefreshData = async () => {
    if (!session?.user?.id) return;
    await loadData(session.user.id);
    setActionMessage({ type: 'success', text: 'Latest ledger data sync ho gaya.' });
  };

  if (loading) {
    return <div className="loading-scene min-h-screen bg-slate-950 text-white flex items-center justify-center text-2xl font-bold">Loading Ledger Pro...</div>;
  }

  // 1. AUTHENTICATION GUI
  if (!session) {
    return (
      <div className="auth-scene min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <CreatorCredit />
        <div className="auth-card bg-white p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-200">
          <div className="auth-brand -m-8 mb-6 p-6 rounded-t-xl">
            <div className="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
            <div>
              <p className="eyebrow">Private ledger suite</p>
              <h1 className="text-2xl font-bold text-white tracking-wide">Sahukar Ledger Pro</h1>
              <p className="brand-subtitle text-sm mt-1">Loan & Ledger Management System</p>
            </div>
          </div>

          <h2 className="text-xl font-bold text-slate-800 text-center mb-4">
            {authMode === 'LOGIN' ? 'Sign In to Account' : 'Create New Account'}
          </h2>

          {errorMsg && (
            <div className="auth-notice auth-notice--error" role="alert">
              <AlertCircle size={19} aria-hidden="true" />
              <div>
                <p className="auth-notice__title">Sign-in details need attention</p>
                <p className="auth-notice__copy">{errorMsg}</p>
              </div>
            </div>
          )}
          {successMsg && <SuccessVisual message={successMsg} />}

          <form onSubmit={handleAuth} className="space-y-4">
            {authMode === 'SIGNUP' && (
              <>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Full Name *</label>
                  <input type="text" required className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 font-semibold" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="e.g. Ramesh Kumar" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Mobile Number *</label>
                  <input type="tel" required className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 font-semibold" value={phone} onChange={e => setPhone(e.target.value)} placeholder="9876543210" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Business / Firm Name</label>
                  <input type="text" className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 font-semibold" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="e.g. Shree Ram Finance" />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Email ID *</label>
              <input type="email" required className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 font-semibold" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Password *</label>
              <input type="password" required className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 font-semibold" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
              {authMode === 'LOGIN' && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={resettingPassword}
                  className="mt-2 text-sm font-semibold text-slate-500 hover:text-blue-600 disabled:opacity-50"
                >
                  {resettingPassword ? 'Checking account...' : 'Check password reset'}
                </button>
              )}
            </div>

            <button type="submit" disabled={authBusy} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-md text-base transition duration-150 disabled:cursor-not-allowed disabled:opacity-60">
              {authBusy ? 'Checking...' : authMode === 'LOGIN' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center border-t pt-4">
            <button className="text-sm font-bold text-blue-600 hover:underline" onClick={() => { setAuthMode(authMode === 'LOGIN' ? 'SIGNUP' : 'LOGIN'); setErrorMsg(''); }}>
              {authMode === 'LOGIN' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (pinLocked) {
    return <AuthPinModal savedPin={pinValue} onSuccess={() => setPinLocked(false)} />;
  }

  // Dashboard Aggregates
  const totalActiveCust = customers.length;
  const totalPrincipal = customers.reduce((acc, c) => acc + c.principal, 0);
  const totalLiveInterest = customers.reduce((acc, c) => acc + calculateInterest(c.principal, c.interest_rate, c.loan_date).interest, 0);
  const totalRecovered = payments.reduce((acc, p) => acc + p.total_paid, 0);
  const overdueAccounts = customers.filter(c => calculateInterest(c.principal, c.interest_rate, c.loan_date).days >= 30).length;

  // 2. MAIN WEB APP GUI
  return (
    <div className="app-shell min-h-screen bg-slate-100 flex flex-col font-sans">
      <CreatorCredit />
      
      {/* HEADER SECTION */}
      <header className="app-header bg-slate-950 text-white px-4 sm:px-8 py-4 flex flex-wrap gap-4 justify-between items-center shadow-lg">
        <button type="button" className="app-brand app-brand-button" onClick={() => setActiveTab('dash')} aria-label="Go to home dashboard">
          <div className="brand-mark brand-mark--small" aria-hidden="true"><span></span><span></span><span></span></div>
          <div>
            <p className="eyebrow">Sahukar / 2026</p>
            <h1 className="text-2xl font-bold tracking-wide">Sahukar Ledger Pro</h1>
            <p className="text-xs text-slate-400">Welcome, {session.user.user_metadata?.full_name || session.user.email}</p>
          </div>
        </button>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setLang(lang === 'EN' ? 'HINGLISH' : 'EN')}
            className="border border-slate-600 hover:border-cyan-400 hover:text-cyan-300 font-bold px-4 py-2 rounded-lg text-sm transition">
            {lang === 'EN' ? 'Hinglish' : 'English'}
          </button>
          <button 
            onClick={() => supabase.auth.signOut()}
            className="bg-red-600 hover:bg-red-700 font-bold px-4 py-2 rounded text-sm text-white transition">
            Log Out
          </button>
        </div>
      </header>

      {/* TABBED NAVIGATION BAR */}
      <nav className="bg-white border-b border-slate-200 px-3 sm:px-6 flex gap-1 overflow-x-auto pt-2">
        <button onClick={() => setActiveTab('dash')} className={`whitespace-nowrap px-4 sm:px-6 py-3 font-bold text-sm rounded-t-lg transition flex items-center gap-2 ${activeTab === 'dash' ? 'bg-slate-50 text-cyan-700 border-b-4 border-cyan-600' : 'text-slate-600 hover:bg-slate-50'}`}>
          <Home size={16} aria-hidden="true" />
          {lang === 'EN' ? 'Home' : 'Ghar'}
        </button>
        <button onClick={() => setActiveTab('dash')} className={`whitespace-nowrap px-4 sm:px-6 py-3 font-bold text-sm rounded-t-lg transition ${activeTab === 'dash' ? 'bg-slate-50 text-cyan-700 border-b-4 border-cyan-600' : 'text-slate-600 hover:bg-slate-50'}`}>
          {lang === 'EN' ? 'Dashboard' : 'Overview'}
        </button>
        <button onClick={() => setActiveTab('add')} className={`whitespace-nowrap px-4 sm:px-6 py-3 font-bold text-sm rounded-t-lg transition ${activeTab === 'add' ? 'bg-slate-50 text-cyan-700 border-b-4 border-cyan-600' : 'text-slate-600 hover:bg-slate-50'}`}>
          {lang === 'EN' ? '+ Add Customer' : '+ Customer Jodein'}
        </button>
        <button onClick={() => setActiveTab('dir')} className={`whitespace-nowrap px-4 sm:px-6 py-3 font-bold text-sm rounded-t-lg transition ${activeTab === 'dir' ? 'bg-slate-50 text-cyan-700 border-b-4 border-cyan-600' : 'text-slate-600 hover:bg-slate-50'}`}>
          {lang === 'EN' ? 'Customer Directory' : 'Customer List'}
        </button>
        <button onClick={() => setActiveTab('pay')} className={`whitespace-nowrap px-4 sm:px-6 py-3 font-bold text-sm rounded-t-lg transition ${activeTab === 'pay' ? 'bg-slate-50 text-cyan-700 border-b-4 border-cyan-600' : 'text-slate-600 hover:bg-slate-50'}`}>
          {lang === 'EN' ? 'Part Payment' : 'Payment Jama'}
        </button>
        <button onClick={() => { setProfileCustomer(null); setActiveTab('ledger'); }} className={`whitespace-nowrap px-4 sm:px-6 py-3 font-bold text-sm rounded-t-lg transition ${activeTab === 'ledger' ? 'bg-slate-50 text-cyan-700 border-b-4 border-cyan-600' : 'text-slate-600 hover:bg-slate-50'}`}>
          Private Ledger
        </button>
        <button onClick={() => setActiveTab('reports')} className={`whitespace-nowrap px-4 sm:px-6 py-3 font-bold text-sm rounded-t-lg transition ${activeTab === 'reports' ? 'bg-slate-50 text-cyan-700 border-b-4 border-cyan-600' : 'text-slate-600 hover:bg-slate-50'}`}>
          Reports
        </button>
        <button onClick={() => setActiveTab('tools')} className={`whitespace-nowrap px-4 sm:px-6 py-3 font-bold text-sm rounded-t-lg transition ${activeTab === 'tools' ? 'bg-slate-50 text-cyan-700 border-b-4 border-cyan-600' : 'text-slate-600 hover:bg-slate-50'}`}>
          {lang === 'EN' ? 'Backup & Tools' : 'Tools'}
        </button>
      </nav>

      {/* MAIN CONTAINER AREA */}
      <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
        {dataLoading && <div className="mb-4 rounded-lg bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-800">Loading local ledger...</div>}
        {dataError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">Data load failed: {dataError}</div>}
        {actionMessage.text && (actionMessage.type === 'success'
          ? <SuccessVisual message={actionMessage.text} />
          : <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{actionMessage.text}</div>)}
        
        {/* 1. DASHBOARD TAB */}
        {activeTab === 'dash' && (
          <div className="space-y-6">
            <div className="dashboard-intro">
              <div>
                <p className="eyebrow">Portfolio pulse</p>
                <h2 className="text-2xl font-bold text-slate-800">{lang === 'HI' ? 'व्यापार का विवरण (Business Overview)' : 'Business Overview'}</h2>
                <p className="intro-copy">A single, calm view of every rupee in motion.</p>
              </div>
              <div className="ledger-vault" aria-hidden="true">
                <div className="vault-ring vault-ring--outer"></div>
                <div className="vault-ring vault-ring--inner"></div>
                <div className="vault-core">₹</div>
                <div className="vault-shadow"></div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="metric-card bg-blue-600 text-white p-6 rounded-lg shadow-md">
                <p className="text-lg font-bold">{lang === 'HI' ? 'कुल सक्रिय ग्राहक' : 'Total Active Customers'}</p>
                <p className="text-4xl font-extrabold mt-2">{totalActiveCust}</p>
              </div>
              <div className="metric-card bg-emerald-600 text-white p-6 rounded-lg shadow-md">
                <p className="text-lg font-bold">{lang === 'HI' ? 'बकाया मूलधन (Principal)' : 'Outstanding Principal'}</p>
                <p className="text-4xl font-extrabold mt-2">₹{totalPrincipal.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
              </div>
              <div className="metric-card bg-amber-600 text-white p-6 rounded-lg shadow-md">
                <p className="text-lg font-bold">{lang === 'HI' ? 'कुल देय ब्याज (Interest)' : 'Accrued Live Interest'}</p>
                <p className="text-4xl font-extrabold mt-2">₹{totalLiveInterest.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
              </div>
              <div className="metric-card bg-purple-600 text-white p-6 rounded-lg shadow-md">
                <p className="text-lg font-bold">{lang === 'HI' ? 'कुल वसूल की गई राशि' : 'Total Recovered Payments'}</p>
                <p className="text-4xl font-extrabold mt-2">₹{totalRecovered.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
              </div>
              <div className="metric-card bg-red-600 text-white p-6 rounded-lg shadow-md">
                <p className="text-lg font-bold">{lang === 'HI' ? 'ओवरड्यू खाते (≥30 दिन)' : 'Overdue Accounts (≥30 Days)'}</p>
                <p className="text-4xl font-extrabold mt-2">{overdueAccounts} {lang === 'HI' ? 'ग्राहक देय हैं' : 'Customers Due'}</p>
              </div>
            </div>
          </div>
        )}

        {/* 2. ADD CUSTOMER TAB */}
        {activeTab === 'add' && (
          <div className="bg-white p-8 rounded-lg shadow-md border max-w-4xl">
            <h2 className="text-xl font-bold text-slate-800 mb-6 border-b pb-2">
              {lang === 'HI' ? 'नया ग्राहक रिकॉर्ड जोड़ें' : 'Add New Customer Record'}
            </h2>
            <form onSubmit={handleSaveCustomer} className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-base font-bold text-slate-700 mb-1">{lang === 'HI' ? 'ग्राहक का नाम *' : 'Customer Name*'}</label>
                <input type="text" required className="w-full p-3 text-lg border-2 rounded focus:border-blue-600" value={custForm.name} onChange={e => setCustForm({...custForm, name: e.target.value})} />
              </div>
              <div>
                <label className="block text-base font-bold text-slate-700 mb-1">{lang === 'HI' ? 'मोबाइल नंबर *' : 'Mobile Number*'}</label>
                <input type="tel" required className="w-full p-3 text-lg border-2 rounded focus:border-blue-600" value={custForm.mobile} onChange={e => setCustForm({...custForm, mobile: e.target.value})} />
              </div>
              <div>
                <label className="block text-base font-bold text-slate-700 mb-1">{lang === 'HI' ? 'पता' : 'Address'}</label>
                <input type="text" className="w-full p-3 text-lg border-2 rounded focus:border-blue-600" value={custForm.address} onChange={e => setCustForm({...custForm, address: e.target.value})} />
              </div>
              <div>
                <label className="block text-base font-bold text-slate-700 mb-1">{lang === 'HI' ? 'सरकारी पहचान पत्र (Govt ID)' : 'Govt ID Doc'}</label>
                <input type="text" className="w-full p-3 text-lg border-2 rounded focus:border-blue-600" value={custForm.gov_id} onChange={e => setCustForm({...custForm, gov_id: e.target.value})} />
              </div>
              <div>
                <label className="block text-base font-bold text-slate-700 mb-1">{lang === 'HI' ? 'मूलधन राशि (₹)*' : 'Principal Amount (₹)*'}</label>
                <input type="number" step="any" required className="w-full p-3 text-lg border-2 rounded focus:border-blue-600 font-bold" value={custForm.principal} onChange={e => setCustForm({...custForm, principal: e.target.value})} />
              </div>
              <div>
                <label className="block text-base font-bold text-slate-700 mb-1">{lang === 'HI' ? 'ब्याज दर (%/माह) *' : 'Interest Rate (%/month)*'}</label>
                <input type="number" step="any" required className="w-full p-3 text-lg border-2 rounded focus:border-blue-600 font-bold" value={custForm.interest_rate} onChange={e => setCustForm({...custForm, interest_rate: e.target.value})} />
              </div>
              <div>
                <label className="block text-base font-bold text-slate-700 mb-1">{lang === 'HI' ? 'ऋण तिथि (YYYY-MM-DD)*' : 'Loan Date (YYYY-MM-DD)*'}</label>
                <input type="date" required className="w-full p-3 text-lg border-2 rounded focus:border-blue-600" value={custForm.loan_date} onChange={e => setCustForm({...custForm, loan_date: e.target.value})} />
              </div>
              <div>
                <label className="block text-base font-bold text-slate-700 mb-1">{lang === 'HI' ? 'बंधक/गिरवी सामान' : 'Collateral Item'}</label>
                <input type="text" className="w-full p-3 text-lg border-2 rounded focus:border-blue-600" value={custForm.collateral} onChange={e => setCustForm({...custForm, collateral: e.target.value})} />
              </div>
              <div className="md:col-span-2">
                <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xl py-4 rounded shadow-lg transition">
                  {lang === 'HI' ? 'ग्राहक रिकॉर्ड सहेजें' : 'Save Customer Record'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* 3. CUSTOMER DIRECTORY TAB */}
        {activeTab === 'dir' && !profileCustomer && (
          <CustomerDirectory customers={customers} onOpenProfile={setProfileCustomer} onDeleteCustomer={deleteCustomer} onWhatsApp={openWhatsApp} onSelectPayment={(customer) => { setPayCustId(String(customer.id)); setActiveTab('pay'); }} />
        )}

        {activeTab === 'dir' && profileCustomer && (
          <CustomerProfile customer={profileCustomer} payments={payments} onBack={() => setProfileCustomer(null)} onPay={() => { setPayCustId(String(profileCustomer.id)); setActiveTab('pay'); setProfileCustomer(null); }} onWhatsApp={() => openWhatsApp(profileCustomer, calculateInterest(profileCustomer.principal, profileCustomer.interest_rate, profileCustomer.loan_date))} />
        )}

        {/* 4. PART PAYMENT TAB */}
        {activeTab === 'pay' && (
          <div className="bg-white p-8 rounded-lg shadow-md border max-w-3xl space-y-6">
            <h2 className="text-xl font-bold text-slate-800 border-b pb-2">{lang === 'HI' ? 'पार्ट पेमेंट दर्ज करें' : 'Part Payment Entry'}</h2>
            
            <div className="flex space-x-4 items-center">
              <label className="font-bold text-lg">{lang === 'HI' ? 'ग्राहक आईडी:' : 'Customer ID:'}</label>
              <input type="number" className="p-3 border-2 rounded text-lg font-bold w-32" value={payCustId} onChange={e => setPayCustId(e.target.value)} />
              <button onClick={handleFetchCustomerForPay} className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-6 py-3 rounded text-base">
                {lang === 'HI' ? 'विवरण लोड करें' : 'Fetch Details'}
              </button>
            </div>

            {selectedCust && (
              <div className="bg-slate-50 p-6 rounded-lg border-2 border-slate-200 space-y-2 text-lg">
                <p><strong>Name:</strong> {selectedCust.name} | <strong>Mobile:</strong> {selectedCust.mobile}</p>
                <p><strong>Principal:</strong> ₹{selectedCust.principal} | <strong>Rate:</strong> {selectedCust.interest_rate}%/month</p>
                <p><strong>Accrued Interest:</strong> ₹{selectedCust.interest}</p>
                <p className="text-xl font-bold text-blue-700"><strong>Total Payable:</strong> ₹{selectedCust.total}</p>

                <div className="pt-4 flex items-center space-x-4">
                  <label className="font-bold">{lang === 'HI' ? 'भुगतान राशि (₹):' : 'Paid Amount (₹):'}</label>
                  <input type="number" className="p-3 border-2 rounded text-lg font-bold w-48" value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                  <button onClick={handleProcessPayment} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded text-lg">
                    {lang === 'HI' ? 'भुगतान दर्ज करें' : 'Process Payment'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'ledger' && <PrivateLedger customers={customers} payments={payments} onOpenCustomer={(customer) => { setProfileCustomer(customer); setActiveTab('dir'); }} />}

        {activeTab === 'reports' && <Reports customers={customers} payments={payments} />}

        {/* 5. BACKUP & TOOLS TAB */}
        {activeTab === 'tools' && (
          <div className="bg-white p-8 rounded-lg shadow-md border max-w-2xl space-y-4">
            <h2 className="text-xl font-bold text-slate-800 border-b pb-2">{lang === 'HI' ? 'डेटाबेस व सुरक्षा टूल्स' : 'Database & Security Tools'}</h2>
            <p className="text-base text-slate-600">Demo mode: your ledger is saved securely in this browser. Cloud sync can be added later.</p>
            <div className="flex flex-wrap gap-3 pt-2">
              <button onClick={handleRefreshData} className="rounded-lg bg-slate-900 px-4 py-2.5 font-bold text-white transition hover:bg-slate-700 disabled:opacity-50" disabled={dataLoading}>
                {dataLoading ? 'Syncing...' : 'Refresh Data'}
              </button>
              <button onClick={exportBackup} className="rounded-lg border border-slate-300 px-4 py-2.5 font-bold text-slate-700 transition hover:border-cyan-600 hover:text-cyan-700">
                Download Backup
              </button>
              <button onClick={() => setPinLocked(true)} className="action-button action-button--dark"><LockKeyhole size={16} /> Lock now</button>
            </div>
            <div className="settings-block">
              <h3 className="font-bold text-slate-800">Change security PIN</h3>
              <div className="mt-3 flex flex-wrap gap-3"><input type="password" inputMode="numeric" maxLength="4" value={pinValue} onChange={event => setPinValue(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4 digit PIN" className="p-3 border-2 rounded-lg font-bold" /><button onClick={savePin} className="action-button action-button--primary">Save PIN</button></div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}