# The Last Bin

The Last Bin is a university-installed exchange-kiosk prototype that combines camera-based object recognition, weighing-machine display OCR, private student accounts, and a checkout-style deposit receipt.

## Student flow

1. Touch the attract screen and scan or enter a university UID.
2. Register the first time with UID, full name, department, and password; later visits need only UID and password.
3. After sign-in, the fixed full-screen kiosk starts the scanner and automatic weight reader without student controls.
4. Keep the same category above 85% confidence for three continuous seconds.
5. The scale display is read automatically. Weight status, manual fallback, and calibration controls open in a centered modal and close by clicking outside it.
6. Review the approved object, stable weight, and estimated reward in the three-step scanner, verification, and deposit flow.
7. Confirm the deposit. Supabase stores it only in that student's history, signs the student out, and returns directly to the login screen for the next student.
8. The kiosk also signs out after two minutes of inactivity, and browser sessions are not persisted across refreshes.

Accepted model groups are bottles/cans, pens/pencils, and books/notebooks/paper. Other model classes are rejected as not exchangeable.

The signed-in screen is a no-scroll, cashier-style desktop interface. It shows the three-step workflow and a compact private account summary. A broad object/weight consistency check blocks obviously implausible readings before confirmation.

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
