# The Last Bin

The Last Bin is a university-installed exchange-kiosk prototype that combines camera-based object recognition, weighing-machine display OCR, private student accounts, and a checkout-style deposit receipt.

## Student flow

1. Touch the attract screen and scan or enter a university UID.
2. Register the first time with UID, full name, department, and password; later visits need only UID and password.
3. After sign-in, the fixed full-screen kiosk starts the scanner and automatic weight reader without student controls.
4. Keep the same category above 85% confidence for three continuous seconds.
5. The scale display is read automatically. Weight status, manual fallback, and calibration controls open in a centered modal and close by clicking outside it.
6. Review the approved object, stable weight, and exact proportional reward in the three-step scanner, verification, and deposit flow. The “Points & rewards” popup shows the available balance, earning rates, and redeemable items.
7. Confirm the deposit. Supabase stores it only in that student's history, signs the student out, and returns directly to the login screen for the next student.
8. A signed-in student can choose an affordable reward, review the remaining balance, and confirm redemption. Supabase records the redemption and deducts its server-controlled cost.
9. The kiosk also signs out after two minutes of inactivity, and browser sessions are not persisted across refreshes.

Accepted model groups are bottles/cans, pens/pencils, and books/notebooks/paper. Other model classes are rejected as not exchangeable.

The signed-in screen is a no-scroll, cashier-style desktop interface. It shows the three-step workflow and a compact private account summary. A broad object/weight consistency check blocks obviously implausible readings before confirmation.

## Architecture

- Static HTML/CSS/JavaScript frontend hosted on Vercel
- Google Teachable Machine image model
- Tesseract.js weight-display OCR
- Supabase Auth, Postgres, Row Level Security, and an Edge Function for first-time card registration

The Supabase publishable key in `app.js` is intentionally public. Access is protected by Row Level Security. Never place a service-role or secret key in browser code.

## Reward scheme

New deposits earn points from their exact recorded weight:

- Books, notebooks, notes, and paper: 20 points per kg
- Bottles and cans: 10 points per kg
- Pens and pencils: 9 points per kg

Points are stored to three decimal places, so 500 g of books earns 10 points and 200 g of pens earns 1.8 points. Existing transaction rewards are preserved when the database column is upgraded.

Students can redeem their balance for an A4-size notebook (40 points), pen (5 points), pencil (4 points), pocket-size diary (15 points), sketch pens (25 points), or transparent folder (15 points).

Redemptions are stored in a separate, private ledger. Row Level Security limits students to their own records, while a database trigger controls item prices, rejects insufficient balances, and serializes simultaneous redemption attempts to prevent double-spending. The browser receives only the student's current available balance and recent redemption references.

## Prototype boundary

The software can identify categories, read the scale display, and save deposits. Motorized doors, door sensors, fill-level sensors, physical deposit verification, and automatic scale tare require hardware integration and are not simulated as completed features.

## Safe sharing

Share only the production Vercel URL with testers. Do not share Supabase dashboard access, private keys, passwords, or deployment credentials.
