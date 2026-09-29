// Formula: Interest = (Principal * Rate * Days) / 3000
export function calculateLiveInterest(principal, rate, startDateStr, paymentsHistory = [], interestType = 'SIMPLE', interestCarry = 0, interestPaidSinceDate = 0) {
  const start = new Date(startDateStr);
  const today = new Date();
  
  const diffTime = Math.abs(today - start);
  const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  const dailyRate = rate / 3000;
  const totalAccruedInterest = String(interestType).toUpperCase() === 'COMPOUND'
    ? principal * (Math.pow(1 + dailyRate, totalDays) - 1)
    : (principal * rate * totalDays) / 3000;

  let interestPaidSoFar = 0;
  let currentPrincipal = principal;

  paymentsHistory.forEach(p => {
    interestPaidSoFar += Number(p.interest_paid || 0);
    currentPrincipal -= Number(p.principal_deducted || 0);
  });

  const livePendingInterest = Math.max(0, totalAccruedInterest - interestPaidSoFar - Number(interestPaidSinceDate || 0)) + Math.max(0, Number(interestCarry || 0));
  const totalPayableNow = currentPrincipal + livePendingInterest;

  return {
    totalDays,
    currentPrincipal,
    livePendingInterest,
    totalPayableNow,
    isOverdue: totalDays >= 30 && livePendingInterest > 0
  };
}

export function processPartPayment(currentPrincipal, livePendingInterest, amountPaid) {
  if (amountPaid <= livePendingInterest) {
    return {
      interestPaid: amountPaid,
      principalDeducted: 0,
      remainingPrincipal: currentPrincipal,
      newStatus: currentPrincipal === 0 ? 'CLOSED' : 'ACTIVE'
    };
  } else {
    const interestPaid = livePendingInterest;
    const principalDeducted = amountPaid - livePendingInterest;
    const remainingPrincipal = Math.max(0, currentPrincipal - principalDeducted);

    return {
      interestPaid,
      principalDeducted,
      remainingPrincipal,
      newStatus: remainingPrincipal === 0 ? 'CLOSED' : 'ACTIVE'
    };
  }
}