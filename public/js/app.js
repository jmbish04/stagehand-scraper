// Main application state and initialization
class StagehandApp {
  constructor() {
    this.requestId = null;
    this.isSticky = false;
    this.catalog = new Map();
    this.requestStatuses = new Map();
    this.selectedPattern = null;
    this.autoMode = true;
    
    this.init();
  }

  init() {
    this.setupElements();
    this.setupEventListeners();
    this.loadInitialData();
    this.connectWebSocket();
  }

  setupElements() {
    // Main elements
    this.out = document.getElementById('out');
    this.info = document.getElementById('info');
    this.list = document.getElementById('list');
    this.schemaStatus = document.getElementById('schemaStatus');
    this.schemaFields = document.getElementById('schemaFields');
    this.schemaJson = document.getElementById('schemaJson');
    this.patternsList = document.getElementById('patternsList');
    this.patternDetails = document.getElementById('patternDetails');
    this.patternStats = document.getElementById('patternStats');
    this.patternObservations = document.getElementById('patternObservations');
    this.clearRequestBtn = document.getElementById('clearRequest');
    this.searchInput = document.getElementById('searchInput');
    this.searchBtn = document.getElementById('searchBtn');
    
    // Auto mode checkbox
    this.autoModeCheckbox = document.getElementById('autoMode');
  }

  setupEventListeners() {
    // Clear request button
    this.clearRequestBtn.addEventListener('click', () => this.clearActiveRequest());
    
    // Search functionality
    this.searchBtn.addEventListener('click', () => this.searchByUUID());
    this.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchByUUID();
    });
    
    // Auto mode checkbox
    this.autoModeCheckbox.addEventListener('change', (e) => {
      this.autoMode = e.target.checked;
      if (this.autoMode && !this.isSticky) {
        this.clearActiveRequest();
      }
    });
  }

  loadInitialData() {
    this.loadPatterns();
    this.renderList();
  }

  connectWebSocket() {
    if (window.ws) {
      try { window.ws.close(); } catch {}
    }
    
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = '/logs';
    const ws = new WebSocket(proto + '://' + location.host + wsUrl);
    window.ws = ws;
    
    this.out.textContent = '';
    this.updateInfoText();
    
    ws.onopen = () => {
      console.log('WebSocket connected successfully');
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      setTimeout(() => {
        console.log('Attempting to reconnect WebSocket...');
        this.connectWebSocket();
      }, 3000);
    };
    
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        this.handleWebSocketMessage(m);
      } catch {
        this.out.textContent += e.data + '\n';
      }
    };
  }

  handleWebSocketMessage(m) {
    if (m.type === 'log') {
      const d = m.data;
      if (d.request_id) {
        this.catalogRequest(d);
        this.renderList();
      }
      
      // Only show logs in the output if they match the current requestId (or if no requestId is set)
      if (!this.requestId || d.request_id === this.requestId) {
        this.out.textContent += `[${d.timestamp}] ${d.level} ${d.message} ${d.url||''} ${d.details||''}\n`;
        this.out.scrollTop = this.out.scrollHeight;
      }
      
      // Auto-follow new requests when in auto mode and not sticky
      if (!this.requestId && this.autoMode && !this.isSticky && d.request_id) {
        this.setActiveRequest(d.request_id, d.url, d.prompt, false);
      }
    } else if (m.type === 'error') {
      this.out.textContent += `[ERROR] ${m.error}\n`;
      this.out.scrollTop = this.out.scrollHeight;
    } else if (m.type === 'schema_generation_start') {
      this.handleSchemaGenerationStart(m);
    } else if (m.type === 'schema_description') {
      this.handleSchemaDescription(m);
    } else if (m.type === 'schema_json') {
      this.handleSchemaJson(m);
    } else if (m.type === 'schema_generation_error') {
      this.handleSchemaError(m);
    } else if (m.type === 'extraction_complete') {
      this.handleExtractionComplete(m);
    } else if (m.type === 'extraction_error') {
      this.handleExtractionError(m);
    } else if (m.type === 'request_status') {
      this.handleRequestStatus(m);
    }
  }

  catalogRequest(d) {
    const id = d.request_id;
    if (this.catalog.has(id)) {
      const existing = this.catalog.get(id);
      existing.lastTimestamp = d.timestamp;
      this.catalog.set(id, existing);
    } else {
      this.catalog.set(id, { url: d.url, prompt: d.prompt, lastTimestamp: d.timestamp });
    }
  }

  renderList() {
    const sorted = Array.from(this.catalog.entries()).sort((a, b) => new Date(b[1].lastTimestamp) - new Date(a[1].lastTimestamp));
    this.list.innerHTML = sorted.map(([id, data]) => {
      const status = this.requestStatuses.get(id);
      let statusBadge = '';
      let statusColor = '';
      
      if (status) {
        switch (status.status) {
          case 'running':
            statusBadge = '🔄 RUNNING';
            statusColor = 'text-blue-600';
            break;
          case 'completed':
            statusBadge = '✅ PASS';
            statusColor = 'text-green-600';
            break;
          case 'failed':
            statusBadge = '❌ FAIL';
            statusColor = 'text-red-600';
            break;
        }
      }
      
      return `
        <div class="p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${id === this.requestId ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}" onclick="app.setActiveRequest('${id}', '${data.url}', '${data.prompt}', true)">
          <div class="flex items-center justify-between mb-1">
            <div class="font-mono text-xs text-gray-500">${id}</div>
            ${statusBadge ? `<div class="text-xs font-medium ${statusColor}">${statusBadge}</div>` : ''}
          </div>
          <div class="font-medium text-gray-900 truncate">${data.url}</div>
          <div class="text-sm text-gray-600 mt-1 line-clamp-2">${data.prompt || 'No prompt provided'}</div>
          <div class="text-xs text-gray-500 mt-1">${data.lastTimestamp}</div>
        </div>
      `;
    }).join('');
  }

  setActiveRequest(id, urlHint, promptHint, updateUrl) {
    this.requestId = id;
    this.isSticky = true;
    this.updateInfoText();
    this.clearRequestBtn.style.display = 'inline-block';
    
    if (updateUrl) {
      const u = new URL(location.href);
      u.searchParams.set('request_id', id);
      history.pushState({}, '', u);
    }
    
    if (id && (!this.catalog.has(id))) {
      this.catalog.set(id, { url: urlHint, prompt: promptHint, lastTimestamp: new Date().toISOString() });
    }
    
    this.renderList();
    this.connectWebSocket();
    
    // Show detailed results if available
    const status = this.requestStatuses.get(id);
    if (status) {
      this.showRequestDetails(id, status);
    }
  }

  clearActiveRequest() {
    this.requestId = null;
    this.isSticky = false;
    this.updateInfoText();
    this.clearRequestBtn.style.display = 'none';
    
    const u = new URL(location.href);
    u.searchParams.delete('request_id');
    history.pushState({}, '', u);
    
    this.renderList();
    this.connectWebSocket();
  }

  updateInfoText() {
    if (this.requestId) {
      this.info.textContent = `Following request ${this.requestId}`;
    } else {
      this.info.textContent = 'Auto-following latest request';
    }
  }

  searchByUUID() {
    const uuid = this.searchInput.value.trim();
    if (uuid) {
      // Find the request in catalog
      const found = Array.from(this.catalog.entries()).find(([id]) => id.includes(uuid));
      if (found) {
        const [id, data] = found;
        this.setActiveRequest(id, data.url, data.prompt, true);
        this.searchInput.value = '';
      } else {
        alert('Request not found');
      }
    }
  }

  handleRequestStatus(event) {
    // Store the request status
    this.requestStatuses.set(event.request_id, {
      status: event.status,
      result: event.result,
      error: event.error,
      timestamp: event.timestamp
    });
    
    // Update the requests list to reflect the new status
    this.renderList();
    
    // If this is the currently active request, show details
    if (this.requestId === event.request_id) {
      this.showRequestDetails(event.request_id, this.requestStatuses.get(event.request_id));
    }
  }

  showRequestDetails(requestId, status) {
    // Clear existing schema content
    this.schemaStatus.innerHTML = '';
    this.schemaFields.innerHTML = '';
    this.schemaJson.innerHTML = '';
    
    // Show status
    let statusColor = '';
    let statusIcon = '';
    let statusText = '';
    
    switch (status.status) {
      case 'running':
        statusColor = 'bg-blue-50 border-blue-200';
        statusIcon = '🔄';
        statusText = 'Request is running...';
        break;
      case 'completed':
        statusColor = 'bg-green-50 border-green-200';
        statusIcon = '✅';
        statusText = 'Request completed successfully';
        break;
      case 'failed':
        statusColor = 'bg-red-50 border-red-200';
        statusIcon = '❌';
        statusText = 'Request failed';
        break;
    }
    
    this.schemaStatus.innerHTML = `
      <div class="flex items-center p-3 ${statusColor} border rounded-lg">
        <span class="text-lg mr-3">${statusIcon}</span>
        <span class="font-medium">${statusText}</span>
      </div>
    `;
    
    // Show results or errors
    if (status.status === 'completed' && status.result) {
      // Show extracted data
      if (status.result.finalContent) {
        this.schemaJson.innerHTML = `
          <div class="mt-4">
            <h4 class="text-sm font-semibold text-gray-700 mb-2">📄 Extracted Content:</h4>
            <pre class="bg-gray-50 p-3 rounded border text-xs overflow-x-auto json-display">${status.result.finalContent}</pre>
          </div>
        `;
      } else if (status.result.extractedData) {
        const dataStr = JSON.stringify(status.result.extractedData, null, 2);
        this.schemaJson.innerHTML = `
          <div class="mt-4">
            <h4 class="text-sm font-semibold text-gray-700 mb-2">📄 Extracted Data:</h4>
            <pre class="bg-gray-50 p-3 rounded border text-xs overflow-x-auto json-display">${dataStr}</pre>
          </div>
        `;
      }
    } else if (status.status === 'failed' && status.error) {
      // Show error details
      this.schemaJson.innerHTML = `
        <div class="mt-4">
          <h4 class="text-sm font-semibold text-gray-700 mb-2">❌ Error Details:</h4>
          <pre class="bg-red-50 p-3 rounded border text-xs overflow-x-auto json-display">${status.error}</pre>
        </div>
      `;
    }
  }

  // Schema event handlers
  handleSchemaGenerationStart(event) {
    this.schemaStatus.innerHTML = '<div class="p-3 bg-blue-50 border border-blue-200 rounded-lg"><span class="text-blue-600">🔄 Generating schema...</span></div>';
    this.schemaFields.innerHTML = '';
    this.schemaJson.innerHTML = '';
  }

  handleSchemaDescription(event) {
    this.schemaFields.innerHTML = `
      <div class="mt-4">
        <h4 class="text-sm font-semibold text-gray-700 mb-2">📝 Generated Fields:</h4>
        <div class="space-y-2">
          ${event.fields.map(field => `
            <div class="flex items-center justify-between p-2 bg-gray-50 rounded">
              <span class="text-sm font-medium">${field.name}</span>
              <span class="text-xs text-gray-500">${field.type}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  handleSchemaJson(event) {
    this.schemaJson.innerHTML = `
      <div class="mt-4">
        <h4 class="text-sm font-semibold text-gray-700 mb-2">📋 JSON Schema:</h4>
        <pre class="bg-gray-50 p-3 rounded border text-xs overflow-x-auto json-display">${JSON.stringify(event.schema, null, 2)}</pre>
      </div>
    `;
  }

  handleSchemaError(event) {
    this.schemaStatus.innerHTML = '<div class="p-3 bg-red-50 border border-red-200 rounded-lg"><span class="text-red-600">❌ Schema generation failed</span></div>';
    this.schemaJson.innerHTML = `
      <div class="mt-4">
        <h4 class="text-sm font-semibold text-gray-700 mb-2">❌ Error:</h4>
        <pre class="bg-red-50 p-3 rounded border text-xs overflow-x-auto json-display">${event.error}</pre>
      </div>
    `;
  }

  handleExtractionComplete(event) {
    this.schemaStatus.innerHTML = '<div class="p-3 bg-green-50 border border-green-200 rounded-lg"><span class="text-green-600">✅ Extraction completed</span></div>';
    
    if (event.extractedData) {
      const dataStr = JSON.stringify(event.extractedData, null, 2);
      this.schemaJson.innerHTML = `
        <div class="mt-4">
          <h4 class="text-sm font-semibold text-gray-700 mb-2">📄 Extracted Data:</h4>
          <pre class="bg-gray-50 p-3 rounded border text-xs overflow-x-auto json-display">${dataStr}</pre>
        </div>
      `;
    }
  }

  handleExtractionError(event) {
    this.schemaStatus.innerHTML = '<div class="p-3 bg-red-50 border border-red-200 rounded-lg"><span class="text-red-600">❌ Extraction failed</span></div>';
    this.schemaJson.innerHTML = `
      <div class="mt-4">
        <h4 class="text-sm font-semibold text-gray-700 mb-2">❌ Error:</h4>
        <pre class="bg-red-50 p-3 rounded border text-xs overflow-x-auto json-display">${event.error}</pre>
      </div>
    `;
  }

  // Pattern management functions
  async loadPatterns() {
    try {
      const response = await fetch('/observations/patterns');
      const data = await response.json();
      this.renderPatterns(data.patterns || []);
    } catch (error) {
      console.error('Failed to load patterns:', error);
    }
  }

  renderPatterns(patterns) {
    this.patternsList.innerHTML = patterns.map(pattern => `
      <div class="pattern-item p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${pattern.pattern === this.selectedPattern ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}" 
           onclick="app.selectPattern('${pattern.pattern}')">
        <div class="pattern-name text-sm font-medium text-gray-900 truncate">${pattern.pattern}</div>
        <div class="pattern-stats text-xs text-gray-600">
          <span class="success-rate">${pattern.success_rate}%</span> success • 
          ${pattern.total_observations} observations
        </div>
      </div>
    `).join('');
  }

  async selectPattern(pattern) {
    this.selectedPattern = pattern;
    const url = new URL(location.href);
    url.searchParams.set('pattern', pattern);
    history.pushState({}, '', url);
    
    // Update UI
    document.querySelectorAll('.pattern-item').forEach(item => {
      item.classList.remove('bg-blue-50', 'border-l-4', 'border-l-blue-500');
    });
    event.target.closest('.pattern-item').classList.add('bg-blue-50', 'border-l-4', 'border-l-blue-500');
    
    await this.loadPatternDetails(pattern);
  }

  // UUID Search functionality
  searchByUUID() {
    const searchInput = document.getElementById('searchInput');
    const uuid = searchInput.value.trim();
    
    if (!uuid) {
      alert('Please enter a UUID to search for');
      return;
    }
    
    // Check if UUID exists in catalog
    if (this.catalog.has(uuid)) {
      const data = this.catalog.get(uuid);
      this.setActiveRequest(uuid, data.url, data.prompt, true);
      searchInput.value = ''; // Clear search input
    } else {
      alert(`UUID "${uuid}" not found in recent requests`);
    }
  }

  async loadPatternDetails(pattern) {
    try {
      const response = await fetch(`/observations?pattern=${encodeURIComponent(pattern)}&limit=10`);
      const data = await response.json();
      
      // Show pattern details
      this.patternDetails.style.display = 'block';
      
      // Render stats
      this.patternStats.innerHTML = `
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div class="bg-gray-50 p-3 rounded-lg">
            <div class="text-2xl font-bold text-gray-900">${data.aggregate?.total_observations || 0}</div>
            <div class="text-sm text-gray-600">Total Observations</div>
          </div>
          <div class="bg-gray-50 p-3 rounded-lg">
            <div class="text-2xl font-bold text-green-600">${data.aggregate?.success_rate || 0}%</div>
            <div class="text-sm text-gray-600">Success Rate</div>
          </div>
        </div>
      `;
      
      // Render observations
      this.patternObservations.innerHTML = data.observations.map(obs => `
        <div class="observation-item p-2 bg-gray-50 rounded border-l-4 ${obs.outcome === 'success' ? 'border-l-green-500' : obs.outcome === 'partial' ? 'border-l-yellow-500' : 'border-l-red-500'}">
          <div class="text-xs font-medium text-gray-900">${obs.action_type}</div>
          <div class="text-xs text-gray-600">${obs.outcome} • ${obs.timestamp}</div>
        </div>
      `).join('');
      
    } catch (error) {
      console.error('Failed to load pattern details:', error);
    }
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.app = new StagehandApp();
});
