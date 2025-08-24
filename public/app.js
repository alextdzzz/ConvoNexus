/**
 * MeetingNexus Frontend Application
 * Real-time meeting visualization client
 */

class MeetingNexusApp {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isMeetingActive = false;
        this.graph = null;
        this.graphData = { nodes: new vis.DataSet([]), edges: new vis.DataSet([]) };
        this.transcript = [];
        this.currentText = '';
        this.participants = new Set();
        
        this.initializeGraph();
        this.setupEventListeners();
        this.connectWebSocket();
        
        console.log('[MeetingNexus] Application initialized');
    }

    initializeGraph() {
        const container = document.getElementById('graph');
        
        const options = {
            nodes: {
                font: { size: 14, color: '#333' },
                borderWidth: 2,
                shadow: true,
                shape: 'dot',
                size: 20,
                scaling: {
                    min: 10,
                    max: 30
                }
            },
            edges: {
                font: { size: 12, color: '#666' },
                color: { color: '#34495e' },
                arrows: { to: { enabled: true, scaleFactor: 0.5 } },
                smooth: { enabled: true, type: 'continuous' },
                width: 2
            },
            physics: {
                enabled: true,
                stabilization: { iterations: 100 },
                barnesHut: {
                    gravitationalConstant: -2000,
                    centralGravity: 0.3,
                    springLength: 95,
                    springConstant: 0.04
                }
            },
            interaction: {
                dragNodes: true,
                dragView: true,
                zoomView: true
            },
            layout: {
                improvedLayout: false
            }
        };

        this.graph = new vis.Network(container, this.graphData, options);
        
        // Graph interaction handlers
        this.graph.on('click', (params) => {
            if (params.nodes.length > 0) {
                const nodeId = params.nodes[0];
                console.log('[Graph] Node clicked:', nodeId);
                this.highlightNode(nodeId);
            }
        });
        
        console.log('[MeetingNexus] Graph visualization initialized');
    }

    setupEventListeners() {
        // Meeting controls
        document.getElementById('startMeeting').addEventListener('click', () => {
            this.startMeeting();
        });
        
        document.getElementById('stopMeeting').addEventListener('click', () => {
            this.stopMeeting();
        });
        
        document.getElementById('clearGraph').addEventListener('click', () => {
            this.clearGraph();
        });
        
        document.getElementById('exportGraph').addEventListener('click', () => {
            this.exportGraph();
        });
        
        console.log('[MeetingNexus] Event listeners setup complete');
    }

    connectWebSocket() {
        const wsUrl = `ws://localhost:8765`;
        console.log(`[WebSocket] Connecting to ${wsUrl}`);
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('[WebSocket] Connected successfully');
                this.isConnected = true;
                this.updateConnectionStatus();
                this.showMessage('Connected to MeetingNexus server', 'success');
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleServerMessage(data);
                } catch (error) {
                    console.error('[WebSocket] Error parsing message:', error);
                }
            };
            
            this.ws.onclose = () => {
                console.log('[WebSocket] Connection closed');
                this.isConnected = false;
                this.updateConnectionStatus();
                this.showMessage('Disconnected from server. Attempting to reconnect...', 'error');
                
                // Attempt to reconnect after 3 seconds
                setTimeout(() => this.connectWebSocket(), 3000);
            };
            
            this.ws.onerror = (error) => {
                console.error('[WebSocket] Connection error:', error);
                this.showMessage('WebSocket connection error. Please check if the server is running.', 'error');
            };
            
        } catch (error) {
            console.error('[WebSocket] Failed to create connection:', error);
            this.showMessage('Failed to connect to server. Please start the server first.', 'error');
        }
    }

    handleServerMessage(data) {
        switch (data.type) {
            case 'meeting_state':
                this.handleMeetingState(data.data);
                break;
            case 'transcript_update':
                this.handleTranscriptUpdate(data.data);
                break;
            case 'graph_update':
                this.handleGraphUpdate(data.data);
                break;
            case 'meeting_started':
                this.isMeetingActive = true;
                this.updateUI();
                this.showMessage('Meeting started! Start the audio service to begin transcription.', 'success');
                break;
            case 'meeting_stopped':
                this.isMeetingActive = false;
                this.updateUI();
                this.showMessage('Meeting stopped.', 'success');
                break;
            case 'clear_graph':
                this.clearGraphData();
                this.showMessage('Graph cleared.', 'success');
                break;
            case 'error':
                this.showMessage(data.message, 'error');
                break;
            default:
                console.log('[Server] Unknown message type:', data.type);
        }
    }

    handleMeetingState(state) {
        this.isMeetingActive = state.isActive;
        this.participants = new Set(state.participants);
        
        if (state.graph && (state.graph.nodes.length > 0 || state.graph.edges.length > 0)) {
            this.loadGraphData(state.graph);
        }
        
        this.updateUI();
        console.log('[MeetingNexus] Meeting state updated:', state);
    }

    handleTranscriptUpdate(data) {
        const { speaker, text, is_final, timestamp } = data;
        
        this.participants.add(speaker);
        
        if (is_final) {
            // Add to permanent transcript
            this.transcript.push({
                speaker,
                text,
                timestamp: new Date(timestamp).toLocaleTimeString(),
                id: Date.now()
            });
            
            // Clear current text
            this.currentText = '';
            
            console.log(`[Transcript] Final: ${speaker}: ${text}`);
        } else {
            // Update current text
            this.currentText = { speaker, text, timestamp };
            console.log(`[Transcript] Partial: ${speaker}: ${text.substring(0, 50)}...`);
        }
        
        this.updateTranscriptDisplay();
        this.updateUI();
    }

    handleGraphUpdate(updates) {
        console.log('[Graph] Processing updates:', updates);
        this.updateGraph(updates);
        this.showMessage(`Graph updated with ${updates.length} new relationships`, 'success');
    }

    updateGraph(updates) {
        if (!updates || updates.length === 0) return;

        updates.forEach(update => {
            if (update.length === 3) {
                // Add relationship: [entity1, relation, entity2]
                const [entity1, relation, entity2] = update;

                // Add nodes if they don't exist
                if (!this.graphData.nodes.get(entity1)) {
                    this.graphData.nodes.add({ 
                        id: entity1, 
                        label: entity1, 
                        color: '#ffffff',
                        title: `Entity: ${entity1}`
                    });
                }
                if (!this.graphData.nodes.get(entity2)) {
                    this.graphData.nodes.add({ 
                        id: entity2, 
                        label: entity2, 
                        color: '#ffffff',
                        title: `Entity: ${entity2}`
                    });
                }

                // Add or update edge
                const edgeId = `${entity1}-${entity2}`;
                const existingEdge = this.graphData.edges.get(edgeId);
                
                if (existingEdge) {
                    this.graphData.edges.update({ id: edgeId, label: relation });
                } else {
                    this.graphData.edges.add({ 
                        id: edgeId,
                        from: entity1, 
                        to: entity2, 
                        label: relation,
                        title: `${entity1} → ${relation} → ${entity2}`
                    });
                }

            } else if (update.length === 2 && update[1].startsWith('#')) {
                // Set node color: [entity, color]
                const [entity, color] = update;
                
                if (this.graphData.nodes.get(entity)) {
                    this.graphData.nodes.update({ id: entity, color: color });
                } else {
                    this.graphData.nodes.add({ 
                        id: entity, 
                        label: entity, 
                        color: color,
                        title: `Entity: ${entity}`
                    });
                }
            }
        });

        // Update node count
        this.updateUI();
        
        // Fit the graph to show all nodes
        setTimeout(() => {
            if (this.graph && this.graphData.nodes.length > 0) {
                this.graph.fit();
            }
        }, 500);
    }

    loadGraphData(graphState) {
        // Clear existing data
        this.graphData.nodes.clear();
        this.graphData.edges.clear();

        // Add nodes
        if (graphState.nodes) {
            graphState.nodes.forEach(node => {
                this.graphData.nodes.add({
                    ...node,
                    title: `Entity: ${node.label}`
                });
            });
        }

        // Add edges  
        if (graphState.edges) {
            graphState.edges.forEach(edge => {
                this.graphData.edges.add({
                    ...edge,
                    id: `${edge.from}-${edge.to}`,
                    title: `${edge.from} → ${edge.label} → ${edge.to}`
                });
            });
        }

        console.log(`[Graph] Loaded ${graphState.nodes?.length || 0} nodes and ${graphState.edges?.length || 0} edges`);
    }

    updateTranscriptDisplay() {
        const transcriptEl = document.getElementById('transcript');
        
        // Build transcript HTML
        let html = '';
        
        // Add completed transcript entries
        this.transcript.slice(-20).forEach(entry => {
            html += `
                <div class="transcript-entry">
                    <span class="transcript-time">${entry.timestamp}</span>
                    <span class="transcript-speaker">${entry.speaker}:</span>
                    <span class="transcript-text">${entry.text}</span>
                </div>
            `;
        });
        
        // Add current partial text
        if (this.currentText && this.currentText.text) {
            html += `
                <div class="transcript-entry current-text">
                    <span class="transcript-time">Now</span>
                    <span class="transcript-speaker">${this.currentText.speaker}:</span>
                    <span class="transcript-text">${this.currentText.text}...</span>
                </div>
            `;
        }
        
        if (html === '') {
            html = '<div class="loading">Waiting for audio input...</div>';
        }
        
        transcriptEl.innerHTML = html;
        
        // Auto-scroll to bottom
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    updateConnectionStatus() {
        const statusEl = document.getElementById('connectionStatus');
        if (this.isConnected) {
            statusEl.className = 'status-dot connected';
        } else {
            statusEl.className = 'status-dot';
        }
    }

    updateUI() {
        // Update button states
        document.getElementById('startMeeting').disabled = !this.isConnected || this.isMeetingActive;
        document.getElementById('stopMeeting').disabled = !this.isConnected || !this.isMeetingActive;
        
        // Update status indicators
        this.updateConnectionStatus();
        
        // Update participant count
        document.getElementById('participantNum').textContent = this.participants.size;
        
        // Update node count
        document.getElementById('nodeNum').textContent = this.graphData.nodes.length;
        
        // Update recording status based on recent transcript activity
        const recordingEl = document.getElementById('recordingStatus');
        if (this.currentText || (this.transcript.length > 0 && Date.now() - this.transcript[this.transcript.length - 1].id < 10000)) {
            recordingEl.className = 'status-dot recording';
        } else if (this.isMeetingActive) {
            recordingEl.className = 'status-dot processing';
        } else {
            recordingEl.className = 'status-dot';
        }
    }

    startMeeting() {
        if (!this.isConnected) {
            this.showMessage('Not connected to server', 'error');
            return;
        }
        
        this.ws.send(JSON.stringify({ type: 'start_meeting' }));
        console.log('[MeetingNexus] Starting meeting');
    }

    stopMeeting() {
        if (!this.isConnected) return;
        
        this.ws.send(JSON.stringify({ type: 'stop_meeting' }));
        console.log('[MeetingNexus] Stopping meeting');
    }

    clearGraph() {
        if (!this.isConnected) return;
        
        this.ws.send(JSON.stringify({ type: 'clear_graph' }));
        this.clearGraphData();
        console.log('[MeetingNexus] Clearing graph');
    }

    clearGraphData() {
        this.graphData.nodes.clear();
        this.graphData.edges.clear();
        this.transcript = [];
        this.currentText = '';
        this.participants.clear();
        this.updateTranscriptDisplay();
        this.updateUI();
    }

    exportGraph() {
        const graphData = {
            nodes: this.graphData.nodes.get(),
            edges: this.graphData.edges.get(),
            transcript: this.transcript,
            participants: Array.from(this.participants),
            exportTime: new Date().toISOString()
        };
        
        const dataStr = JSON.stringify(graphData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `meeting-export-${new Date().toISOString().slice(0, 19)}.json`;
        link.click();
        
        console.log('[MeetingNexus] Graph exported');
        this.showMessage('Meeting data exported successfully', 'success');
    }

    highlightNode(nodeId) {
        // Get connected nodes and edges
        const connectedNodes = this.graphData.edges.get({
            filter: (edge) => edge.from === nodeId || edge.to === nodeId
        });
        
        console.log(`[Graph] Node ${nodeId} has ${connectedNodes.length} connections`);
    }

    showMessage(text, type = 'info') {
        const messagesEl = document.getElementById('messages');
        const messageEl = document.createElement('div');
        messageEl.className = type;
        messageEl.textContent = text;
        
        messagesEl.appendChild(messageEl);
        
        // Remove message after 5 seconds
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.parentNode.removeChild(messageEl);
            }
        }, 5000);
        
        console.log(`[Message] ${type}: ${text}`);
    }
}

// Export functions for transcript panel
function exportTranscript() {
    const app = window.meetingApp;
    if (!app.transcript.length) {
        app.showMessage('No transcript data to export', 'error');
        return;
    }
    
    const transcriptText = app.transcript
        .map(entry => `[${entry.timestamp}] ${entry.speaker}: ${entry.text}`)
        .join('\\n');
    
    const blob = new Blob([transcriptText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meeting-transcript-${new Date().toISOString().slice(0, 19)}.txt`;
    link.click();
    
    app.showMessage('Transcript exported successfully', 'success');
}

function exportSummary() {
    const app = window.meetingApp;
    if (!app.transcript.length) {
        app.showMessage('No meeting data to summarize', 'error');
        return;
    }
    
    const summary = {
        meetingDate: new Date().toISOString(),
        participants: Array.from(app.participants),
        transcriptLength: app.transcript.length,
        keyTopics: app.graphData.nodes.get().map(n => n.label),
        relationships: app.graphData.edges.get().map(e => `${e.from} → ${e.label} → ${e.to}`),
        duration: app.transcript.length > 0 ? 
            `${Math.round((Date.now() - app.transcript[0].id) / 60000)} minutes` : '0 minutes'
    };
    
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meeting-summary-${new Date().toISOString().slice(0, 19)}.json`;
    link.click();
    
    app.showMessage('Meeting summary exported successfully', 'success');
}

// Initialize the application when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.meetingApp = new MeetingNexusApp();
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (window.meetingApp && window.meetingApp.ws) {
        window.meetingApp.ws.close();
    }
});