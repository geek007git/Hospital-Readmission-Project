# CareSync - Hospital Readmission Analytics Dashboard

CareSync is a highly aesthetic, real-time Single Page Application (SPA) designed exclusively for medical scientists, doctors, and hospital administrators. It provides robust analytical visualizations without requiring a heavy backend framework. By securely parsing raw `.csv` patient clinical datasets directly within the browser ecosystem, it dynamically constructs comprehensive metrics, physiological distributions, and risk profiling charts locally under strict client-side isolation.

## Features

- **Real-Time SPA Routing**: Lightning fast navigation between Dashboard, Patients, Analytics, and Reporting views without reloading.
- **Client-Side Parsing Engine**: Automatically ingests and structurally parses `hospital_readmission_fhir.csv` securely within the browser utilizing PapaParse.
- **Glassmorphism Aesthetic UI**: A finely-tuned, responsive Dark-Mode architecture optimized simultaneously for desktop resolution and laptop aspect ratios with fluid cascading grid elements.
- **Scientific Visualizations**: 
    - Risk Stratification mean score indexing mapped by Primary Diagnosis profiles.
    - Density curve rendering comparing Systolic BP against low/high-risk patients.
    - Clinical Scatter logic charting continuous variables (Length of stay vs Total Comorbidities).
- **Automated Summary Reporting**: Algorithmically aggregates and pinpoints the most critical structural issues inside the dataset to generate a presentation-ready narrative text block.

## Technology Stack
- **Structure**: Native HTML5
- **Styling**: Pure CSS (Variables, Flexbox, Advanced CSS Grid scaling, Backdrop-filters)
- **Logic / State Flow**: Pure Vanilla JavaScript (ES6)
- **Data Engineering**: PapaParse (CSV Parsing engine built specifically for large array ingestion)
- **Charting Core**: Chart.js 3

## Installation and Local Serving

Because the dashboard securely fetches the raw CSV natively through XMLHttpRequests (fetch protocol), standard browser CORS policies require it to run over a local web-server rather than executing directly from a `file://` protocol.

### Requirements:
(Refer to \`requirements.txt\`)
A minimal Python installation to spin up a local server mapping.

### Launch Instructions:
1. Open your native terminal and navigate to the project's root folder:
   \`\`\`bash
   cd "path/to/project-folder"
   \`\`\`
2. Boot up the local Python directory server:
   \`\`\`bash
   python -m http.server 8000
   \`\`\`
3. Open your browser and navigate perfectly to:
   http://localhost:8000/dashboard/
