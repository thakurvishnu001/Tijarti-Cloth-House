# Tijarti Clothing Industry

A responsive women's clothing storefront with a persistent SQLite database and a Node.js backend. No npm packages or external database are required. Use Node.js 22.13 or later.

## Start

Run `node server.cjs` from this directory, then open http://127.0.0.1:8788.

On the first start, the terminal prints a one-time admin setup link. Open that link to choose a password of at least 8 characters for **tijarticlothingindustry@gmail.com**. No default password is included. The setup link stops working after the admin account is created. Customers can register from Account. Both login forms include a show/hide password button.

If Node on Windows reports an ancestor-path EPERM error, run `start.ps1` in PowerShell. It uses Node's native Windows path resolver, without changing filesystem permissions.

## Admin

Use Admin login in the footer. The dashboard supports:

- Add, edit and remove products, photos, descriptions, categories, sizes and stock.
- Any price from ₹1 to ₹10,00,000, with quick presets ₹699, ₹799 and ₹899.
- View customer orders, delivery information and submitted payment references.
- Review payments and progress orders through processing, shipping and delivery.
- Cancel orders and restore stock once. Refunds must be handled separately through the payment provider.
- View enquiries submitted through the contact form.
- Upload the brand logo and UPI QR image, and set the UPI ID and payee name.

The catalogue starts empty. Every published product requires an uploaded image; demonstration inventory is not created. Any untouched sample entries from the first build are archived automatically, while real merchant inventory is preserved. The four supplied attachments could not be downloaded in the restricted build environment; they have not been substituted with invented logo or payment information.

## Payments

Checkout calculates prices from the database, reserves stock transactionally and creates an order. It shows the store's uploaded QR and an amount-specific UPI deep link when configured. A customer can submit a UTR/reference. The order remains **Payment review** until an admin verifies the bank transaction. There is no automatic bank verification or payment gateway integration. A static QR may require the customer to enter the amount manually. Checkout is disabled until a UPI ID or QR has been configured.

## Email notifications

Enquiries always save to the database and appear in Admin. To enable automatic order and enquiry notification emails to tijarticlothingindustry@gmail.com, configure `RESEND_API_KEY` and `MAIL_FROM` as server environment variables. MAIL_FROM must be a sender permitted by your email provider. Never place credentials in browser code or commit them. Failed/unconfigured enquiry notifications are labelled in Admin; the enquiry remains saved. The supplied Gmail address alone cannot authorize outgoing email.

## Deploying

This standalone implementation is not deployed to Sites. Use a Node host with persistent disk and HTTPS, or adapt the backend to your chosen hosting service. Set `HOST=0.0.0.0`, `PORT` to the host port and `PUBLIC_ORIGIN` to the exact HTTPS website origin. HTTPS enables secure cookies. Back up the `data` directory, which contains the SQLite database and uploaded images. Keep that directory private; the server exposes only images under `data/uploads`.

Before accepting real orders, upload and verify the merchant QR/UPI, replace sample products, configure notifications, and provide the store's shipping, return and privacy terms. No shipping fees or additional taxes are currently added to displayed prices. Password reset by email, automatic refunds, payment webhooks and inventory expiry for unpaid orders are not implemented. Admin can cancel unpaid orders to release reserved stock.

## Verification

Run `node test.cjs`. Tests use an isolated temporary database and verify authorization, minimum password length, one-time setup, server-side prices, transactional stock, cancellation, UTR review, enquiry persistence, image validation and cross-origin protection.
