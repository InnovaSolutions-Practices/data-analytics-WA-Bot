# Customer Care Dashboard

A React-based customer care dashboard designed to help support teams access customer information and manage customer-related operations.

## Overview

The Customer Care Dashboard provides a centralized interface for customer support teams to view customer records and access customer details. It integrates with the WhatsApp Bot backend to retrieve customer information through APIs.

## Features

- **Customer Management:** View customer records retrieved from the backend API.
- **Customer Search:** Search and filter customer records.
- **Customer Details:** Dedicated interface for viewing individual customer information.
- **API Integration:** Fetch customer data from the WhatsApp Bot backend.
- **Responsive Interface:** Dashboard layout built with React.

*Note: Customer details and order history integration are still being developed.*

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

1. Clone the repository:

   ```bash
   git clone -b development https://github.com/InnovaSolutions-Practices/data-analytics-WA-Bot.git
   ```

2. Navigate to the project directory:

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

5. Open the local URL shown in your terminal.

## Backend API

The dashboard connects to the WhatsApp Bot backend to retrieve customer information.

The customer API requires authorization. Configure authentication securely before running the application. Do not commit private tokens, API keys, or other credentials to the repository.

## Project Status

**In Development**

Customer listing and backend integration are in progress. Customer details and related functionality are being developed.

## Team Collaboration

This repository is maintained for the Customer Care Dashboard project. Access is managed through GitHub collaborators.

## License

Internal project. Not intended for public redistribution without permission.
