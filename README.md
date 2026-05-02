# JK Fenner CMMS Web Application

Simple JK Fenner CMMS web application built with Node.js, Express, EJS, and SQLite.

## Features

- Role-based authentication for `Admin`, `Manager`, and `Technician`
- Dashboard with MTTR, MTBF, total machines, active machines, and breakdown machines
- Machine management with service dates, hours, components, and maintenance history
- Work order creation, technician assignment, and status tracking
- Resource inventory with low-stock alerts and material usage by machine
- Safety incident reporting
- Dummy seed data for quick demo use

## Tech Stack

- Node.js
- Express
- SQLite via `node:sqlite`
- EJS templates
- Bootstrap 5

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm start
```

3. Open:

```text
http://localhost:3000
```

## Demo Accounts

- `admin@jkfenner.com / 123`
- `manager@jkfenner.com / 123`
- `ravi@jkfenner.com / 123`

Passwords are now stored as hashes in the SQLite database after seeding or on first startup against an older plain-text database.

## Database Tables

- `users`
- `machines`
- `machine_components`
- `materials`
- `work_orders`
- `material_usage`
- `safety_reports`

## Project Structure

```text
.
|-- db.js
|-- server.js
|-- public/
|   `-- styles.css
`-- views/
    |-- partials/
    |-- dashboard.ejs
    |-- login.ejs
    |-- machine-details.ejs
    |-- machines.ejs
    |-- resources.ejs
    |-- safety.ejs
    `-- work-orders.ejs
```
