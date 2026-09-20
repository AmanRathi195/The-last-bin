# The Last Bin

The Last Bin is a university-installed exchange-kiosk prototype that combines camera-based object recognition, weighing-machine display OCR, private student accounts, and a checkout-style deposit receipt.

## Student flow

1. Touch the attract screen and scan or enter a university UID.
2. Register the first time with UID, full name, department, and password; later visits need only UID and password.
3. After sign-in, the scanner and automatic weight reader start without student controls. Place one accepted object with the scale display visible.
4. Keep the same category above 85% confidence for three continuous seconds.
5. The scale display is read automatically. The yellow OCR box is movable and manual entry stays behind an optional fallback.
6. Review the approved object, stable weight, and estimated reward.
7. Confirm the deposit. Supabase stores it only in that student's history and the current-session receipt updates immediately.
8. Finish the session to sign out. The kiosk also signs out after two minutes of inactivity, and browser sessions are not persisted across refreshes.

Accepted model groups are bottles/cans, pens/pencils, and books/notebooks/paper. Other model classes are rejected as not exchangeable.

The student screen shows only the active workflow and current-session receipt. Lifetime object-weight totals and prior transactions are collapsed by default; OCR calibration is placed in a separate staff setup section. A broad object/weight consistency check blocks obviously implausible readings before confirmation.

## Architecture

- Static HTML/CSS/JavaScript frontend hosted on Vercel
- Google Teachable Machine image model
- Tesseract.js weight-display OCR
- Supabase Auth, Postgres, Row Level Security, and an Edge Function for first-time card registration

The Supabase publishable key in `app.js` is intentionally public. Access is protected by Row Level Security. Never place a service-role or secret key in browser code.

## Current reward placeholder

- Pen or pencil: 2 points
- Bottle or can: approximately 1 point per 50 g
- Book, notebook, or paper: approximately 1 point per 100 g

Replace this placeholder after the final reward table is approved.

## Prototype boundary

The software can identify categories, read the scale display, and save deposits. Motorized doors, door sensors, fill-level sensors, physical deposit verification, and automatic scale tare require hardware integration and are not simulated as completed features.

## Safe sharing

Share only the production Vercel URL with testers. Do not share Supabase dashboard access, private keys, passwords, or deployment credentials.
