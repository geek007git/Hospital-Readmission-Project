# Hospital Readmission Analytics — Clinical Protocol & AI Dashboard 🏥⚡

A production-grade medical analytics platform for hospital administrators and clinical staff. It leverages a **120B Parameter AI Model (GPT-OSS-120B)** via **OpenRouter** and **Vercel Serverless Functions** to provide highly accurate readmission risk analysis for a 3,000-patient dataset.

## ✨ High-End Features
- **📊 Real-Time Analytics**: Visual breakdown of risk level distributions (Low, Medium, High).
- **⚡ AI (120B Logic)**: Secure clinical data chat that processes all 3,000 patient records in real-time.
- **👩‍⚕️ Nurse Protocol System**: Actionable discharge recommendations (Block/Authorize) per patient.
- **🔐 Secure Architecture**: Hidden backend API proxying sensitive AI calls (Zero API key leakage in the browser).
- **🚀 Edge Optimized**: Blazing fast performance on Vercel with minimal time-to-interactive.

## 🏗️ Technology Stack
- **Frontend**: Vanilla JS (ES6+), Chart.js, Boxicons, Plus Jakarta Sans Typography.
- **Backend**: Vercel Serverless Functions (Node.js).
- **Intelligence**: OpenRouter (GPT-OSS-120B).
- **Data**: Clinical CSV processing (3,000 entries).

## 🚀 Setup & Execution
1.  Clone the repository.
2.  Install Vercel CLI.
3.  Add `OPENROUTER_API_KEY` to your Vercel Environment Variables.
4.  Run `vercel dev` locally or `vercel deploy` for production.

---
Developed as a production-grade hospital intelligence tool. Clinical safety filters integrated by design.
