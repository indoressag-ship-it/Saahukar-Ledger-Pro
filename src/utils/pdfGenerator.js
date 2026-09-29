import jsPDF from 'jspdf';
import 'jspdf-autotable';

export function generatePDFReceipt(customer, loan, paymentDetails) {
  const doc = new jsPDF();

  // Top Header Banner
  doc.setFillColor(30, 41, 59); // Navy Blue
  doc.rect(0, 0, 210, 32, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('SAHUKAR LOAN PAYMENT RECEIPT', 14, 20);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Receipt Date: ${new Date().toLocaleDateString()}`, 150, 20);
  doc.text(`Payment #${paymentDetails.paymentNumber || 1}`, 150, 26);

  // Customer & Pledge Details
  doc.setTextColor(51, 65, 85);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Customer Information', 14, 45);
  doc.text('Collateral / Pledge Details', 110, 45);

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Name: ${customer.name}`, 14, 52);
  doc.text(`Customer ID: ${customer.id}`, 14, 58);
  doc.text(`Mobile: ${customer.mobile}`, 14, 64);
  doc.text(`Address: ${customer.address || 'N/A'}`, 14, 70);

  doc.text(`Item: ${loan.collateral_type} (${loan.collateral_details})`, 110, 52);
  doc.text(`Gold Weight: ${loan.gold_weight_grams}g`, 110, 58);
  doc.text(`Monthly Rate: ${loan.monthly_rate}%`, 110, 64);

  // Table
  doc.autoTable({
    startY: 82,
    head: [['Transaction Breakdown', 'Amount (INR)']],
    body: [
      ['Total Paid Amount Received', `INR ${paymentDetails.amountPaid.toFixed(2)}`],
      ['Interest Payment Share', `INR ${paymentDetails.interestPaid.toFixed(2)}`],
      ['Principal Deduction Share', `INR ${paymentDetails.principalDeducted.toFixed(2)}`],
      ['Remaining Principal Balance', `INR ${paymentDetails.remainingPrincipal.toFixed(2)}`],
    ],
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    theme: 'grid',
  });

  const finalY = doc.lastAutoTable.finalY + 15;
  if (paymentDetails.remainingPrincipal === 0) {
    doc.setTextColor(16, 185, 129);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('STATUS: LOAN FULLY CLOSED', 14, finalY);
  } else {
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(9);
    doc.text('* Note: Interest calculated daily on pro-rata basis.', 14, finalY);
  }

  const safeName = customer.name.trim().replace(/[^a-z0-9]+/gi, '_');
  const paymentNumber = paymentDetails.paymentNumber || 1;
  const paymentLabel = paymentNumber === 1 ? '1st' : paymentNumber === 2 ? '2nd' : paymentNumber === 3 ? '3rd' : `${paymentNumber}th`;
  const statusLabel = paymentDetails.remainingPrincipal === 0 ? '_loan_closed' : '';
  doc.save(`${safeName}_${paymentLabel}_payment${statusLabel}.pdf`);
}