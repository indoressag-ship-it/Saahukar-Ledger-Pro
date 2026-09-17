import { useState } from 'react';

export default function AuthPinModal({ onSuccess, savedPin = "1234" }) {
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState(false);

  const handleChange = (value, index) => {
    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);

    if (value && index < 3) {
      document.getElementById(`pin-input-${index + 1}`).focus();
    }

    if (newPin.join('').length === 4) {
      if (newPin.join('') === savedPin) {
        onSuccess();
      } else {
        setError(true);
        setPin(['', '', '', '']);
        document.getElementById(`pin-input-0`).focus();
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-95 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-2xl shadow-2xl text-center w-80 border border-slate-700">
        <h2 className="text-xl font-bold text-slate-800 mb-2">Sahukar Security Access</h2>
        <p className="text-sm text-slate-500 mb-6">Enter 4-Digit Security PIN</p>
        
        <div className="flex justify-center gap-3 mb-4">
          {pin.map((digit, idx) => (
            <input
              key={idx}
              id={`pin-input-${idx}`}
              type="password"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(e.target.value, idx)}
              className="w-12 h-12 text-center text-xl font-bold border-2 border-slate-300 rounded-lg focus:border-slate-800 focus:outline-none"
            />
          ))}
        </div>

        {error && <p className="text-red-500 text-xs mt-2 font-semibold">Invalid PIN! Try again.</p>}
      </div>
    </div>
  );
}