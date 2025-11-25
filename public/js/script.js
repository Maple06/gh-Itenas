// --- Configuration ---
const API_BASE = window.location.origin;
const MQTT_CONFIG = {
    host: 'wss://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xx.xx.hivemq.cloud:8884/mqtt', 
    options: {
        username: 'USERNAME',
        password: 'PASSWORD'
    },
    topic_pattern: 'greenhouses/+/heartbeat',
    timeout_ms: 5000
};

// --- Tailwind Config ---
tailwind.config = {
    theme: {
        extend: {
            fontFamily: { sans: ['Inter', 'sans-serif'] },
            colors: {
                primary: {
                    50: '#f0fdf4', 100: '#dcfce7', 500: '#22c55e', 600: '#16a34a',
                }
            }
        }
    }
};

// --- MQTT Service ---
const mqttService = {
    client: null,
    lastSeen: {},
    checkInterval: null,

    connect: () => {
        console.log("Connecting to MQTT...");
        mqttService.client = mqtt.connect(MQTT_CONFIG.host, MQTT_CONFIG.options);

        mqttService.client.on('connect', () => {
            console.log("✅ MQTT Connected");
            mqttService.client.subscribe(MQTT_CONFIG.topic_pattern);
        });

        mqttService.client.on('message', (topic, message) => {
            const parts = topic.split('/');
            const ghId = parts[1];

            mqttService.lastSeen[ghId] = Date.now();
            mqttService.updateStatusUI(ghId, true);
            
            detailPage.updateStatusUIFromMqtt(ghId, true);

            try {
                const payload = JSON.parse(message.toString());
                
                mqttService.updateHomeCardRealtime(ghId, payload);

                sendRealtimeToServer(ghId, payload, payload.created_at || new Date().toISOString());

                detailPage.handleRealtimeUpdate(ghId, payload);
            } catch (e) {
                console.warn('MQTT payload error:', e);
            }
        });

        if (mqttService.checkInterval) clearInterval(mqttService.checkInterval);
        mqttService.checkInterval = setInterval(mqttService.watchdog, 1000);
    },

    updateHomeCardRealtime: (ghId, payload) => {
        const els = {
            air: document.getElementById(`home-air-${ghId}`),
            hum: document.getElementById(`home-hum-${ghId}`),
            water: document.getElementById(`home-water-${ghId}`),
            turb: document.getElementById(`home-turb-${ghId}`)
        };
        
        const colorize = (el, val, type) => {
            if(!el) return;
            el.innerText = val + (type === 'hum' ? '%' : (type === 'turb' ? '' : '°C'));
            el.className = 'font-medium mt-1';
            const n = Number(val);
            if(isNaN(n)) return;

            if(type === 'air') {
                if(n < 18) el.classList.add('text-blue-500');
                else if(n <= 30) el.classList.add('text-green-600');
                else el.classList.add('text-red-500');
            } else if(type === 'hum') {
                if(n >= 40 && n <= 70) el.classList.add('text-green-600');
                else el.classList.add('text-yellow-500');
            } else if(type === 'water') {
                if(n < 20) el.classList.add('text-blue-500');
                else if(n <= 28) el.classList.add('text-green-600');
                else el.classList.add('text-red-500');
            } else if(type === 'turb') {
                if(n < 1) el.classList.add('text-green-600');
                else if(n <= 5) el.classList.add('text-yellow-500');
                else el.classList.add('text-red-500');
            }
        };

        if(payload.dht_temp != null) colorize(els.air, payload.dht_temp, 'air');
        if(payload.dht_hum != null) colorize(els.hum, payload.dht_hum, 'hum');
        if(payload.water_temp != null) colorize(els.water, payload.water_temp, 'water');
        if(payload.turbidity != null) colorize(els.turb, payload.turbidity, 'turb');

        ['air','hum','water','turb'].forEach(k => {
            const lastEl = document.getElementById(`home-${k}-last-${ghId}`);
            if(lastEl) lastEl.innerText = '';
        });
    },

    watchdog: () => {
        const now = Date.now();
        const statusElements = document.querySelectorAll('[id^="status-container-"]');
        statusElements.forEach(el => {
            const ghId = el.id.replace('status-container-', '');
            const last = mqttService.lastSeen[ghId] || 0;
            const isOnline = (now - last) < MQTT_CONFIG.timeout_ms;

            if (!isOnline) {
                mqttService.updateStatusUI(ghId, false);
                mqttService.setHomeCardOffline(ghId);
            }
        });

        if (detailPage.currentId) {
            const ghId = detailPage.currentId;
            const last = mqttService.lastSeen[ghId] || 0;
            const isOnline = (now - last) < MQTT_CONFIG.timeout_ms;

            if (!isOnline) {
                detailPage.updateStatusUIFromMqtt(ghId, false);
                detailPage.setDetailOffline();
            }
        }
    },

    setHomeCardOffline: (ghId) => {
        ['air','hum','water','turb'].forEach(k => {
            const el = document.getElementById(`home-${k}-${ghId}`);
            if(el) {
                el.innerText = '--';
                el.className = 'font-medium mt-1 text-gray-400';
            }
        });

        api.fetchLatestHistory(ghId).then(latest => {
            if (!latest) return;
            const tsLabel = latest.created_at ? dayjs(latest.created_at).format('DD MMM HH:mm') : '';
            
            const updateLast = (k, val, unit) => {
                const el = document.getElementById(`home-${k}-last-${ghId}`);
                if(el && val != null) el.innerText = `Last: ${Math.round(val*100)/100}${unit} (${tsLabel})`;
            };

            updateLast('air', latest.dht_temp, '°C');
            updateLast('hum', latest.dht_hum, '%');
            updateLast('water', latest.water_temp, '°C');
            updateLast('turb', latest.turbidity, '');
        });
    },

    updateStatusUI: (id, isOnline) => {
        const textEl = document.getElementById(`status-text-${id}`);
        const dotEl = document.getElementById(`status-dot-${id}`);
        const btnEl = document.getElementById(`reload-btn-${id}`);

        if (!textEl || !dotEl) return;

        if (isOnline) {
            textEl.innerText = 'Online';
            textEl.className = 'text-green-600';
            dotEl.className = 'w-2 h-2 rounded-full mr-1 bg-green-500';
            if(btnEl) btnEl.classList.add('hidden');
        } else {
            textEl.innerText = 'Offline';
            textEl.className = 'text-red-500';
            dotEl.className = 'w-2 h-2 rounded-full mr-1 bg-red-500';
            if(btnEl) btnEl.classList.remove('hidden');
        }
    },

    manualCheck: (id) => {
        const textEl = document.getElementById(`status-text-${id}`);
        const dotEl = document.getElementById(`status-dot-${id}`);
        if(textEl) textEl.innerText = 'Checking...';
        if(dotEl) dotEl.className = "w-2 h-2 rounded-full bg-gray-300 mr-1 animate-pulse";
    }
};

async function sendRealtimeToServer(ghId, payload, createdAt) {
    try {
        await fetch(`${API_BASE}/api/realtime/${ghId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dht_temp: payload.dht_temp,
                dht_hum: payload.dht_hum,
                turbidity: payload.turbidity,
                water_temp: payload.water_temp,
                created_at: createdAt
            })
        });
    } catch (err) { }
}

// --- API Helper ---
const api = {
    async fetchGreenhouses() {
        try {
            const res = await fetch(`${API_BASE}/api/greenhouses`);
            return res.ok ? await res.json() : [];
        } catch { return []; }
    },
    async fetchLatestHistory(id) {
        try {
            const res = await fetch(`${API_BASE}/api/greenhouses/history/latest?gh=${id}`);
            return res.ok ? await res.json() : null;
        } catch { return null; }
    },
    async fetchHistoryRange(id, dateFrom, dateTo) {
        try {
            const params = new URLSearchParams({ gh: id });
            if (dateFrom) params.append('date_from', dateFrom);
            if (dateTo) params.append('date_to', dateTo);
            const res = await fetch(`${API_BASE}/api/greenhouses/history?${params.toString()}`);
            return res.ok ? await res.json() : [];
        } catch { return []; }
    }
};

// --- Home Page ---
const homePage = {
    init: async () => {
        const grid = document.getElementById('greenhouse-grid');
        if (!grid) return;
        const greenhouses = await api.fetchGreenhouses();
        document.getElementById('home-loader').classList.add('hidden');
        if (!greenhouses.length) return document.getElementById('home-empty').classList.remove('hidden');

        for (const gh of greenhouses) {
            const card = document.createElement('a');
            card.href = `/greenhouse.html?id=${gh.id}`;
            card.className = "block bg-white rounded-xl p-6 shadow-sm hover:shadow-lg transition-all border border-gray-100 relative";
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <div class="flex-1"><h3 class="text-lg font-bold text-gray-800">${gh.name}</h3></div>
                    <div class="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400"><i class="ph-fill ph-plant text-xl"></i></div>
                </div>
                <div class="mb-4 flex items-center gap-2" id="status-container-${gh.id}">
                     <div class="text-xs flex items-center"><div id="status-dot-${gh.id}" class="w-2 h-2 rounded-full bg-gray-300 mr-1"></div><span id="status-text-${gh.id}" class="text-gray-400">Waiting...</span></div>
                    <button type="button" onclick="event.preventDefault();mqttService.manualCheck('${gh.id}')" id="reload-btn-${gh.id}" class="hidden text-xs bg-gray-100 px-2 py-1 rounded border">Check</button>
                </div>
                <div class="grid grid-cols-2 gap-y-4 gap-x-2 text-sm text-gray-600 group">
                    <div class="p-2 bg-gray-50 rounded-lg"><div class="flex items-center gap-2"><i class="ph ph-thermometer text-red-400"></i><span class="text-xs">Air</span></div><span id="home-air-${gh.id}" class="font-medium mt-1">--</span><span id="home-air-last-${gh.id}" class="text-[11px] block text-gray-400"></span></div>
                    <div class="p-2 bg-gray-50 rounded-lg"><div class="flex items-center gap-2"><i class="ph ph-drop text-blue-400"></i><span class="text-xs">Hum</span></div><span id="home-hum-${gh.id}" class="font-medium mt-1">--</span><span id="home-hum-last-${gh.id}" class="text-[11px] block text-gray-400"></span></div>
                    <div class="p-2 bg-gray-50 rounded-lg"><div class="flex items-center gap-2"><i class="ph ph-wave-sine text-indigo-400"></i><span class="text-xs">Turb</span></div><span id="home-turb-${gh.id}" class="font-medium mt-1">--</span><span id="home-turb-last-${gh.id}" class="text-[11px] block text-gray-400"></span></div>
                    <div class="p-2 bg-gray-50 rounded-lg"><div class="flex items-center gap-2"><i class="ph ph-thermometer-simple text-cyan-400"></i><span class="text-xs">Water</span></div><span id="home-water-${gh.id}" class="font-medium mt-1">--</span><span id="home-water-last-${gh.id}" class="text-[11px] block text-gray-400"></span></div>
                </div>
            `;
            grid.appendChild(card);
            homePage.updateCardData(gh.id);
        }
        mqttService.connect();
    },
    updateCardData: async (id) => {
        const latest = await api.fetchLatestHistory(id);
        if(latest) mqttService.setHomeCardOffline(id);
    }
};

// --- Detail Page ---
const detailPage = {
    chart: null, humidityChart: null, waterChart: null, turbidityChart: null,
    currentId: null,

    init: async () => {
        const params = new URLSearchParams(window.location.search);
        detailPage.currentId = params.get('id');
        if (!detailPage.currentId || !document.getElementById('detail-content')) return;

        const greenhouses = await api.fetchGreenhouses();
        const gh = greenhouses.find(g => g.id == detailPage.currentId);
        if(gh) document.getElementById('detail-title').innerText = gh.name;

        // --- Filter Event Listeners ---
        const rangeSelect = document.getElementById('range-select');
        const dateFromInput = document.getElementById('date-from');
        const dateToInput = document.getElementById('date-to');

        // 1. Dropdown Changes -> Update Dates -> Load History
        if (rangeSelect) {
            rangeSelect.addEventListener('change', function() {
                const val = this.value;
                if (!val) return; // Custom

                const now = dayjs();
                const dateFormat = 'YYYY-MM-DD';
                
                // Always set To = Today
                if(dateToInput) dateToInput.value = now.format(dateFormat);

                let fromDate;
                if (val === 'daily') fromDate = now.subtract(1, 'day');
                else if (val === 'weekly') fromDate = now.subtract(7, 'day');
                else if (val === 'monthly') fromDate = now.subtract(30, 'day');

                if (fromDate && dateFromInput) {
                    dateFromInput.value = fromDate.format(dateFormat);
                }
                
                // Fetch data using the newly set input values
                detailPage.loadHistory();
            });
        }

        // 2. Input Changes -> Reset Dropdown -> Load History
        const handleManualChange = () => {
            if (rangeSelect) rangeSelect.value = ""; // Set to Custom
            detailPage.loadHistory();
        };

        if(dateFromInput) dateFromInput.addEventListener('change', handleManualChange);
        if(dateToInput) dateToInput.addEventListener('change', handleManualChange);

        // --- Set Default to Weekly on Load ---
        if (rangeSelect) {
            rangeSelect.value = 'weekly';
            // Manually trigger the change event we defined above
            rangeSelect.dispatchEvent(new Event('change'));
        } else {
            // Fallback if no dropdown
            await detailPage.loadHistory();
        }
        
        const latest = await api.fetchLatestHistory(detailPage.currentId);
        if(latest) detailPage.updateDetailValues(latest);
    },

    loadHistory: async () => {
        const id = detailPage.currentId;
        const dateFromInput = document.getElementById('date-from');
        const dateToInput = document.getElementById('date-to');

        // Logic Change: Strictly use Input values. 
        // The Dropdown now simply auto-fills these inputs via the init() event listeners.
        let dateFrom = dateFromInput ? dateFromInput.value : null;
        let dateTo = dateToInput ? dateToInput.value : null;

        // If 'to' is set, we want to include the whole day, so we might append time or handle it in backend.
        // For simplicity, we send YYYY-MM-DD. If backend expects full timestamp:
        if (dateTo && dateTo.length === 10) {
            // make sure we get until end of that day
            dateTo = dateTo + ' 23:59:59';
        }

        const data = await api.fetchHistoryRange(id, dateFrom, dateTo);

        if (!data || !data.length) {
            document.getElementById('detail-empty').classList.remove('hidden');
            document.getElementById('detail-content').classList.add('hidden');
            return;
        }

        document.getElementById('detail-content').classList.remove('hidden');
        document.getElementById('detail-empty').classList.add('hidden');

        const sorted = data.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));

        detailPage.renderCharts(sorted);
    },

    updateDetailValues: (val) => {
        const els = {
            air: document.getElementById('val-air'),
            hum: document.getElementById('val-humidity'),
            water: document.getElementById('val-water'),
            turb: document.getElementById('val-turbidity')
        };
        
        ['air','hum','water','turb'].forEach(k => {
            const el = document.getElementById(`detail-last-${k}`);
            if(el) el.innerText = '';
        });

        const colorize = (el, v, type) => {
            if(!el) return;
            el.innerText = Math.round(v*100)/100;
            el.className = '';
            const n = Number(v);
            
            if(type === 'air') {
                if(n < 18) el.classList.add('text-blue-500');
                else if(n <= 30) el.classList.add('text-green-600');
                else el.classList.add('text-red-500');
            } else if(type === 'hum') {
                if(n >= 40 && n <= 70) el.classList.add('text-green-600');
                else el.classList.add('text-yellow-500');
            } else if(type === 'water') {
                if(n < 20) el.classList.add('text-blue-500');
                else if(n <= 28) el.classList.add('text-green-600');
                else el.classList.add('text-red-500');
            } else if(type === 'turb') {
                if(n < 1) el.classList.add('text-green-600');
                else if(n <= 5) el.classList.add('text-yellow-500');
                else el.classList.add('text-red-500');
            }
        };

        if(val.dht_temp != null) colorize(els.air, val.dht_temp, 'air');
        if(val.dht_hum != null) colorize(els.hum, val.dht_hum, 'hum');
        if(val.water_temp != null) colorize(els.water, val.water_temp, 'water');
        if(val.turbidity != null) colorize(els.turb, val.turbidity, 'turb');
    },

    setDetailOffline: () => {
        ['val-air', 'val-humidity', 'val-water', 'val-turbidity'].forEach(id => {
            const el = document.getElementById(id);
            if(el) {
                el.innerText = '--';
                el.className = 'text-gray-400';
            }
        });

        api.fetchLatestHistory(detailPage.currentId).then(latest => {
            if(!latest) return;
            const ts = latest.created_at ? dayjs(latest.created_at).format('DD MMM HH:mm') : '';
            
            const fillLast = (key, val, unit) => {
                const el = document.getElementById(`detail-last-${key}`);
                if(el && val != null) {
                    el.innerText = `Last: ${Math.round(val*100)/100}${unit} (${ts})`;
                }
            };

            fillLast('air', latest.dht_temp, '°C');
            fillLast('hum', latest.dht_hum, '%');
            fillLast('water', latest.water_temp, '°C');
            fillLast('turb', latest.turbidity, '');
        });
    },

    updateStatusUIFromMqtt: (ghId, isOnline) => {
        const textEl = document.getElementById('detail-status-text');
        const dotEl = document.getElementById('detail-status-dot');
        if (!textEl || !dotEl) return;

        if (isOnline) {
            textEl.innerText = 'Online';
            textEl.className = 'text-green-600 font-medium';
            dotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
        } else {
            textEl.innerText = 'Offline';
            textEl.className = 'text-red-500 font-medium';
            dotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
        }
    },

    handleRealtimeUpdate: (ghId, payload) => {
        detailPage.updateDetailValues(payload);
    },

    renderCharts: (data) => {
        if (!data || data.length === 0) return;

        const startTime = dayjs(data[0].created_at);
        const endTime = dayjs(data[data.length - 1].created_at);
        const durationInHours = endTime.diff(startTime, 'hour');

        const isDailyView = durationInHours > 24;
        const axisFormat = isDailyView ? 'DD MMM' : 'HH:mm'; 
        const tooltipFormat = isDailyView ? 'DD MMMM YYYY' : 'DD MMM HH:mm';

        const labels = data.map(d => dayjs(d.created_at).format(axisFormat));

        const createChart = (ctxId, ref, label, dataArr, color, bg) => {
            const ctx = document.getElementById(ctxId);
            if(!ctx) return;
            
            if(detailPage[ref]) detailPage[ref].destroy();

            detailPage[ref] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label, data: dataArr,
                        borderColor: color, backgroundColor: bg,
                        fill: true, tension: 0.4, pointRadius: 2,
                        pointRadius: isDailyView ? 4 : 2,
                        pointHoverRadius: isDailyView ? 6 : 4
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: { 
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: (context) => {
                                    const index = context[0].dataIndex;
                                    const dateObj = data[index].created_at;
                                    return dayjs(dateObj).format(tooltipFormat);
                                }
                            }
                        }
                    },
                    scales: { 
                        x: { 
                            display: true, 
                            grid: { display: false },
                            ticks: {
                                maxTicksLimit: isDailyView ? 10 : 12,
                                maxRotation: 0,
                                autoSkip: true
                            }
                        } 
                    }
                }
            });
        };

        createChart('airTempChart', 'chart', 'Air Temp', data.map(d=>d.dht_temp), '#22c55e', 'rgba(34, 197, 94, 0.1)');
        createChart('humidityChart', 'humidityChart', 'Humidity', data.map(d=>d.dht_hum), '#0ea5e9', 'rgba(14, 165, 233, 0.1)');
        createChart('waterTempChart', 'waterChart', 'Water Temp', data.map(d=>d.water_temp), '#6366f1', 'rgba(99, 102, 241, 0.1)');
        createChart('turbidityChart', 'turbidityChart', 'Turbidity', data.map(d=>d.turbidity), '#f97316', 'rgba(249, 115, 22, 0.1)');
    }
};

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('greenhouse-grid')) homePage.init();
    else if (document.getElementById('detail-content')) {
        detailPage.init();
        mqttService.connect();
    }
});
