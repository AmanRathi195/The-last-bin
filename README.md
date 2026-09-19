# The Last Bin

The Last Bin is a student exchange-kiosk prototype that combines camera-based object recognition, weighing-machine display OCR, and private student accounts.

## Student flow

1. Register using a university UID, full name, department, and password.
2. Sign in later using the same UID and password.
3. Start the camera and place one accepted object in the scanner area.
4. Keep it above 85% confidence for three continuous seconds.
5. The weighing-machine display is read automatically when the camera starts; manual weight entry remains an optional fallback.
6. Confirm the deposit. Supabase stores it only in that student's history.

Accepted model groups are bottles/cans, pens/pencils, and books/notebooks/paper. Other model classes are rejected as not exchangeable.

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

## Safe sharing

Share only the production Vercel URL with testers. Do not share Supabase dashboard access, private keys, passwords, or deployment credentials.
