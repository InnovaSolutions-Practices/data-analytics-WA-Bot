# Customer Care Dashboard

A React-based customer care dashboard designed to help support teams access customer information and manage customer-related operations. The dashboard integrates with the WhatsApp Bot backend through APIs.

## Overview

The Customer Care Dashboard provides a centralized interface for customer support teams to view customer records and access customer details.

## Features

- **Customer Management:** View customer records retrieved from the backend API.
- **Customer Search:** Search and filter customer records.
- **Customer Details:** View individual customer information.
- **API Integration:** Fetch customer data from the WhatsApp Bot backend.
- **Order and Tracking Management:** Dashboard pages for order-related operations and tracking.
- **Responsive Interface:** React-based dashboard layout.

*Note: Feature availability depends on the current backend integration and implementation status.*

## Tech Stack

- React
- Vite
- JavaScript
- CSS
- React Router
- Fetch API
- Cloudflare Workers (backend API)

## Getting Started

### Prerequisites

- Node.js
- npm
- Git

### Installation

1. Clone the WA Bot repository and switch to the `development` branch:

   ```bash
   git clone -b development https://github.com/InnovaSolutions-Practices/data-analytics-WA-Bot.git
   ```

2. Navigate to the dashboard directory:

   ```bash
   cd data-analytics-WA-Bot/customer-care-dashboard
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open the local URL displayed in your terminal.

## Backend API

The dashboard connects to the WhatsApp Bot backend to retrieve customer information.

The customer API requires authorization. Configure authentication securely before running the application. Never commit private tokens, API keys, or other credentials to the repository.

## Project Status

**In Development**

Dashboard features and backend integration may continue to evolve.

## Team Collaboration

The dashboard is maintained within the WA Bot repository. Repository access and collaboration are managed through GitHub.

## License

Internal project. Not intended for public redistribution without permission.
