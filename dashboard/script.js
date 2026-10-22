'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => Number(value).toLocaleString('en-US');
  const percent = value => `${(value * 100).toFixed(1)}%`;
  const average = (rows, key) => rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0;
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const formatDate = (value, options = { day:'numeric', month:'short', year:'numeric' }) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString('en-GB', { ...options, timeZone:'UTC' });
  };
  function readStored(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  const storedPreferences = readStored('caresync.preferences.v1', {});
  const storedReviews = readStored('caresync.reviews.v1', {});
  const state = {
    data: [], cohort: [], loaded: false, hospital:'all', period:'all', group:'month',
    view:'overview', patientPage:1, reviewPage:1, pageSize:[10,25,50].includes(storedPreferences?.pageSize) ? storedPreferences.pageSize : 10,
    compact: storedPreferences?.compact === true, reviews: storedReviews && typeof storedReviews === 'object' && !Array.isArray(storedReviews) ? storedReviews : {},
    chatBusy:false, selectedPatient:null, minDate:'', maxDate:''
  };
  const pages = {
    overview:['Overview','YOUR NETWORK, AT A GLANCE','A clearer picture of readmission risk. A better place to plan care.'],
    patients:['Patients','THE PEOPLE BEHIND THE NUMBERS','Find a patient, understand their risk, and see the full clinical context.'],
    analytics:['Risk analytics','THE PATTERNS THAT MATTER','Explore risk across diagnoses, age groups, and departments.'],
    discharge:['Care reviews','A MORE CONSIDERED NEXT STEP','A focused workspace for patient context and follow-up planning.'],
    reports:['Reports','THE BIGGER PICTURE','A clear, shareable summary of your selected patient cohort.'],
    chat:['Data assistant','A CONVERSATION WITH YOUR COHORT','Ask a question. Get a grounded view of the data in front of you.'],
    settings:['Preferences','YOUR WORKSPACE, YOUR WAY','A few small adjustments to make daily work feel easier.']
  };
  let toastTimeout;
  function toast(message) {
    clearTimeout(toastTimeout);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 4000);
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { toast('Browser storage is unavailable. Your changes could not be saved.'); return false; }
  }
  function closeMenu() {
    $('sidebar').classList.remove('open');
    $('sidebar-scrim').hidden = true;
    $('menu-button').setAttribute('aria-expanded','false');
    document.querySelector('.main-shell').inert = false;
    if (matchMedia('(max-width: 760px)').matches) $('sidebar').inert = true;
  }
  function navigate(view) {
    if (!pages[view]) view = 'overview';
    state.view = view;
    document.querySelectorAll('.page-view').forEach(section => {
      const active = section.id === `view-${view}`;
      section.classList.toggle('active',active);
      section.hidden = !active;
    });
    document.querySelectorAll('[data-view]').forEach(link => {
      const active = link.dataset.view === view;
      link.classList.toggle('active',active);
      if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
    const [title, eyebrow, description] = pages[view];
    $('page-title').textContent = title;
    $('breadcrumb-current').textContent = title;
    $('page-eyebrow').textContent = eyebrow;
    $('page-description').textContent = description;
    $('cohort-controls').hidden = view === 'settings';
    $('review-button').hidden = ['settings','discharge','chat'].includes(view);
    $('export-button').hidden = view === 'settings';
    document.title = `${title} · CareSync`;
    closeMenu();
    if (view === 'overview' && state.loaded) renderTrend();
  }
  function go(view) {
    if (location.hash === `#${view}`) navigate(view); else location.hash = view;
    window.scrollTo({top:0,behavior:'instant'});
  }

  // Parse quoted CSV fields (including escaped quotes and embedded line breaks).
  function parseCSV(text) {
    const rows = []; let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (char === ',' && !quoted) { row.push(field); field = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && text[i + 1] === '\n') i++;
        row.push(field); if (row.some(cell => cell.trim())) rows.push(row); row = []; field = '';
      } else field += char;
    }
    if (quoted) throw new Error('Invalid CSV: unfinished quoted field.');
    row.push(field); if (row.some(cell => cell.trim())) rows.push(row);
    const headers = rows.shift()?.map(header => header.replace(/^\uFEFF/,'').trim());
    const required = ['Patient_ID','Age','Readmission_Risk_Score','Risk_Level','Discharge_Date','Length_of_Stay_Days','Readmitted_Within_30Days'];
    if (!headers || required.some(key => !headers.includes(key))) throw new Error('Required patient columns are missing.');
    return rows.map(cells => Object.fromEntries(headers.map((key,i) => [key, cells[i]?.trim() ?? '']))).map(record => {
      ['Age','Readmission_Risk_Score','Length_of_Stay_Days','Readmitted_Within_30Days','Num_Chronic_Conditions','BP_Systolic_mmHg','BP_Diastolic_mmHg','Heart_Rate_bpm','O2_Saturation_pct','Num_Medications','Prev_Admissions_6Months'].forEach(key => { record[key] = Number(record[key]); });
      if (!record.Patient_ID || !['High','Medium','Low'].includes(record.Risk_Level) || !Number.isFinite(record.Readmission_Risk_Score) || record.Readmission_Risk_Score < 0 || record.Readmission_Risk_Score > 1 || !/^\d{4}-\d{2}-\d{2}$/.test(record.Discharge_Date) || !Number.isFinite(record.Age) || !Number.isFinite(record.Length_of_Stay_Days) || ![0,1].includes(record.Readmitted_Within_30Days)) throw new Error('Invalid patient record.');
      return record;
    });
  }
  async function loadData() {
    $('load-error').hidden = true;
    $('data-status').classList.remove('error');
    $('data-status').innerHTML = '<span class="status-dot"></span>Loading dataset';
    $('retry-button').disabled = true;
    try {
      const response = await fetch('/hospital_readmission_fhir.csv');
      if (!response.ok) throw new Error(`Dataset request failed: ${response.status}`);
      const data = parseCSV(await response.text());
      if (!data.length) throw new Error('Dataset has no patient records.');
      state.data = data;
      state.loaded = true;
      const dates = data.map(row => row.Discharge_Date).sort();
      state.minDate = dates[0]; state.maxDate = dates.at(-1);
      $('hospital-filter').innerHTML = '<option value="all">All hospitals</option>' + [...new Set(data.map(row => row.Hospital_Name))].sort().map(hospital => `<option value="${esc(hospital)}">${esc(hospital)}</option>`).join('');
      $('settings-dataset').textContent = `${number(data.length)} patient records · ${formatDate(state.minDate)} – ${formatDate(state.maxDate)}`;
      $('data-status').innerHTML = '<span class="status-dot"></span>Dataset connected';
      applyFilters();
    } catch (error) {
      state.loaded = false;
      $('load-error').hidden = false;
      $('data-status').classList.add('error');
      $('data-status').innerHTML = '<span class="status-dot"></span>Dataset unavailable';
      console.error('Unable to load patient data:', error.message);
    } finally { $('retry-button').disabled = false; }
  }
  function applyFilters() {
    if (!state.loaded) return;
    state.hospital = $('hospital-filter').value;
    state.period = $('period-filter').value;
    let cutoff = '';
    if (state.period !== 'all') {
      // Include the latest N calendar months present in the source, not today's date.
      const end = new Date(`${state.maxDate}T00:00:00Z`);
      end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() - Number(state.period) + 1);
      cutoff = end.toISOString().slice(0,10);
    }
    state.cohort = state.data.filter(row => (state.hospital === 'all' || row.Hospital_Name === state.hospital) && (!cutoff || row.Discharge_Date >= cutoff));
    state.patientPage = state.reviewPage = 1;
    $('reset-filters').hidden = state.hospital === 'all' && state.period === 'all';
    const dates = state.cohort.map(row => row.Discharge_Date).sort();
    $('dataset-date').textContent = dates.length ? `${formatDate(dates[0])} – ${formatDate(dates.at(-1))}` : 'No discharges in this selection';
    $('nav-patient-count').textContent = number(state.cohort.length);
    $('footer-records').textContent = `${number(state.cohort.length)} patient records`;
    renderOverview(); renderPatients(); renderAnalytics(); renderReviews(); renderReport();
    resetChat();
  }
  function grouped(rows, key) {
    const result = new Map();
    rows.forEach(row => { const label = typeof key === 'function' ? key(row) : row[key]; if (!result.has(label)) result.set(label,[]); result.get(label).push(row); });
    return [...result.entries()];
  }
  function monthlyData(rows, quarter = false) {
    const buckets = new Map(grouped(rows,row => quarter ? `${row.Discharge_Date.slice(0,4)}-Q${Math.floor((Number(row.Discharge_Date.slice(5,7))-1)/3)+1}` : row.Discharge_Date.slice(0,7)));
    if (!rows.length) return [];
    const dates = rows.map(row => row.Discharge_Date).sort();
    const cursor = new Date(`${dates[0].slice(0,7)}-01T00:00:00Z`);
    const end = new Date(`${dates.at(-1).slice(0,7)}-01T00:00:00Z`);
    const keys = new Set();
    while (cursor <= end) {
      keys.add(quarter ? `${cursor.getUTCFullYear()}-Q${Math.floor(cursor.getUTCMonth()/3)+1}` : cursor.toISOString().slice(0,7));
      cursor.setUTCMonth(cursor.getUTCMonth()+1);
    }
    return [...keys].map(key => ({ key, rows:buckets.get(key) || [], rate:buckets.has(key) ? average(buckets.get(key),'Readmitted_Within_30Days') : null }));
  }
  function sparkline(id, values, label) {
    const valid = values.filter(Number.isFinite);
    if (!valid.length) { $(id).innerHTML = ''; return; }
    const min = Math.min(...valid), range = Math.max(...valid) - min || 1;
    const points = values.map((value,i) => `${i * 60 / Math.max(values.length-1,1)},${22 - (value-min)/range * 18}`).join(' ');
    $(id).innerHTML = `<svg viewBox="0 0 60 25" role="img" aria-label="${esc(label)}"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function badge(level) { return `<span class="badge risk-${level.toLowerCase()}">${esc(level)} risk</span>`; }
  function patientCell(row, index) {
    return `<div class="patient-cell"><span class="patient-initial tone-${index%4}">${esc(row.Patient_ID.slice(-2))}</span><div><button class="patient-id" data-patient="${esc(row.Patient_ID)}">${esc(row.Patient_ID)}</button><span class="patient-demographic">${row.Age} years · ${esc(row.Gender)}</span></div></div>`;
  }
  function diagnosisCell(row) { return `<span class="diagnosis-main">${esc(row.Primary_Diagnosis)}</span><span class="diagnosis-sub">ICD-10 · ${esc(row.Primary_ICD_Code)}</span>`; }
  function scoreCell(row) {
    return `<div class="score-cell"><strong>${percent(row.Readmission_Risk_Score)}</strong><span class="score-track ${row.Risk_Level.toLowerCase()}" aria-hidden="true"><span style="width:${row.Readmission_Risk_Score*100}%"></span></span></div>`;
  }
  function openCell(row) { return `<button class="icon-button row-open" data-patient="${esc(row.Patient_ID)}" aria-label="View ${esc(row.Patient_ID)}">${icon('chevron')}</button>`; }
  function emptyRow(columns, title = 'No patients found', description = 'Try a different search or adjust your filters.') { return `<tr><td colspan="${columns}" class="empty-state"><strong>${title}</strong>${description}</td></tr>`; }
  function renderOverview() {
    const rows = state.cohort, high = rows.filter(row => row.Risk_Level === 'High').length;
    $('kpi-total').textContent = number(rows.length);
    $('kpi-high-risk').textContent = number(high);
    $('high-percentage').textContent = rows.length ? percent(high/rows.length) : '0.0%';
    $('kpi-mean-risk').textContent = rows.length ? percent(average(rows,'Readmission_Risk_Score')) : '—';
    $('kpi-los').innerHTML = rows.length ? `${average(rows,'Length_of_Stay_Days').toFixed(1)}<span class="metric-unit">days</span>` : '—';
    const monthly = monthlyData(rows).slice(-12);
    sparkline('spark-total',monthly.map(m => m.rows.length),'Patient volume over the last 12 available months');
    sparkline('spark-high',monthly.map(m => m.rows.filter(row => row.Risk_Level === 'High').length),'High-risk patient count by month');
    sparkline('spark-risk',monthly.map(m => average(m.rows,'Readmission_Risk_Score')),'Average risk by month');
    sparkline('spark-los',monthly.map(m => average(m.rows,'Length_of_Stay_Days')),'Average length of stay by month');
    renderTrend();
    const counts = ['Low','Medium','High'].map(level => rows.filter(row => row.Risk_Level === level).length);
    const low = rows.length ? counts[0]/rows.length*100 : 0, medium = rows.length ? counts[1]/rows.length*100 : 0;
    $('risk-donut').style.background = rows.length ? `conic-gradient(#79a58b 0% ${low}%, #d5b276 ${low}% ${low+medium}%, #d18a77 ${low+medium}% 100%)` : '#edf1ed';
    $('donut-total').textContent = number(rows.length);
    $('risk-donut').setAttribute('role','img');
    $('risk-donut').setAttribute('aria-label',`Risk distribution: ${counts[0]} low, ${counts[1]} medium, ${counts[2]} high risk patients`);
    $('risk-legend').innerHTML = ['Low','Medium','High'].map((level,i) => `<button data-risk="${level}" aria-label="View ${level.toLowerCase()}-risk patients"><span class="legend-dot ${level.toLowerCase()}"></span>${level} risk<strong>${number(counts[i])}</strong><span class="legend-percentage">${rows.length ? percent(counts[i]/rows.length) : '0.0%'}</span></button>`).join('');
    const priority = [...rows].sort((a,b) => b.Readmission_Risk_Score-a.Readmission_Risk_Score).slice(0,5);
    $('priority-count').textContent = number(high);
    $('priority-table').innerHTML = priority.map((row,i) => `<tr><td>${patientCell(row,i)}</td><td>${diagnosisCell(row)}</td><td>${esc(row.Department)}</td><td>${row.Length_of_Stay_Days} days</td><td>${scoreCell(row)}</td><td>${badge(row.Risk_Level)}</td><td>${openCell(row)}</td></tr>`).join('') || emptyRow(7);
    $('priority-footer').textContent = `Showing ${priority.length} of ${number(rows.length)} patients`;
    $('department-bars').innerHTML = grouped(rows,'Department').sort((a,b) => average(b[1],'Readmission_Risk_Score')-average(a[1],'Readmission_Risk_Score')).map(([department,patients]) => bar(department,average(patients,'Readmission_Risk_Score'))).join('') || '<p class="empty-state">No department data in this selection.</p>';
  }
  function renderTrend() {
    const groups = monthlyData(state.cohort,state.group === 'quarter');
    const container = $('trend-chart');
    if (!groups.length) { container.innerHTML = '<p class="empty-state">No discharge data for this selection.</p>'; $('trend-summary').textContent = ''; return; }
    const width = Math.max(300,container.clientWidth || 620), height = 210, left = 38, right = 14, top = 20, bottom = 35;
    const chartWidth = width-left-right, chartHeight = height-top-bottom;
    const max = Math.min(1,Math.max(.1,Math.ceil(Math.max(...groups.map(group => group.rate || 0))/.05)*.05));
    const points = groups.map((group,i) => ({x:left+(groups.length === 1 ? chartWidth/2 : i*chartWidth/(groups.length-1)),y:group.rate === null ? null : top+chartHeight-(group.rate/max)*chartHeight}));
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = top+chartHeight-i*chartHeight/4;
      grid += `<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${y}" y2="${y}"/><text class="chart-label" x="${left-10}" y="${y+3}" text-anchor="end">${Math.round(max*i/4*100)}%</text>`;
    }
    const every = Math.max(1,Math.ceil(groups.length/Math.max(3,Math.floor(chartWidth/65))));
    const labels = groups.map((group,i) => {
      if (i%every !== 0 && i !== groups.length-1) return '';
      if (i !== groups.length-1 && groups.length-1-i < every*.7) return '';
      const label = state.group === 'quarter' ? `${group.key.slice(-2)} '${group.key.slice(2,4)}` : formatDate(`${group.key}-01`,{month:'short',year:'2-digit'});
      return `<text class="chart-label" x="${points[i].x}" y="${height-10}" text-anchor="middle">${label}</text>`;
    }).join('');
    // Missing periods break the line instead of claiming a zero readmission rate.
    const segments = []; let current = [];
    points.forEach(point => { if (point.y === null) { if (current.length) segments.push(current); current=[]; } else current.push(point); });
    if (current.length) segments.push(current);
    const paths = segments.map(segment => {
      const line = segment.map((point,i) => `${i ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
      return `<path class="chart-area" d="${line} L${segment.at(-1).x},${top+chartHeight} L${segment[0].x},${top+chartHeight} Z"/><path class="chart-line" d="${line}"/>`;
    }).join('');
    const dots = points.map((point,i) => point.y === null ? '' : `<g class="chart-point" data-index="${i}" tabindex="0" role="img" aria-label="${esc(groups[i].key)}: ${percent(groups[i].rate)}, ${groups[i].rows.length} discharges"><circle class="chart-dot" cx="${point.x}" cy="${point.y}" r="2.8"/><circle cx="${point.x}" cy="${point.y}" r="10"/></g>`).join('');
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-label="${state.group === 'quarter' ? 'Quarterly' : 'Monthly'} readmission rates">${grid}${paths}${labels}${dots}</svg><div class="chart-tooltip" hidden></div>`;
    $('trend-summary').textContent = `${percent(average(state.cohort,'Readmitted_Within_30Days'))} overall rate`;
    const tooltip = container.querySelector('.chart-tooltip');
    container.querySelectorAll('.chart-point').forEach(element => {
      const index = Number(element.dataset.index), group = groups[index];
      const show = () => {
        const title = state.group === 'quarter' ? group.key : formatDate(`${group.key}-01`,{month:'long',year:'numeric'});
        tooltip.innerHTML = `<strong>${esc(title)} · ${percent(group.rate)}</strong><br>${number(group.rows.length)} discharges · ${number(group.rows.reduce((sum,row) => sum+row.Readmitted_Within_30Days,0))} readmissions`;
        tooltip.style.left = `${Math.max(19,Math.min(81,points[index].x/width*100))}%`;
        tooltip.style.top = `${Math.max(40,points[index].y/height*container.clientHeight)}px`;
        tooltip.hidden = false;
      };
      element.addEventListener('mouseenter',show); element.addEventListener('focus',show);
      element.addEventListener('mouseleave',() => { tooltip.hidden=true; }); element.addEventListener('blur',() => { tooltip.hidden=true; });
    });
  }
  function filteredPatients() {
    const query = $('patient-search').value.toLowerCase().trim(), risk = $('risk-filter').value;
    const rows = state.cohort.filter(row => (risk === 'all' || row.Risk_Level === risk) && (!query || [row.Patient_ID,row.FHIR_Patient_ID,row.Primary_Diagnosis,row.Department,row.Hospital_Name].some(value => String(value).toLowerCase().includes(query))));
    const sort = $('patient-sort').value;
    return rows.sort((a,b) => sort === 'risk-desc' ? b.Readmission_Risk_Score-a.Readmission_Risk_Score : sort === 'risk-asc' ? a.Readmission_Risk_Score-b.Readmission_Risk_Score : sort === 'date-desc' ? b.Discharge_Date.localeCompare(a.Discharge_Date) : a.Patient_ID.localeCompare(b.Patient_ID));
  }
  function paginate(rows, type) {
    const key = type === 'patient' ? 'patientPage' : 'reviewPage';
    const pages = Math.max(1,Math.ceil(rows.length/state.pageSize));
    state[key] = Math.min(Math.max(state[key],1),pages);
    const start = (state[key]-1)*state.pageSize;
    $(`${type}-page-info`).textContent = rows.length ? `${number(start+1)}–${number(Math.min(start+state.pageSize,rows.length))} of ${number(rows.length)} patients` : '0 patients';
    $(`${type}-page-number`).textContent = `${state[key]} / ${pages}`;
    $(`${type}-prev`).disabled = state[key] <= 1;
    $(`${type}-next`).disabled = state[key] >= pages;
    return rows.slice(start,start+state.pageSize);
  }
  function renderPatients() {
    const rows = paginate(filteredPatients(),'patient');
    $('patient-table').innerHTML = rows.map((row,i) => `<tr><td>${patientCell(row,i)}</td><td>${diagnosisCell(row)}</td><td>${esc(row.Department)}</td><td>${formatDate(row.Discharge_Date)}</td><td>${scoreCell(row)}</td><td>${badge(row.Risk_Level)}</td><td>${openCell(row)}</td></tr>`).join('') || emptyRow(7);
  }
  function bar(label, value, count) {
    return `<div class="horizontal-chart-row"><div class="department-bar-label"><span>${esc(label)}${count === undefined ? '' : `<small>n = ${number(count)}</small>`}</span><strong>${percent(value)}</strong></div><div class="department-track" role="img" aria-label="${esc(label)}: ${percent(value)} average risk"><span style="width:${value*100}%"></span></div></div>`;
  }
  function renderAnalytics() {
    const rows = state.cohort;
    $('diagnosis-chart').innerHTML = grouped(rows,'Primary_Diagnosis').sort((a,b) => average(b[1],'Readmission_Risk_Score')-average(a[1],'Readmission_Risk_Score')).map(([label,patients]) => bar(label,average(patients,'Readmission_Risk_Score'),patients.length)).join('') || '<p class="empty-state">No diagnoses in this selection.</p>';
    $('age-chart').innerHTML = [[0,39,'Under 40'],[40,49,'40–49 years'],[50,59,'50–59 years'],[60,69,'60–69 years'],[70,79,'70–79 years'],[80,150,'80+ years']].map(([min,max,label]) => { const patients=rows.filter(row => row.Age >= min && row.Age <= max); return patients.length ? bar(label,average(patients,'Readmission_Risk_Score'),patients.length) : ''; }).join('') || '<p class="empty-state">No age data in this selection.</p>';
    $('los-chart').innerHTML = ['Low','Medium','High'].map(level => { const patients=rows.filter(row => row.Risk_Level === level); return `<div class="los-card">${badge(level)}<strong>${patients.length ? average(patients,'Length_of_Stay_Days').toFixed(1) : '—'}</strong><small>average days</small></div>`; }).join('');
    $('department-table').innerHTML = grouped(rows,'Department').sort((a,b) => average(b[1],'Readmission_Risk_Score')-average(a[1],'Readmission_Risk_Score')).map(([label,patients]) => `<tr><td><strong class="diagnosis-main">${esc(label)}</strong></td><td>${number(patients.length)}</td><td>${number(patients.filter(row => row.Risk_Level === 'High').length)}</td><td>${percent(average(patients,'Readmission_Risk_Score'))}</td><td>${percent(average(patients,'Readmitted_Within_30Days'))}</td><td>${average(patients,'Length_of_Stay_Days').toFixed(1)} days</td></tr>`).join('') || emptyRow(6,'No department data','Adjust the cohort filters.');
  }
  const isReviewed = row => state.reviews[row.Patient_ID]?.reviewed === true;
  function reviewPatients() {
    const filter = $('review-filter').value;
    return state.cohort.filter(row => filter === 'all' || (filter === 'reviewed' ? isReviewed(row) : !isReviewed(row))).sort((a,b) => b.Readmission_Risk_Score-a.Readmission_Risk_Score);
  }
  function renderReviews() {
    const reviewed = state.cohort.filter(isReviewed).length;
    const highPending = state.cohort.filter(row => row.Risk_Level === 'High' && !isReviewed(row)).length;
    $('review-summary').innerHTML = `<div><h3>Awaiting review</h3><strong>${number(state.cohort.length-reviewed)}</strong><p>In the selected cohort</p></div><div><h3>High-risk, unreviewed</h3><strong>${number(highPending)}</strong><p>Prioritize clinical context</p></div><div><h3>Reviewed locally</h3><strong>${number(reviewed)}</strong><p>Saved in this browser</p></div>`;
    const rows = paginate(reviewPatients(),'review');
    $('review-table').innerHTML = rows.map((row,i) => `<tr><td>${patientCell(row,i)}</td><td>${diagnosisCell(row)}</td><td>${esc(row.Department)}</td><td>${badge(row.Risk_Level)}</td><td><span class="badge ${isReviewed(row) ? 'reviewed-badge' : 'pending-badge'}">${isReviewed(row) ? 'Reviewed' : 'Awaiting review'}</span></td><td>${openCell(row)}</td></tr>`).join('') || emptyRow(6,'No reviews in this selection','Change the review status or cohort filters.');
  }
  function renderReport() {
    const rows = state.cohort;
    $('report-scope').textContent = `${state.hospital === 'all' ? 'All hospitals' : state.hospital} · ${$('dataset-date').textContent}`;
    if (!rows.length) { $('report-content').innerHTML = '<p class="empty-state">No patient records in this selection.</p>'; return; }
    const departments = grouped(rows,'Department').sort((a,b) => average(b[1],'Readmission_Risk_Score')-average(a[1],'Readmission_Risk_Score'));
    const diagnoses = grouped(rows,'Primary_Diagnosis').sort((a,b) => b[1].length-a[1].length);
    const high = rows.filter(row => row.Risk_Level === 'High').length;
    $('report-content').innerHTML = `<div class="report-metrics"><div><small>Patient records</small><strong>${number(rows.length)}</strong></div><div><small>Average risk</small><strong>${percent(average(rows,'Readmission_Risk_Score'))}</strong></div><div><small>High-risk patients</small><strong>${number(high)}</strong></div><div><small>30-day readmission rate</small><strong>${percent(average(rows,'Readmitted_Within_30Days'))}</strong></div></div><section class="report-section"><h3>Cohort overview</h3><p>This selection contains <strong>${number(rows.length)} patients</strong> with an average estimated readmission risk of <strong>${percent(average(rows,'Readmission_Risk_Score'))}</strong>. The average length of stay is <strong>${average(rows,'Length_of_Stay_Days').toFixed(1)} days</strong>. Recorded readmissions within 30 days total <strong>${number(rows.reduce((sum,row) => sum+row.Readmitted_Within_30Days,0))}</strong>.</p></section><section class="report-section"><h3>Where to focus review</h3><p><strong>${number(high)} patients (${percent(high/rows.length)})</strong> are categorized as high risk in the source data. <strong>${esc(departments[0][0])}</strong> has the highest average estimated risk at <strong>${percent(average(departments[0][1],'Readmission_Risk_Score'))}</strong>, across ${number(departments[0][1].length)} patients. These descriptive results can help organize a clinical review queue.</p></section><section class="report-section"><h3>Most frequent primary diagnosis</h3><p><strong>${esc(diagnoses[0][0])}</strong> is the most common primary diagnosis, recorded for <strong>${number(diagnoses[0][1].length)} patients (${percent(diagnoses[0][1].length/rows.length)})</strong>. The average estimated risk within this diagnosis group is <strong>${percent(average(diagnoses[0][1],'Readmission_Risk_Score'))}</strong>.</p></section>`;
  }
  function openPatient(id) {
    const row = state.data.find(patient => patient.Patient_ID === id);
    if (!row) return;
    state.selectedPatient = id;
    const review = state.reviews[id] || {};
    $('detail-title').textContent = row.Patient_ID;
    const detail = (label,value) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`;
    $('patient-detail').innerHTML = `<div class="detail-intro"><span>${row.Age} years · ${esc(row.Gender)}</span>${badge(row.Risk_Level)}</div><h3 class="detail-diagnosis">${esc(row.Primary_Diagnosis)}</h3><p class="detail-subtitle">${esc(row.Hospital_Name)}<br>${esc(row.Department)} · ICD-10 ${esc(row.Primary_ICD_Code)}</p><div class="risk-detail"><div><strong>${percent(row.Readmission_Risk_Score)}</strong><small>Estimated readmission risk</small></div><small>Source dataset score<br>Clinical review required</small></div><section class="detail-section"><h3>ENCOUNTER DETAILS</h3><dl class="detail-grid">${detail('Admitted',formatDate(row.Admission_Date))}${detail('Discharged',formatDate(row.Discharge_Date))}${detail('Length of stay',`${row.Length_of_Stay_Days} days`)}${detail('Discharge disposition',row.Discharge_Disposition)}${detail('Chronic conditions',row.Num_Chronic_Conditions)}${detail('Medications',row.Num_Medications)}${detail('Previous admissions / 6 months',row.Prev_Admissions_6Months)}${detail('30-day readmission',row.Readmitted_Within_30Days ? 'Recorded' : 'Not recorded')}</dl></section><section class="detail-section"><h3>RECORDED VITAL SIGNS</h3><div class="vital-grid"><div class="vital"><small>Blood pressure</small><strong>${row.BP_Systolic_mmHg}/${row.BP_Diastolic_mmHg}</strong><em>mmHg</em></div><div class="vital"><small>Heart rate</small><strong>${row.Heart_Rate_bpm}</strong><em>beats / min</em></div><div class="vital"><small>Oxygen saturation</small><strong>${row.O2_Saturation_pct}</strong><em>% SpO₂</em></div></div></section><section class="detail-section"><h3>SECONDARY DIAGNOSES</h3><p class="detail-subtitle">${esc(row.Secondary_Diagnoses || 'None recorded')}</p></section><section class="detail-section"><h3>LOCAL CARE REVIEW</h3><label for="review-note">Review note</label><textarea id="review-note" maxlength="4000" placeholder="Add context or follow-up considerations…">${esc(review.note || '')}</textarea><div class="detail-actions"><button class="button primary" id="save-review">${icon('check')}${review.reviewed ? 'Save reviewed record' : 'Mark as reviewed'}</button><button class="button secondary" id="save-note">Save note</button>${review.reviewed ? '<button class="text-button" id="reopen-review">Reopen review</button>' : ''}</div><p class="detail-saved" id="review-save-status">${review.savedAt ? `Last saved ${esc(new Date(review.savedAt).toLocaleString())}.` : 'Notes stay on this device and do not update hospital records.'}</p></section>`;
    $('save-review').addEventListener('click',() => saveReview(id,true));
    $('save-note').addEventListener('click',() => saveReview(id,review.reviewed === true));
    $('reopen-review')?.addEventListener('click',() => saveReview(id,false));
    const dialog = $('patient-dialog');
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }
  function saveReview(id, reviewed) {
    const next = {...state.reviews,[id]:{note:$('review-note').value.trim(),reviewed,savedAt:new Date().toISOString()}};
    if (!store('caresync.reviews.v1',next)) return;
    state.reviews = next;
    const scroll = $('patient-dialog').scrollTop;
    renderReviews(); openPatient(id);
    $('patient-dialog').scrollTop = scroll;
    $('review-save-status').textContent = reviewed ? 'Review saved in this browser.' : 'Note saved in this browser. Patient remains in the review queue.';
  }
  function exportData() {
    if (!state.loaded) { toast('Load the patient dataset before exporting.'); return; }
    const rows = state.view === 'patients' ? filteredPatients() : state.view === 'discharge' ? reviewPatients() : state.cohort;
    if (!rows.length) { toast('No patient records match this selection.'); return; }
    const headers = Object.keys(state.data[0]);
    const csvCell = value => {
      let text = String(value ?? '');
      if (/^[\s]*[=+@-]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g,'""')}"`;
    };
    const csv = '\uFEFF' + [headers,...rows.map(row => headers.map(key => row[key]))].map(cells => cells.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
    const anchor = document.createElement('a'); anchor.href=url; anchor.download=`caresync-${state.view}-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
    toast(`Exported ${number(rows.length)} patient records.`);
  }
  function appendMessage(text, role, html = false) {
    const message = document.createElement('div'); message.className = `chat-message ${role}`;
    const label = document.createElement('div'); label.className='message-label'; label.textContent=role === 'user' ? 'YOU' : 'CARESYNC'; message.appendChild(label);
    const content = document.createElement('div');
    if (html) content.innerHTML = text; else { content.style.whiteSpace='pre-wrap'; content.textContent=text; }
    message.appendChild(content); $('chat-messages').appendChild(message); $('chat-messages').scrollTop=$('chat-messages').scrollHeight;
    return message;
  }
  function resetChat() {
    // Keep in-flight answers bound to the cohort that was submitted.
    if (state.chatBusy) { state.resetChatAfterResponse=true; return; }
    $('chat-messages').replaceChildren();
    appendMessage(state.cohort.length ? `You’re looking at ${number(state.cohort.length)} patient records. I can help you explore risk levels, length of stay, diagnoses, and departments. What would you like to know?` : 'Select a cohort with patient records to start exploring.','bot');
    $('assistant-status').textContent='Dataset questions, answered in context';
  }
  function localAnswer(query, rows) {
    const q = query.toLowerCase();
    if (/high[ -]?risk|risk.*count/.test(q) && !/department|diagnos/.test(q)) {
      const high = rows.filter(row => row.Risk_Level === 'High').length;
      return `${number(high)} patients (${percent(high/rows.length)}) are categorized as high risk in the selected cohort of ${number(rows.length)} records. You can review their clinical context under Patients or Care reviews.`;
    }
    if (/length of stay|average stay|avg.*los/.test(q)) return `The average length of stay is ${average(rows,'Length_of_Stay_Days').toFixed(1)} days across ${number(rows.length)} patients in this cohort.`;
    if (/department/.test(q)) {
      const departments = grouped(rows,'Department').sort((a,b) => /most.*high|high.*most/.test(q) ? b[1].filter(row => row.Risk_Level === 'High').length-a[1].filter(row => row.Risk_Level === 'High').length : average(b[1],'Readmission_Risk_Score')-average(a[1],'Readmission_Risk_Score'));
      const [department,patients]=departments[0];
      return `${department} ${/most.*high|high.*most/.test(q) ? 'has the largest high-risk patient count' : 'has the highest average estimated risk'} in this selection: ${percent(average(patients,'Readmission_Risk_Score'))} average risk across ${number(patients.length)} patients, including ${number(patients.filter(row => row.Risk_Level === 'High').length)} high-risk patients.`;
    }
    if (/common.*diagnos|top.*diagnos/.test(q)) { const [diagnosis,patients]=grouped(rows,'Primary_Diagnosis').sort((a,b) => b[1].length-a[1].length)[0]; return `${diagnosis} is the most common primary diagnosis: ${number(patients.length)} patients, or ${percent(patients.length/rows.length)} of the selected cohort.`; }
    if (/mean.*risk|average.*risk|risk.*average/.test(q)) return `The average estimated readmission risk is ${percent(average(rows,'Readmission_Risk_Score'))} across ${number(rows.length)} patients. These are scores supplied by the dataset.`;
    if (/readmission.*rate|readmitted/.test(q)) return `${number(rows.reduce((sum,row) => sum+row.Readmitted_Within_30Days,0))} of ${number(rows.length)} patients have a recorded readmission within 30 days, a rate of ${percent(average(rows,'Readmitted_Within_30Days'))}.`;
    if (/discharg|safe/.test(q)) return `This cohort contains ${number(rows.filter(row => row.Risk_Level === 'Low').length)} low-risk patients. A low estimated risk score does not establish discharge readiness. Review each patient's clinical context with the treating team.`;
    if (/how many|total|count/.test(q)) return `The selected cohort includes ${number(rows.length)} patients: ${['Low','Medium','High'].map(level => `${number(rows.filter(row => row.Risk_Level === level).length)} ${level.toLowerCase()} risk`).join(', ')}.`;
    return null;
  }
  function safeResponse(html) {
    const source = new DOMParser().parseFromString(String(html),'text/html');
    const allowed = new Set(['P','UL','OL','LI','STRONG','B','EM','BR','H3','H4']);
    const clean = document.createElement('div');
    function walk(node,target) {
      if (node.nodeType === Node.TEXT_NODE) { target.appendChild(document.createTextNode(node.textContent)); return; }
      if (node.nodeType !== Node.ELEMENT_NODE || ['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH'].includes(node.tagName)) return;
      const element = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : target;
      if (element !== target) target.appendChild(element);
      node.childNodes.forEach(child => walk(child,element));
    }
    source.body.childNodes.forEach(node => walk(node,clean));
    return clean.innerHTML;
  }
  async function sendMessage(query) {
    if (state.chatBusy) return;
    if (!state.loaded || !state.cohort.length) { toast('Select a cohort with patient records first.'); return; }
    const trimmed = query.trim().slice(0,2000); if (!trimmed) return;
    const rows = [...state.cohort];
    $('chat-input').value=''; appendMessage(trimmed,'user');
    const answer = localAnswer(trimmed,rows);
    if (answer) { appendMessage(answer,'bot'); return; }
    state.chatBusy=true; $('chat-send-btn').disabled=true; $('chat-clear-btn').disabled=true;
    const pending=appendMessage('Looking into your question…','bot');
    const controller = new AbortController(), timeout=setTimeout(() => controller.abort(),20000);
    try {
      const contextStats=JSON.stringify({patients:rows.length,meanRisk:average(rows,'Readmission_Risk_Score'),averageLOS:average(rows,'Length_of_Stay_Days'),readmissionRate:average(rows,'Readmitted_Within_30Days'),riskLevels:Object.fromEntries(['Low','Medium','High'].map(level => [level,rows.filter(row => row.Risk_Level === level).length])),departments:grouped(rows,'Department').map(([name,patients]) => ({name,patients:patients.length,meanRisk:average(patients,'Readmission_Risk_Score')}))});
      const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:trimmed,contextStats}),signal:controller.signal});
      if (!response.ok) throw new Error('Assistant unavailable');
      const result=await response.json();
      if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('Empty response');
      pending.remove(); appendMessage(safeResponse(result.text),'bot',true);
      $('assistant-status').textContent='Connected assistant · summary context';
    } catch {
      pending.remove(); appendMessage('The connected assistant is unavailable right now. You can still ask about high-risk counts, average stay, diagnoses, departments, or recorded readmission rates — those answers are calculated directly from your selected cohort.','bot');
      $('assistant-status').textContent='Local dataset answers available';
    } finally {
      clearTimeout(timeout); state.chatBusy=false; $('chat-send-btn').disabled=false; $('chat-clear-btn').disabled=false;
      if (state.resetChatAfterResponse) { state.resetChatAfterResponse=false; resetChat(); }
    }
  }

  // Navigation and delegated row actions keep freshly rendered tables interactive.
  window.addEventListener('hashchange',() => navigate(location.hash.slice(1)));
  document.addEventListener('click',event => {
    const target=event.target.closest('[data-go],[data-patient],[data-risk],[data-question]');
    if (!target) return;
    if (target.dataset.go) go(target.dataset.go);
    if (target.dataset.patient) openPatient(target.dataset.patient);
    if (target.dataset.risk) { $('risk-filter').value=target.dataset.risk; state.patientPage=1; renderPatients(); go('patients'); }
    if (target.dataset.question) sendMessage(target.dataset.question);
  });
  $('hospital-filter').addEventListener('change',applyFilters);
  $('period-filter').addEventListener('change',applyFilters);
  $('reset-filters').addEventListener('click',() => { $('hospital-filter').value='all'; $('period-filter').value='all'; applyFilters(); });
  document.querySelectorAll('[data-group]').forEach(button => button.addEventListener('click',() => {
    state.group=button.dataset.group;
    document.querySelectorAll('[data-group]').forEach(item => { const active=item === button; item.classList.toggle('active',active); item.setAttribute('aria-pressed',String(active)); });
    renderTrend();
  }));
  ['patient-search','risk-filter','patient-sort'].forEach(id => $(id).addEventListener(id === 'patient-search' ? 'input' : 'change',() => { state.patientPage=1; renderPatients(); }));
  $('review-filter').addEventListener('change',() => { state.reviewPage=1; renderReviews(); });
  ['patient','review'].forEach(type => ['prev','next'].forEach(direction => $(`${type}-${direction}`).addEventListener('click',() => { state[type === 'patient' ? 'patientPage' : 'reviewPage'] += direction === 'prev' ? -1 : 1; type === 'patient' ? renderPatients() : renderReviews(); })));
  $('review-button').addEventListener('click',() => go('discharge'));
  $('view-high-risk').addEventListener('click',() => { $('risk-filter').value='High'; $('patient-search').value=''; state.patientPage=1; renderPatients(); go('patients'); });
  const focusSearch=() => { go('patients'); $('patient-search').focus(); };
  $('search-shortcut').addEventListener('click',focusSearch);
  document.addEventListener('keydown',event => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); focusSearch(); }
    if (event.key === 'Escape' && $('sidebar').classList.contains('open')) { closeMenu(); $('menu-button').focus(); }
  });
  $('menu-button').addEventListener('click',() => {
    const open=!$('sidebar').classList.contains('open');
    $('sidebar').classList.toggle('open',open); $('sidebar').inert=!open; $('sidebar-scrim').hidden=!open; $('menu-button').setAttribute('aria-expanded',String(open));
    document.querySelector('.main-shell').inert=open;
    if (open) $('sidebar').querySelector('.nav-link.active').focus();
  });
  $('sidebar-scrim').addEventListener('click',() => { closeMenu(); $('menu-button').focus(); });
  matchMedia('(max-width: 760px)').addEventListener('change',event => { closeMenu(); $('sidebar').inert=event.matches; });
  $('patient-dialog').addEventListener('click',event => { if (event.target === $('patient-dialog')) { const bounds=event.target.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right) event.target.close(); } });
  $('detail-close').addEventListener('click',() => $('patient-dialog').close());
  $('help-button').addEventListener('click',() => { closeMenu(); $('about-dialog').showModal(); });
  ['about-close','about-done'].forEach(id => $(id).addEventListener('click',() => $('about-dialog').close()));
  $('export-button').addEventListener('click',exportData);
  $('retry-button').addEventListener('click',loadData);
  $('print-report').addEventListener('click',() => window.print());
  $('chat-form').addEventListener('submit',event => { event.preventDefault(); sendMessage($('chat-input').value); });
  $('chat-clear-btn').addEventListener('click',resetChat);
  $('compact-setting').checked=state.compact; document.body.classList.toggle('compact',state.compact);
  $('page-size-setting').value=String(state.pageSize);
  function savePreferences() { store('caresync.preferences.v1',{compact:state.compact,pageSize:state.pageSize}); }
  $('compact-setting').addEventListener('change',event => { state.compact=event.target.checked; document.body.classList.toggle('compact',state.compact); savePreferences(); });
  $('page-size-setting').addEventListener('change',event => { state.pageSize=Number(event.target.value); state.patientPage=state.reviewPage=1; savePreferences(); renderPatients(); renderReviews(); });
  navigate(location.hash.slice(1));
  new ResizeObserver(() => { if (state.loaded && $('trend-chart').clientWidth > 0) renderTrend(); }).observe($('trend-chart'));
  resetChat();
  loadData();
})();
