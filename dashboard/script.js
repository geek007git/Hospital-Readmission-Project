document.addEventListener('DOMContentLoaded', () => {

    /* Background Animation Removed for Performance and Stability */

    /* =========================================
       2. SPA ROUTING
       ========================================= */
    const navItems = document.querySelectorAll('.nav-item');
    const pageViews = document.querySelectorAll('.page-view');
    
    navItems.forEach(item => {
        if(item.dataset.target) {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                // Remove active from all nav
                navItems.forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
                
                // Hide all views
                pageViews.forEach(view => {
                    view.style.display = 'none';
                    view.classList.remove('active');
                });
                
                // Show target view
                const targetView = document.getElementById(item.dataset.target);
                if(targetView) {
                    targetView.style.display = 'block';
                    // Force resize all charts so they render correctly when unhidden
                    setTimeout(() => {
                        Object.values(Chart.instances).forEach(chart => {
                            if(chart) chart.resize();
                        });
                        targetView.classList.add('active');
                    }, 50);
                }
            });
        }
    });

    /* =========================================
       3. REAL DATA FETCH & PROCESSING
       ========================================= */
    
    // Default Chart styling
    Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
    Chart.defaults.color = 'rgba(255, 255, 255, 0.6)';

    let hospitalData = [];

    // Automatically load dataset assuming a server is running serving parent directory
    Papa.parse('../hospital_readmission_fhir.csv', {
        download: true,
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function(results) {
            const dataStatus = document.getElementById('data-status');
            if(results.data && results.data.length > 0) {
                hospitalData = results.data;
                dataStatus.innerHTML = `<i class='bx bx-check-circle'></i> Data Synced (${hospitalData.length})`;
                dataStatus.style.color = '#00ff87';
                initializeDashboard(hospitalData);
            } else {
                dataStatus.innerHTML = `<i class='bx bx-error'></i> Failed to Load`;
                dataStatus.style.color = '#ff0844';
            }
        },
        error: function(err) {
            document.getElementById('data-status').innerHTML = `<i class='bx bx-error'></i> Network Error. Run server.`;
            document.getElementById('data-status').style.color = '#ff0844';
        }
    });

    function initializeDashboard(data) {
        /* ----- 3.1 DASHBOARD KPIs ----- */
        let highRiskCount = 0;
        let totalRiskScore = 0;
        let totalLOS = 0; 
        const riskDistribution = { Low: 0, Medium: 0, High: 0 };
        const diagStats = {}; 
        
        let deptCounts = {};
        let secondaryDiags = {};

        data.forEach(row => {
            if (row.Risk_Level === 'High') highRiskCount++;
            if (row.Readmission_Risk_Score) totalRiskScore += row.Readmission_Risk_Score;
            if (row.Length_of_Stay_Days) totalLOS += row.Length_of_Stay_Days;
            
            if(riskDistribution[row.Risk_Level] !== undefined) riskDistribution[row.Risk_Level]++;
            
            const diag = row.Primary_Diagnosis || 'Unknown';
            if(!diagStats[diag]) diagStats[diag] = { totalRisk: 0, count: 0 };
            diagStats[diag].count++;
            diagStats[diag].totalRisk += (row.Readmission_Risk_Score || 0);

            // Depts
            const dept = row.Department || 'Unknown';
            deptCounts[dept] = (deptCounts[dept] || 0) + (row.Readmission_Risk_Score || 0);

            // Comorbidities
            if(row.Secondary_Diagnoses && row.Secondary_Diagnoses !== 'None') {
                const arr = String(row.Secondary_Diagnoses).split(';');
                arr.forEach(a => {
                    const clean = a.trim();
                    secondaryDiags[clean] = (secondaryDiags[clean] || 0) + 1;
                });
            }
        });

        document.getElementById('kpi-total').textContent = data.length.toLocaleString();
        document.getElementById('kpi-high-risk').textContent = highRiskCount.toLocaleString();
        document.getElementById('kpi-mean-risk').textContent = (totalRiskScore / data.length).toFixed(3);
        document.getElementById('kpi-los').textContent = (totalLOS / data.length).toFixed(1) + ' d';

        const diagLabels = Object.keys(diagStats);
        const avgRiskData = diagLabels.map(d => diagStats[d].totalRisk / diagStats[d].count);
        
        renderDashboardCharts(diagLabels, avgRiskData, riskDistribution);
        
        /* ----- 3.2 PATIENTS TABLE ----- */
        renderPatientsTable(data.slice(0, 100)); // Render top 100 for fast UI
        
        /* ----- 3.3 ANALYTICS CHARTS ----- */
        renderAnalyticsCharts(data);

        /* ----- 3.4 REPORTS ----- */
        let worstDept = Object.keys(deptCounts).reduce((a, b) => deptCounts[a] > deptCounts[b] ? a : b);
        let worstComorb = Object.keys(secondaryDiags).reduce((a, b) => secondaryDiags[a] > secondaryDiags[b] ? a : b);
        
        document.getElementById('rep-dept').textContent = worstDept;
        document.getElementById('rep-diag').textContent = worstComorb;
        
        document.getElementById('narrative-report').innerHTML = `
            Based on the analysis of <strong>${data.length}</strong> patient records, the facility is managing a mean readmission risk score of <strong>${(totalRiskScore/data.length).toFixed(3)}</strong>. The department handling the highest cumulative risk burden is <strong>${worstDept}</strong>. Structurally, <strong>${worstComorb}</strong> represents the most frequent co-occurring condition among the patient population, heavily correlating with extended LOS. Over <strong>${highRiskCount}</strong> patients are currently classified mathematically as strict High Risk, requiring immediate preventative discharge planning interventions.
        `;

        // Patient Filter
        document.getElementById('risk-filter').addEventListener('change', (e) => {
            const val = e.target.value;
            if(val === 'All') renderPatientsTable(data.slice(0, 100));
            else {
                const filtered = data.filter(d => d.Risk_Level === val).slice(0, 100);
                renderPatientsTable(filtered);
            }
        });
    }

    let trendChartInstance, riskChartInstance, ageRiskInstance, chronicLosInstance, bpRiskInstance;

    function renderDashboardCharts(diagLabels, avgRiskData, riskDistribution) {
        const trendCtx = document.getElementById('trendChart').getContext('2d');
        const riskCtx = document.getElementById('riskChart').getContext('2d');

        const gradientPink = trendCtx.createLinearGradient(0, 0, 0, 400);
        gradientPink.addColorStop(0, 'rgba(255, 51, 102, 0.8)');
        gradientPink.addColorStop(1, 'rgba(255, 51, 102, 0.0)');

        trendChartInstance = new Chart(trendCtx, {
            type: 'bar',
            data: {
                labels: diagLabels,
                datasets: [{
                    label: 'Mean Risk Score',
                    data: avgRiskData,
                    backgroundColor: gradientPink,
                    borderColor: '#ff3366',
                    borderWidth: 1,
                    borderRadius: 6,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
                    x: { grid: { display: false }, border: { display: false } }
                }
            }
        });

        riskChartInstance = new Chart(riskCtx, {
            type: 'doughnut',
            data: {
                labels: ['Low Risk', 'Medium Risk', 'High Risk'],
                datasets: [{
                    data: [riskDistribution.Low, riskDistribution.Medium, riskDistribution.High],
                    backgroundColor: ['#00ff87', '#fce043', '#ff0844'],
                    borderWidth: 0, hoverOffset: 10
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '75%',
                plugins: {
                    legend: { position: 'bottom', labels: { usePointStyle: true, padding: 25, color: '#fff' } }
                }
            }
        });
    }

    function renderAnalyticsCharts(data) {
        // Analytics 1: Age vs Risk
        const ageCtx = document.getElementById('ageRiskChart').getContext('2d');
        const scatterData = data.slice(0, 600).map(d => ({ x: d.Age, y: d.Readmission_Risk_Score }));
        
        ageRiskInstance = new Chart(ageCtx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Patients',
                    data: scatterData,
                    backgroundColor: 'rgba(0, 242, 254, 0.5)',
                    borderColor: '#00f2fe',
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: 'Age (Years)', color: '#fff' } },
                    y: { title: { display: true, text: 'Readmission Risk Score', color: '#fff' } }
                },
                plugins: { legend: { display: false } }
            }
        });

        // Analytics 2: Chronic vs LOS
        const chronicCtx = document.getElementById('chronicLosChart').getContext('2d');
        let chrKeys = {};
        data.forEach(d => {
            if(!chrKeys[d.Num_Chronic_Conditions]) chrKeys[d.Num_Chronic_Conditions] = { los:0, c:0 };
            chrKeys[d.Num_Chronic_Conditions].los += d.Length_of_Stay_Days;
            chrKeys[d.Num_Chronic_Conditions].c++;
        });
        
        let cLabels = Object.keys(chrKeys).sort((a,b)=>a-b);
        let cData = cLabels.map(k => chrKeys[k].los / chrKeys[k].c);

        chronicLosInstance = new Chart(chronicCtx, {
            type: 'line',
            data: {
                labels: cLabels,
                datasets: [{
                    label: 'Avg Length of Stay (Days)',
                    data: cData,
                    borderColor: '#fce043',
                    backgroundColor: 'rgba(252, 224, 67, 0.2)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { x: { title: {display:true, text:'Num Chronic Conditions', color:'#fff'} } }
            }
        });

        // Analytics 3: BP Density
        const bpCtx = document.getElementById('bpRiskChart').getContext('2d');
        let hrBp = data.filter(d => d.Risk_Level === 'High').map(d => d.BP_Systolic_mmHg).slice(0,100);
        let lrBp = data.filter(d => d.Risk_Level === 'Low').map(d => d.BP_Systolic_mmHg).slice(0,100);
        
        bpRiskInstance = new Chart(bpCtx, {
            type: 'line',
            data: {
                labels: Array.from({length:100}, (_,i)=>i), 
                datasets: [
                    { label: 'High Risk Patients (Systolic BP)', data: hrBp, borderColor: '#ff0844', fill: false },
                    { label: 'Low Risk Patients (Systolic BP)', data: lrBp, borderColor: '#00ff87', fill: false }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { display: false } } }
        });
    }

    function renderPatientsTable(list) {
        const tbody = document.getElementById('all-patient-table-body');
        tbody.innerHTML = '';
        list.forEach(row => {
            const tr = document.createElement('tr');
            let riskClass = row.Risk_Level === 'High' ? 'risk-high' : row.Risk_Level === 'Medium' ? 'risk-medium' : 'risk-low';
            tr.innerHTML = `
                <td>
                    <div class="patient-cell">
                        <div class="patient-avatar" style="font-size:0.8rem; background:var(--grad-warning);">${row.Age}y</div>
                        <div class="patient-details">
                            <strong style="color:#00f2fe">${row.Patient_ID}</strong>
                            <span>Sex: ${row.Gender} | Chr: ${row.Num_Chronic_Conditions}</span>
                        </div>
                    </div>
                </td>
                <td>
                    <strong>${row.Primary_Diagnosis}</strong>
                    <div style="font-size:0.8rem; color:var(--text-muted)">ICD: ${row.Primary_ICD_Code}</div>
                </td>
                <td>${row.Discharge_Date || 'N/A'}</td>
                <td>BP: ${row.BP_Systolic_mmHg}/${row.BP_Diastolic_mmHg} | HR: ${row.Heart_Rate_bpm}</td>
                <td><span class="risk-badge ${riskClass}">${row.Risk_Level}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }
});
