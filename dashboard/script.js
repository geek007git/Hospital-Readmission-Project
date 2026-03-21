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
    Papa.parse('/hospital_readmission_fhir.csv', {
        download: true,
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function(results) {
            const dataStatus = document.getElementById('data-status');
            if(results.data && results.data.length > 0) {
                hospitalData = results.data;
                window._chatData = hospitalData;   // expose to chat engine
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

        /* ----- 3.5 DISCHARGE PROTOCOL (NURSE TABLE) ----- */
        const lowPats  = data.filter(d => d.Risk_Level === 'Low');
        const medPats  = data.filter(d => d.Risk_Level === 'Medium');
        const highPats = data.filter(d => d.Risk_Level === 'High');

        document.getElementById('dc-count-low').textContent  = lowPats.length.toLocaleString();
        document.getElementById('dc-count-med').textContent  = medPats.length.toLocaleString();
        document.getElementById('dc-count-high').textContent = highPats.length.toLocaleString();

        let dcCurrentData = data.slice(0, 150);
        renderDischargeTable(dcCurrentData);

        document.getElementById('dc-filter').addEventListener('change', (e) => {
            const val = e.target.value;
            document.getElementById('dc-detail-panel').style.display = 'none';
            if(val === 'All') renderDischargeTable(data.slice(0, 150));
            else renderDischargeTable(data.filter(d => d.Risk_Level === val).slice(0, 150));
        });

        document.getElementById('dc-close-btn').addEventListener('click', () => {
            document.getElementById('dc-detail-panel').style.display = 'none';
        });
    }

    /* ---- Discharge Table Renderer ---- */
    function renderDischargeTable(list) {
        const tbody = document.getElementById('dc-table-body');
        tbody.innerHTML = '';
        list.forEach(row => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';

            let riskClass = row.Risk_Level === 'High' ? 'risk-high' : row.Risk_Level === 'Medium' ? 'risk-medium' : 'risk-low';

            let decisionHtml, decisionStyle;
            if(row.Risk_Level === 'High') {
                decisionHtml = '🚨 DO NOT DISCHARGE';
                decisionStyle = 'color:var(--accent-red); font-weight:800; font-size:0.75rem; background:rgba(244,63,94,0.1); padding:0.3rem 0.7rem; border-radius:6px; white-space:nowrap;';
            } else if(row.Risk_Level === 'Medium') {
                decisionHtml = '⚠️ DISCHARGE WITH CARE';
                decisionStyle = 'color:var(--accent-orange); font-weight:800; font-size:0.75rem; background:rgba(245,158,11,0.1); padding:0.3rem 0.7rem; border-radius:6px; white-space:nowrap;';
            } else {
                decisionHtml = '✅ OK TO DISCHARGE';
                decisionStyle = 'color:var(--accent-green); font-weight:800; font-size:0.75rem; background:rgba(16,185,129,0.1); padding:0.3rem 0.7rem; border-radius:6px; white-space:nowrap;';
            }

            tr.innerHTML = `
                <td><strong style="color:#00f2fe">${row.Patient_ID}</strong></td>
                <td>${row.Age} yrs / ${row.Gender}</td>
                <td>
                    <strong>${row.Primary_Diagnosis}</strong>
                    <div style="font-size:0.75rem;color:var(--text-secondary)">ICD: ${row.Primary_ICD_Code}</div>
                </td>
                <td>${row.Length_of_Stay_Days} days</td>
                <td>${parseFloat(row.Readmission_Risk_Score).toFixed(3)}</td>
                <td><span class="risk-badge ${riskClass}">${row.Risk_Level}</span></td>
                <td><span style="${decisionStyle}">${decisionHtml}</span></td>
            `;

            tr.addEventListener('click', () => showDischargeDetail(row));
            tbody.appendChild(tr);
        });
    }

    /* ---- Discharge Detail Panel ---- */
    function showDischargeDetail(p) {
        const panel = document.getElementById('dc-detail-panel');
        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

        document.getElementById('dc-detail-name').textContent = `Patient: ${p.Patient_ID}`;
        document.getElementById('dc-d-demo').textContent    = `${p.Age} yrs, ${p.Gender}`;
        document.getElementById('dc-d-diag').textContent    = p.Primary_Diagnosis;
        document.getElementById('dc-d-icd').textContent     = p.Primary_ICD_Code;
        document.getElementById('dc-d-second').textContent  = p.Secondary_Diagnoses || 'None';
        document.getElementById('dc-d-chronic').textContent = p.Num_Chronic_Conditions + ' conditions';
        document.getElementById('dc-d-los').textContent     = p.Length_of_Stay_Days + ' days';
        document.getElementById('dc-d-bp').textContent      = `${p.BP_Systolic_mmHg} / ${p.BP_Diastolic_mmHg} mmHg`;
        document.getElementById('dc-d-hr').textContent      = `${p.Heart_Rate_bpm} bpm`;
        document.getElementById('dc-d-score').textContent   = parseFloat(p.Readmission_Risk_Score).toFixed(4);
        document.getElementById('dc-d-dept').textContent    = p.Department || 'N/A';
        document.getElementById('dc-d-date').textContent    = p.Discharge_Date || 'N/A';

        const riskEl = document.getElementById('dc-d-level');
        if(p.Risk_Level === 'High') { riskEl.innerHTML = `<span class="risk-badge risk-high">HIGH</span>`; }
        else if(p.Risk_Level === 'Medium') { riskEl.innerHTML = `<span class="risk-badge risk-medium">MEDIUM</span>`; }
        else { riskEl.innerHTML = `<span class="risk-badge risk-low">LOW</span>`; }

        const nurseBox    = document.getElementById('dc-nurse-box');
        const nurseEmoji  = document.getElementById('dc-nurse-emoji');
        const nurseTitle  = document.getElementById('dc-nurse-title');
        const nurseDesc   = document.getElementById('dc-nurse-desc');
        const nurseAction = document.getElementById('dc-nurse-actions');

        if(p.Risk_Level === 'High') {
            nurseBox.style.background = 'rgba(244, 63, 94, 0.08)';
            nurseBox.style.border = '2px solid rgba(244, 63, 94, 0.35)';
            nurseEmoji.textContent = '🚨';
            nurseTitle.textContent = 'DO NOT DISCHARGE — HOLD IN WARD';
            nurseTitle.style.color = 'var(--accent-red)';
            nurseDesc.textContent  = 'This patient has a HIGH readmission risk score. Immediate discharge is unsafe. Nurse must notify the attending doctor, schedule specialist review, and continue observation. Do not sign discharge papers until risk drops to Medium or below.';
            nurseAction.innerHTML  = `
                <button style="background:var(--accent-red);color:#fff;border:none;padding:0.8rem 1.5rem;border-radius:8px;font-family:inherit;font-weight:700;cursor:pointer;font-size:0.95rem;" onclick="alert('Blocked. Escalated to attending physician.')">🔒 Block Discharge</button>
                <button style="background:transparent;color:var(--accent-red);border:2px solid var(--accent-red);padding:0.8rem 1.5rem;border-radius:8px;font-family:inherit;font-weight:700;cursor:pointer;font-size:0.95rem;" onclick="alert('Alert sent to Dr. Jenkins.')">📢 Alert Doctor</button>
            `;
        } else if(p.Risk_Level === 'Medium') {
            nurseBox.style.background = 'rgba(245, 158, 11, 0.08)';
            nurseBox.style.border = '2px solid rgba(245, 158, 11, 0.35)';
            nurseEmoji.textContent = '⚠️';
            nurseTitle.textContent = 'CONDITIONAL DISCHARGE — MONITOR CLOSELY';
            nurseTitle.style.color = 'var(--accent-orange)';
            nurseDesc.textContent  = 'This patient has a MEDIUM readmission risk. Discharge is possible, but only after confirming: (1) patient has a caretaker at home, (2) 48-hour follow-up call is scheduled, (3) discharge medications are clearly explained, and (4) patient acknowledges warning signs.';
            nurseAction.innerHTML  = `
                <button style="background:var(--accent-orange);color:#fff;border:none;padding:0.8rem 1.5rem;border-radius:8px;font-family:inherit;font-weight:700;cursor:pointer;font-size:0.95rem;" onclick="alert('Conditional discharge approved. Follow-up scheduled.')">✔️ Approve with Conditions</button>
                <button style="background:transparent;color:var(--accent-orange);border:2px solid var(--accent-orange);padding:0.8rem 1.5rem;border-radius:8px;font-family:inherit;font-weight:700;cursor:pointer;font-size:0.95rem;" onclick="alert('Follow-up call booked.')">📞 Book Follow-up Call</button>
            `;
        } else {
            nurseBox.style.background = 'rgba(16, 185, 129, 0.08)';
            nurseBox.style.border = '2px solid rgba(16, 185, 129, 0.35)';
            nurseEmoji.textContent = '✅';
            nurseTitle.textContent = 'SAFE TO DISCHARGE';
            nurseTitle.style.color = 'var(--accent-green)';
            nurseDesc.textContent  = 'This patient has a LOW readmission risk. Discharge can proceed normally. Hand over patient medications, provide standard discharge summary, and advise routine outpatient follow-up in 2–4 weeks.';
            nurseAction.innerHTML  = `
                <button style="background:var(--accent-green);color:#fff;border:none;padding:0.8rem 1.5rem;border-radius:8px;font-family:inherit;font-weight:700;cursor:pointer;font-size:0.95rem;" onclick="alert('Discharge authorized for ' + '${p.Patient_ID}')">✅ Authorize Release</button>
                <button style="background:transparent;color:var(--accent-green);border:2px solid var(--accent-green);padding:0.8rem 1.5rem;border-radius:8px;font-family:inherit;font-weight:700;cursor:pointer;font-size:0.95rem;" onclick="alert('Discharge summary printed.')">🖨️ Print Discharge Summary</button>
            `;
        }
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

/* ============================================================
   CHAT ENGINE — Production Grade (Backend Proxy)
   ============================================================ */
(function() {
    let _data = [];
    
    // In Production: Calls /api/chat (Serverless Proxy)
    // In Local Dev: Can fallback to localStorage key if needed
    let _localKey = localStorage.getItem('gemini_api_key') || null;

    const POLL = setInterval(() => {
        if (window._chatData && window._chatData.length > 0) {
            _data = window._chatData;
            clearInterval(POLL);
            if (document.getElementById('chat-total-patients')) {
                document.getElementById('chat-total-patients').textContent = _data.length.toLocaleString();
            }
        }
    }, 500);

    function now() {
        return new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    }

    function updateStatusUI() {
        const indicator = document.getElementById('key-indicator');
        const text = document.getElementById('key-text');
        const alertBox = document.getElementById('ai-system-alert');
        
        const isVercel = window.location.hostname.includes('vercel.app');
        
        if (isVercel || _localKey) {
            if (indicator) indicator.style.background = 'var(--accent-green)';
            if (text) text.textContent = 'AI ENGINE: SECURE BACKEND';
            if (alertBox) alertBox.style.display = 'none';
        } else {
            if (indicator) indicator.style.background = 'var(--accent-red)';
            if (text) text.textContent = 'AI ENGINE: OFFLINE (BASIC MODE)';
            if (alertBox) alertBox.style.display = 'block';
        }
    }

    function addMessage(text, role, htmlContent) {
        const box = document.getElementById('chat-messages');
        if (!box) return;
        const div = document.createElement('div');
        div.className = 'chat-msg ' + role;

        const avatarIcon = role === 'bot' ? 'bx-bot' : 'bx-user';
        const avatarClass = role === 'bot' ? 'bot-avatar' : 'user-avatar';
        const bubbleClass = role === 'bot' ? 'bot-bubble' : 'user-bubble';
        const label = role === 'bot' ? '<strong>CareSync AI Advisor</strong>' : '';

        div.innerHTML = `
            <div class="chat-avatar ${avatarClass}"><i class='bx ${avatarIcon}'></i></div>
            <div class="chat-bubble ${bubbleClass}">
                ${label}
                <div class="msg-content">${htmlContent || '<p>' + text + '</p>'}</div>
                <div class="chat-time">${now()}</div>
            </div>`;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    }

    function showTyping() {
        const el = document.getElementById('chat-typing');
        if (el) el.style.display = 'block';
    }
    function hideTyping() {
        const el = document.getElementById('chat-typing');
        if (el) el.style.display = 'none';
    }

    /* ---------- API CALL LOGIC ---------- */
    async function callAI(query) {
        // Build context data
        const total = _data.length;
        const high = _data.filter(d => d.Risk_Level === 'High').length;
        const med  = _data.filter(d => d.Risk_Level === 'Medium').length;
        const low  = _data.filter(d => d.Risk_Level === 'Low').length;
        const stats = `Total Patients: ${total}, High Risk: ${high}, Medium: ${med}, Low: ${low}`;

        // Strategy A: Try Production API
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, contextStats: stats })
            });

            const result = await response.json();
            if (response.ok) {
                return result.text;
            } else {
                return `<p style="color:var(--accent-red)">⚠️ Clinical Advisor Error: ${result.error || 'System unavailable'}</p>`;
            }
        } catch (e) {
            console.log("Production API unreachable.");
        }

        // Strategy B: Try Local Gemini Key (For local development)
        if (_localKey) {
            try {
                const response = await fetch(`https://openrouter.ai/api/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_localKey}` },
                    body: JSON.stringify({
                        model: "openai/gpt-oss-120b",
                        messages: [{ role: "user", content: `Clinical Stats: ${stats}\n\nUser Question: ${query}` }]
                    })
                });
                const result = await response.json();
                return result.choices[0].message.content;
            } catch (err) { return null; }
        }

        return null; // Fallback to basic mode
    }

    /* ---------- BASIC KEYWORD ENGINE ---------- */
    function processQueryBasic(q) {
        const ql = q.toLowerCase().trim();
        const high = _data.filter(d => d.Risk_Level === 'High').length;
        const low = _data.filter(d => d.Risk_Level === 'Low').length;

        if (ql.match(/how many high|risk count/)) {
            return { html: `<p>🔴 Analytical Report: There are <strong>${high}</strong> high-risk cases identified in the current cohort.</p>` };
        }
        if (ql.match(/safe.*discharg/)) {
            return { html: `<p>✅ Discharge Clearance: <strong>${low}</strong> patients meet the baseline criteria for safe discharge.</p>` };
        }
        return { html: `<p>🤔 (Basic Mode) The system is currently running in fallback mode. Connect the 120B AI backend for natural language clinical consulting.</p>` };
    }

    /* ---------- EVENT WIRING ---------- */
    document.addEventListener('DOMContentLoaded', () => {
        updateStatusUI();

        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send-btn');
        const clearBtn = document.getElementById('chat-clear-btn');

        async function handleSend() {
            const q = input.value.trim();
            if (!q || _data.length === 0) return;
            input.value = '';
            
            addMessage(q, 'user');
            showTyping();

            const aiResponse = await callAI(q);
            hideTyping();

            if (aiResponse) {
                addMessage('', 'bot', aiResponse);
            } else {
                const resp = processQueryBasic(q);
                addMessage('', 'bot', resp.html);
            }
        }

        if (sendBtn) sendBtn.addEventListener('click', handleSend);
        if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') handleSend(); });

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                document.getElementById('chat-messages').innerHTML = '';
                addMessage("Session reset. Clinical Advisor ready.", "bot");
            });
        }

        document.querySelectorAll('.chat-suggest-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                input.value = btn.dataset.q;
                handleSend();
            });
        });
    });
})();
