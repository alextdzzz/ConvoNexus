#!/usr/bin/env node
/**
 * MeetingNexus WebSocket Server
 * Handles real-time transcript processing and knowledge graph generation
 */

const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
require('dotenv').config();

class MeetingNexusServer {
    constructor() {
        this.port = process.env.PORT || 3001;
        this.wsPort = process.env.WS_PORT || 8765;
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        // Track meeting state
        this.meetingState = {
            isActive: false,
            participants: new Set(),
            currentGraph: { nodes: [], edges: [] },
            transcriptBuffer: [],
            lastProcessTime: Date.now()
        };
        
        this.setupExpressServer();
        this.setupWebSocketServer();
    }

    setupExpressServer() {
        this.app = express();
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static('public'));
        
        // API endpoints
        this.app.get('/api/meeting/status', (req, res) => {
            res.json({
                isActive: this.meetingState.isActive,
                participants: Array.from(this.meetingState.participants),
                graphNodeCount: this.meetingState.currentGraph.nodes.length
            });
        });
        
        this.app.post('/api/meeting/clear', (req, res) => {
            this.clearMeetingState();
            this.broadcastToClients({ type: 'clear_graph' });
            res.json({ success: true });
        });
        
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });
        
        // Serve main app (catch-all route)
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
        
        // Handle 404s gracefully
        this.app.use((req, res) => {
            if (req.path.startsWith('/api/')) {
                res.status(404).json({ error: 'API endpoint not found' });
            } else {
                res.sendFile(path.join(__dirname, 'public', 'index.html'));
            }
        });
        
        this.server = this.app.listen(this.port, () => {
            console.log(`[Server] HTTP server running on port ${this.port}`);
        });
    }

    setupWebSocketServer() {
        this.wss = new WebSocket.Server({ port: this.wsPort });
        
        console.log(`[Server] WebSocket server running on port ${this.wsPort}`);
        
        this.wss.on('connection', (ws) => {
            console.log('[Server] New WebSocket connection');
            
            // Send current meeting state to new client
            ws.send(JSON.stringify({
                type: 'meeting_state',
                data: {
                    isActive: this.meetingState.isActive,
                    graph: this.meetingState.currentGraph,
                    participants: Array.from(this.meetingState.participants)
                }
            }));
            
            // If there's already graph data, send it as a graph state load
            if (this.meetingState.currentGraph.nodes.length > 0) {
                console.log(`[Server] Sending existing graph to new client: ${this.meetingState.currentGraph.nodes.length} nodes`);
                ws.send(JSON.stringify({
                    type: 'graph_state_load',
                    data: this.meetingState.currentGraph
                }));
            }
            
            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message.toString());
                    await this.handleMessage(data, ws);
                } catch (error) {
                    console.error('[Server] Error processing message:', error);
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: 'Failed to process message' 
                    }));
                }
            });
            
            ws.on('close', () => {
                console.log('[Server] WebSocket connection closed');
            });
            
            ws.on('error', (error) => {
                console.error('[Server] WebSocket error:', error);
            });
        });
    }

    async handleMessage(data, ws) {
        switch (data.type) {
            case 'transcript':
                await this.handleTranscript(data);
                break;
            case 'start_meeting':
                this.startMeeting();
                break;
            case 'stop_meeting':
                this.stopMeeting();
                break;
            case 'clear_graph':
                this.clearMeetingState();
                this.broadcastToClients({ type: 'clear_graph' });
                break;
            default:
                console.log(`[Server] Unknown message type: ${data.type}`);
        }
    }

    async handleTranscript(data) {
        const { speaker, text, is_final, confidence } = data;
        
        console.log(`[Server] Received transcript: ${speaker} | Final: ${is_final} | Text: "${text.substring(0, 50)}..."`);
        
        // Track participants
        this.meetingState.participants.add(speaker);
        
        // Broadcast transcript to all clients
        this.broadcastToClients({
            type: 'transcript_update',
            data: {
                speaker,
                text,
                is_final,
                confidence,
                timestamp: new Date().toISOString()
            }
        });
        
        // Process final transcripts for knowledge extraction
        if (is_final && text.trim() && !text.startsWith('[')) {
            this.meetingState.transcriptBuffer.push({ speaker, text, timestamp: Date.now() });
            console.log(`[Server] Added to transcript buffer. Buffer size: ${this.meetingState.transcriptBuffer.length}`);
            
            // Process accumulated transcripts every 30 seconds or 8 sentences
            const now = Date.now();
            const timeSinceLastProcess = now - this.meetingState.lastProcessTime;
            const shouldProcess = 
                (timeSinceLastProcess > 30000) || 
                (this.meetingState.transcriptBuffer.length >= 8);
                
            console.log(`[Server] Should process? ${shouldProcess} (Time: ${timeSinceLastProcess}ms, Buffer: ${this.meetingState.transcriptBuffer.length})`);
                
            if (shouldProcess) {
                await this.processTranscriptBuffer();
            }
        }
    }

    async processTranscriptBuffer() {
        if (this.meetingState.transcriptBuffer.length === 0) return;
        
        const transcripts = this.meetingState.transcriptBuffer.splice(0);
        this.meetingState.lastProcessTime = Date.now();
        
        console.log(`[Server] Processing ${transcripts.length} transcript segments for knowledge extraction`);
        
        try {
            const knowledge = await this.extractMeetingKnowledge(transcripts);
            console.log(`[Server] OpenAI returned ${knowledge ? knowledge.length : 0} knowledge items`);
            
            if (knowledge && knowledge.length > 0) {
                console.log(`[Server] Knowledge extracted:`, knowledge);
                this.updateMeetingGraph(knowledge);
                this.broadcastToClients({
                    type: 'graph_update',
                    data: knowledge
                });
                console.log(`[Server] Broadcasted graph update to ${this.wss.clients.size} clients`);
            } else {
                console.log(`[Server] No knowledge extracted from transcripts`);
            }
        } catch (error) {
            console.error('[Server] Error extracting knowledge:', error);
            console.error('[Server] Error details:', error.message);
        }
    }

    async extractMeetingKnowledge(transcripts) {
        const combinedText = transcripts
            .map(t => `${t.speaker}: ${t.text}`)
            .join('\n');

        console.log(`[Server] Sending to OpenAI transcript:`, combinedText);

        const prompt = `Extract the key THEMES and meaningful relationships from this meeting transcript.

Meeting Transcript:
${combinedText}

Focus on identifying:
- **Major themes** that emerge from the discussion (not predefined categories)
- **Key relationships** between people, topics, and concepts
- **Important decisions** that were actually made
- **Clear action items** with owners and deadlines
- **Significant concerns** or blockers mentioned
- **Timeline commitments** that were established

**Extract naturally occurring themes - don't force content into artificial categories.**

Guidelines:
- Focus on what's actually discussed, not what should be discussed
- Ignore casual conversation and minor procedural items
- Group related concepts under broader themes when they naturally cluster
- Only include action items that have clear owners
- Extract only the most significant relationships - quality over quantity

Return ONLY a JSON array in this format:
[
  ["Entity1", "relationship", "Entity2"],
  ["Entity1", "#color"]
]

Color entities based on their natural role:
- People: #4CAF50 (green)
- Main topics/themes: #2196F3 (blue)
- Decisions made: #FF9800 (orange)
- Action items: #F44336 (red)
- Concerns/blockers: #FFC107 (amber)
- Deadlines: #9C27B0 (purple)

Example (based on actual content):
[
  ["Budget Review", "assigned_to", "John"],
  ["Budget Review", "due_by", "Friday"],
  ["Budget Review", "#F44336"],
  ["John", "#4CAF50"],
  ["Friday", "#9C27B0"]
]`;

        try {
            console.log(`[Server] Calling OpenAI API...`);
            const response = await this.openai.chat.completions.create({
                model: "o4-mini",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                max_tokens: 1200
            });

            const content = response.choices[0].message.content.trim();
            console.log('[Server] OpenAI Response:', content);
            
            // Parse JSON response
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                console.log('[Server] Parsed knowledge:', parsed);
                return parsed;
            } else {
                console.log('[Server] No JSON array found in OpenAI response');
                return [];
            }
            
        } catch (error) {
            console.error('[Server] OpenAI API error:', error);
            console.error('[Server] API key valid?', !!process.env.OPENAI_API_KEY);
            throw error;
        }
    }

    updateMeetingGraph(updates) {
        // Mirror GraphGPT's updateGraph logic
        let currentGraph = { 
            nodes: [...this.meetingState.currentGraph.nodes],
            edges: [...this.meetingState.currentGraph.edges]
        };

        updates.forEach(update => {
            if (update.length === 3) {
                // Add relationship: [entity1, relation, entity2]
                const [entity1, relation, entity2] = update;

                // Add nodes if they don't exist
                if (!currentGraph.nodes.find(node => node.id === entity1)) {
                    currentGraph.nodes.push({ id: entity1, label: entity1, color: "#ffffff" });
                }
                if (!currentGraph.nodes.find(node => node.id === entity2)) {
                    currentGraph.nodes.push({ id: entity2, label: entity2, color: "#ffffff" });
                }

                // Add or update edge
                const existingEdge = currentGraph.edges.find(edge => 
                    edge.from === entity1 && edge.to === entity2
                );
                if (existingEdge) {
                    existingEdge.label = relation;
                } else {
                    currentGraph.edges.push({ from: entity1, to: entity2, label: relation });
                }
            } else if (update.length === 2 && update[1].startsWith("#")) {
                // Set node color: [entity, color]
                const [entity, color] = update;
                const node = currentGraph.nodes.find(node => node.id === entity);
                if (node) {
                    node.color = color;
                } else {
                    currentGraph.nodes.push({ id: entity, label: entity, color: color });
                }
            }
        });

        this.meetingState.currentGraph = currentGraph;
        console.log(`[Server] Graph updated: ${currentGraph.nodes.length} nodes, ${currentGraph.edges.length} edges`);
    }

    startMeeting() {
        this.meetingState.isActive = true;
        this.meetingState.participants.clear();
        console.log('[Server] Meeting started');
        this.broadcastToClients({ type: 'meeting_started' });
    }

    stopMeeting() {
        this.meetingState.isActive = false;
        console.log('[Server] Meeting stopped');
        this.broadcastToClients({ type: 'meeting_stopped' });
    }

    clearMeetingState() {
        this.meetingState.currentGraph = { nodes: [], edges: [] };
        this.meetingState.transcriptBuffer = [];
        this.meetingState.participants.clear();
        console.log('[Server] Meeting state cleared');
    }

    broadcastToClients(message) {
        const messageStr = JSON.stringify(message);
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    }

    async shutdown() {
        console.log('[Server] Shutting down...');
        if (this.wss) {
            this.wss.close();
        }
        if (this.server) {
            this.server.close();
        }
    }
}

// Start server
const server = new MeetingNexusServer();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\\n[Server] Received SIGINT, shutting down gracefully...');
    await server.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\\n[Server] Received SIGTERM, shutting down gracefully...');
    await server.shutdown();
    process.exit(0);
});

module.exports = MeetingNexusServer;